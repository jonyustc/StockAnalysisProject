'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { getPeriodWithFacts } from '@/db/queries'
import { companies, financialFacts, fiscalPeriods, lineItemDefs, sourceDocuments } from '@/db/schema'
import { fiscalYearBounds } from '@/lib/fiscal'
import { parseReportedNumber, SCALE_FACTORS, type ValueScale } from '@/lib/units'
import {
  describeSummary,
  summarise,
  verifyRow,
  type RowVerdict,
  type VerifyOutcome,
} from '@/lib/verification'

export interface SaveResult {
  ok: boolean
  message: string
  /** Line item tag -> problem, shown against the field. */
  fieldErrors?: Record<string, string>
  saved?: number
  cleared?: number
}

const SCALES: ValueScale[] = ['unit', 'thousand', 'lakh', 'million', 'crore', 'billion']

/**
 * Per-share figures, percentages and ratios are printed as-is — an EPS of
 * 19.02 is 19.02 taka regardless of the scale the statement is drawn in.
 * Only currency amounts and share counts take the period's scale.
 */
function scaleForUnit(unit: string, periodScale: ValueScale): ValueScale {
  return unit === 'currency' || unit === 'count' ? periodScale : 'unit'
}

export async function saveAnnualEntry(
  _previous: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const symbol = String(formData.get('symbol') ?? '').toUpperCase()
  const fiscalYear = Number(formData.get('fiscalYear'))
  const basis = String(formData.get('basis') ?? 'consolidated') as 'consolidated' | 'standalone'
  const periodScale = String(formData.get('scale') ?? 'million') as ValueScale
  const auditStatus = String(formData.get('auditStatus') ?? 'audited') as
    | 'audited'
    | 'unaudited'
    | 'provisional'
    | 'restated'

  if (!symbol || !Number.isInteger(fiscalYear)) {
    return { ok: false, message: 'Missing company or fiscal year.' }
  }

  if (!SCALES.includes(periodScale)) {
    return { ok: false, message: `Unknown scale "${periodScale}".` }
  }

  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.dseSymbol, symbol))
    .limit(1)

  if (!company) return { ok: false, message: `No company with symbol ${symbol}.` }

  const items = await db.select().from(lineItemDefs).where(eq(lineItemDefs.isCore, true))

  // Parse everything before touching the database, so a typo in the last field
  // does not leave a half-saved period behind.
  const fieldErrors: Record<string, string> = {}
  const parsed: { item: (typeof items)[number]; value: number | null; page: string | null }[] = []

  for (const item of items) {
    const raw = String(formData.get(`value__${item.tag}`) ?? '')
    const page = String(formData.get(`page__${item.tag}`) ?? '').trim() || null
    const value = parseReportedNumber(raw)

    // A blank cell is not a reported zero, so blank is allowed and means
    // "not entered". Anything non-blank that fails to parse is an error.
    if (value === null && raw.trim() !== '' && !['-', '—', 'N/A'].includes(raw.trim())) {
      fieldErrors[item.tag] = `"${raw.trim()}" is not a number`
    }

    parsed.push({ item, value, page })
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: `${Object.keys(fieldErrors).length} value(s) could not be read. Nothing was saved.`,
      fieldErrors,
    }
  }

  const bounds = fiscalYearBounds(
    { month: company.fiscalYearEndMonth, day: company.fiscalYearEndDay },
    fiscalYear,
  )

  let saved = 0
  let cleared = 0

  await db.transaction(async (tx) => {
    // The source document, if one was named.
    const docTitle = String(formData.get('docTitle') ?? '').trim()
    let sourceDocumentId: number | null = Number(formData.get('sourceDocumentId')) || null

    if (!sourceDocumentId && docTitle) {
      const onedrivePath = String(formData.get('docPath') ?? '').trim() || null
      const sourceUrl = String(formData.get('docUrl') ?? '').trim() || null

      const [doc] = await tx
        .insert(sourceDocuments)
        .values({
          companyId: company.id,
          docType: 'annual_report',
          title: docTitle,
          fiscalYear,
          // Left null when you have not said where the file is. Inventing a
          // path would look like provenance while pointing at nothing.
          onedrivePath,
          sourceUrl,
        })
        .onConflictDoUpdate({
          target: [sourceDocuments.companyId, sourceDocuments.title],
          set: { fiscalYear, onedrivePath, sourceUrl },
        })
        .returning({ id: sourceDocuments.id })

      sourceDocumentId = doc.id
    }

    const [period] = await tx
      .insert(fiscalPeriods)
      .values({
        companyId: company.id,
        fiscalYear,
        periodType: 'annual',
        basis,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        monthsCovered: bounds.monthsCovered,
        auditStatus,
        sourceDocumentId,
        isComplete: formData.get('isComplete') === 'on',
        notes: String(formData.get('notes') ?? '').trim() || null,
      })
      .onConflictDoUpdate({
        target: [
          fiscalPeriods.companyId,
          fiscalPeriods.fiscalYear,
          fiscalPeriods.periodType,
          fiscalPeriods.basis,
        ],
        set: {
          periodStart: bounds.start,
          periodEnd: bounds.end,
          auditStatus,
          sourceDocumentId,
          isComplete: formData.get('isComplete') === 'on',
          notes: String(formData.get('notes') ?? '').trim() || null,
        },
      })
      .returning({ id: fiscalPeriods.id })

    for (const { item, value, page } of parsed) {
      if (value === null) {
        // Clearing a field removes the fact rather than storing a zero.
        const removed = await tx
          .delete(financialFacts)
          .where(
            and(
              eq(financialFacts.periodId, period.id),
              eq(financialFacts.lineItemId, item.id),
              eq(financialFacts.revision, 1),
            ),
          )
          .returning({ id: financialFacts.id })

        cleared += removed.length
        continue
      }

      await tx
        .insert(financialFacts)
        .values({
          periodId: period.id,
          lineItemId: item.id,
          valueReported: String(value),
          scale: scaleForUnit(item.unit, periodScale),
          sourcePage: page,
          revision: 1,
          isCurrent: true,
        })
        .onConflictDoUpdate({
          target: [financialFacts.periodId, financialFacts.lineItemId, financialFacts.revision],
          set: {
            valueReported: String(value),
            scale: scaleForUnit(item.unit, periodScale),
            sourcePage: page,
          },
        })

      saved += 1
    }
  })

  revalidatePath(`/companies/${symbol}`)
  revalidatePath(`/companies/${symbol}/${fiscalYear}/edit`)

  return {
    ok: true,
    message: `Saved ${saved} value${saved === 1 ? '' : 's'}${cleared > 0 ? `, cleared ${cleared}` : ''}.`,
    saved,
    cleared,
  }
}

