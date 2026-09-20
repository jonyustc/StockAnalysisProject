'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { companies, financialFacts, fiscalPeriods, lineItemDefs, sourceDocuments } from '@/db/schema'
import { fiscalYearBounds } from '@/lib/fiscal'
import { parseReportedNumber, type ValueScale } from '@/lib/units'

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
          // The schema requires one or the other; default to a path built from
          // the title rather than rejecting the save.
          onedrivePath: onedrivePath ?? (sourceUrl ? null : `${symbol}/${docTitle}`),
          sourceUrl,
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
