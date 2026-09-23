import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'

import { db } from '@/db/client'
import { companies, corporateActions } from '@/db/schema'
import { parseDividendTable, percentOfFace, type DividendRow } from '@/lib/dividend-table'

/*
 * A company's dividend history, pasted from wherever it is published.
 *
 * These are the company's own announcements, not your dividends: they go in
 * with the corporate actions, beside bonus and rights issues, and are what
 * the dividend-per-share history is checked against. What you were actually
 * paid stays in the portfolio ledger.
 */

export interface DividendHistoryLine extends DividendRow {
  /** Already stored with this ex-date. */
  stored: boolean
  /** Stored with a different amount — the figures disagree. */
  differs: number | null
}

export interface DividendHistoryPreview {
  ok: true
  kind: 'dividend-history'
  message: string
  symbol: string
  columns: Record<string, string>
  issues: string[]
  lines: DividendHistoryLine[]
}

type Failure = { ok: false; message: string }

const MAX_ROWS = 200

export async function previewDividendHistory(text: string, symbol: string): Promise<DividendHistoryPreview | Failure> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name, faceValue: companies.faceValue })
    .from(companies)
    .where(eq(companies.dseSymbol, symbol.toUpperCase()))
    .limit(1)
  if (!company) return { ok: false, message: `No company with symbol ${symbol}.` }

  const { rows, columns, issues } = parseDividendTable(text)
  if (rows.length === 0) return { ok: false, message: issues[0] ?? 'Nothing could be read.' }
  if (rows.length > MAX_ROWS) return { ok: false, message: `That is ${rows.length} rows; ${MAX_ROWS} is the most at once.` }

  const existing = await db
    .select({ exDate: corporateActions.exDate, cashPerShare: corporateActions.cashPerShare })
    .from(corporateActions)
    .where(
      and(
        eq(corporateActions.companyId, company.id),
        eq(corporateActions.actionType, 'cash_dividend'),
        inArray(corporateActions.exDate, rows.map((r) => r.exDate)),
      ),
    )
  const stored = new Map(existing.map((e) => [e.exDate, e.cashPerShare === null ? null : Number(e.cashPerShare)]))

  const lines: DividendHistoryLine[] = rows.map((row) => {
    const already = stored.has(row.exDate)
    const amount = stored.get(row.exDate) ?? null
    return {
      ...row,
      stored: already,
      differs: already && amount !== null && Math.abs(amount - row.amount) > 0.005 ? amount : null,
    }
  })

  const fresh = lines.filter((l) => !l.stored).length
  return {
    ok: true,
    kind: 'dividend-history',
    message: `Read ${rows.length} dividends for ${symbol}, ${rows[rows.length - 1].exDate} to ${rows[0].exDate}. ${fresh} new.`,
    symbol: symbol.toUpperCase(),
    columns,
    issues,
    lines,
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function cleanDividendLines(value: unknown): DividendRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) return null

  const rows: DividendRow[] = []
  for (const row of value) {
    if (
      typeof row?.exDate !== 'string' || !DATE.test(row.exDate) ||
      typeof row?.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0 ||
      (row.paymentDate !== null && (typeof row.paymentDate !== 'string' || !DATE.test(row.paymentDate)))
    ) {
      return null
    }
    rows.push({
      exDate: row.exDate,
      amount: row.amount,
      paymentDate: row.paymentDate ?? null,
      kind: typeof row.kind === 'string' ? row.kind.slice(0, 40) : null,
      looksAdjusted: row.looksAdjusted === true,
    })
  }
  return rows
}

/**
 * Store them as cash dividends against the company.
 *
 * A cash dividend changes no share count, so its adjustment factor stays 1:
 * these record what was paid and when, and never restate a past price or a
 * past per-share figure. One already stored for an ex-date is updated rather
 * than repeated, so pasting a longer history again simply extends it.
 */
export async function applyDividendHistory(
  symbol: string,
  rows: DividendRow[],
  source: string,
): Promise<{ ok: boolean; message: string }> {
  const [company] = await db
    .select({ id: companies.id, faceValue: companies.faceValue })
    .from(companies)
    .where(eq(companies.dseSymbol, symbol.toUpperCase()))
    .limit(1)
  if (!company) return { ok: false, message: `No company with symbol ${symbol}.` }

  const faceValue = Number(company.faceValue)
  let added = 0
  let updated = 0

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const values = {
        cashPerShare: String(row.amount),
        // DSE announces a dividend as a percentage of face value; this is
        // that percentage, worked back from the amount.
        cashDividendPct: percentOfFace(row.amount, faceValue),
        paymentDate: row.paymentDate,
        notes:
          `From ${source}.` +
          (row.looksAdjusted
            ? ' The figure carries more decimals than a declared dividend can, so that source had restated it for later bonus issues — treat it as approximate.'
            : ''),
        verification: 'unverified' as const,
      }

      const [existing] = await tx
        .select({ id: corporateActions.id })
        .from(corporateActions)
        .where(
          and(
            eq(corporateActions.companyId, company.id),
            eq(corporateActions.actionType, 'cash_dividend'),
            eq(corporateActions.exDate, row.exDate),
          ),
        )
        .limit(1)

      if (existing) {
        await tx.update(corporateActions).set(values).where(eq(corporateActions.id, existing.id))
        updated += 1
      } else {
        await tx.insert(corporateActions).values({
          companyId: company.id,
          actionType: 'cash_dividend',
          exDate: row.exDate,
          adjustmentFactor: '1',
          ...values,
        })
        added += 1
      }
    }
  })

  return {
    ok: added + updated > 0,
    message: `${symbol}: ${added} dividend${added === 1 ? '' : 's'} added${updated > 0 ? `, ${updated} updated` : ''}.`,
  }
}