export interface VerifyResult {
  ok: boolean
  message: string
  fieldErrors?: Record<string, string>
  /** tag -> what happened, so the form can show it per row. */
  outcomes?: Record<string, VerifyOutcome>
}

/**
 * Check a year's figures against the annual report.
 *
 * A blank field means "not checked" and leaves the stored figure alone. A
 * figure that matches is marked verified. A figure that differs is a source
 * error rather than a company restatement — but the mechanism is the same, so
 * the old value is kept as a superseded revision and the report's value
 * becomes current. Nothing is ever overwritten in place.
 */
export async function verifyAnnualEntry(
  _previous: VerifyResult | null,
  formData: FormData,
): Promise<VerifyResult> {
  const symbol = String(formData.get('symbol') ?? '').toUpperCase()
  const fiscalYear = Number(formData.get('fiscalYear'))
  const basis = String(formData.get('basis') ?? 'consolidated') as 'consolidated' | 'standalone'
  const periodScale = String(formData.get('scale') ?? 'million') as ValueScale

  if (!symbol || !Number.isInteger(fiscalYear)) {
    return { ok: false, message: 'Missing company or fiscal year.' }
  }
  if (!SCALES.includes(periodScale)) {
    return { ok: false, message: `Unknown scale "${periodScale}".` }
  }

  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.dseSymbol, symbol))
    .limit(1)
  if (!company) return { ok: false, message: `No company with symbol ${symbol}.` }

  const items = await db.select().from(lineItemDefs).where(eq(lineItemDefs.isCore, true))
  const { period, facts } = await getPeriodWithFacts(company.id, fiscalYear, basis)

  // Compare everything before writing anything, so one unreadable entry does
  // not leave a half-verified year behind.
  const verdicts: (RowVerdict & { itemId: number; rowScale: ValueScale; page: string | null })[] = []
  const fieldErrors: Record<string, string> = {}

  for (const item of items) {
    const rowScale = scaleForUnit(item.unit, periodScale)
    const fact = facts.get(item.id)

    // Express the stored figure in the scale the form is using, so a form set
    // to crore compares correctly against a figure stored in millions.
    const storedInScale =
      fact === undefined
        ? null
        : String(
            (Number(fact.valueReported) * SCALE_FACTORS[fact.scale]) / SCALE_FACTORS[rowScale],
          )

    const typed = String(formData.get(`value__${item.tag}`) ?? '')
    const page = String(formData.get(`page__${item.tag}`) ?? '').trim() || null
    const verdict = verifyRow(item.tag, storedInScale, typed)

    if (verdict.outcome === 'error') fieldErrors[item.tag] = verdict.message ?? 'Not a number'
    verdicts.push({ ...verdict, itemId: item.id, rowScale, page })
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: `${Object.keys(fieldErrors).length} entr${
        Object.keys(fieldErrors).length === 1 ? 'y' : 'ies'
      } could not be read. Nothing was saved.`,
      fieldErrors,
    }
  }

  const summary = summarise(verdicts)

  if (summary.confirmed + summary.corrected + summary.added === 0) {
    return { ok: false, message: describeSummary(summary) }
  }

  const bounds = fiscalYearBounds(
    { month: company.fiscalYearEndMonth, day: company.fiscalYearEndDay },
    fiscalYear,
  )

  await db.transaction(async (tx) => {
    const sourceDocumentId = Number(formData.get('sourceDocumentId')) || null
    const sourcePageFallback = String(formData.get('reportPage') ?? '').trim() || null

    const [saved] = await tx
      .insert(fiscalPeriods)
      .values({
        companyId: company.id,
        fiscalYear,
        periodType: 'annual',
        basis,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        monthsCovered: bounds.monthsCovered,
        sourceDocumentId: sourceDocumentId ?? period?.sourceDocumentId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          fiscalPeriods.companyId,
          fiscalPeriods.fiscalYear,
          fiscalPeriods.periodType,
          fiscalPeriods.basis,
        ],
        set: { sourceDocumentId: sourceDocumentId ?? period?.sourceDocumentId ?? null },
      })
      .returning({ id: fiscalPeriods.id })

    for (const verdict of verdicts) {
      if (verdict.outcome === 'skipped') continue

      const page = verdict.page ?? sourcePageFallback
      const fact = facts.get(verdict.itemId)

      if (verdict.outcome === 'confirmed' && fact) {
        await tx
          .update(financialFacts)
          .set({
            verification: 'verified',
            verifiedAt: new Date(),
            sourcePage: page ?? fact.sourcePage,
            sourceDocumentId: sourceDocumentId ?? undefined,
          })
          .where(eq(financialFacts.id, fact.id))
        continue
      }

      if (verdict.outcome === 'corrected' && fact) {
        // Supersede rather than overwrite: what the secondary source claimed
        // stays on the record next to what the report actually says.
        await tx
          .update(financialFacts)
          .set({
            isCurrent: false,
            restatedReason: `Superseded on verification against the annual report (was ${verdict.stored}).`,
          })
          .where(eq(financialFacts.id, fact.id))

        await tx.insert(financialFacts).values({
          periodId: saved.id,
          lineItemId: verdict.itemId,
          valueReported: String(verdict.typed),
          scale: verdict.rowScale,
          revision: fact.revision + 1,
          isCurrent: true,
          verification: 'verified',
          verifiedAt: new Date(),
          sourceDocumentId,
          sourcePage: page,
          note: `Corrected from ${verdict.stored} on verification.`,
        })
        continue
      }

      if (verdict.outcome === 'added') {
        await tx.insert(financialFacts).values({
          periodId: saved.id,
          lineItemId: verdict.itemId,
          valueReported: String(verdict.typed),
          scale: verdict.rowScale,
          revision: 1,
          isCurrent: true,
          verification: 'verified',
          verifiedAt: new Date(),
          sourceDocumentId,
          sourcePage: page,
        })
      }
    }
  })

  revalidatePath(`/companies/${symbol}`)
  revalidatePath(`/companies/${symbol}/data`)
  revalidatePath(`/companies/${symbol}/${fiscalYear}/verify`)

  return {
    ok: true,
    message: describeSummary(summary),
    outcomes: Object.fromEntries(verdicts.map((v) => [v.tag, v.outcome])),
  }
}
