import 'server-only'

import { inArray, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { companies, dailyPrices } from '@/db/schema'
import { listCompanyNames } from '@/db/queries'
import { matchCompany } from '@/lib/dividends'
import { nameFromFile, parsePriceCsv, type PriceRow } from '@/lib/price-csv'

/*
 * Importing historical prices from a CSV. The preview says what each stock
 * in the file would gain, and what it would overwrite, before anything is
 * written; the apply step re-checks every row it is given.
 */

export interface PriceSymbolPlan {
  symbol: string
  known: boolean
  rows: number
  from: string
  to: string
  /** Days in the file the database already has — these are replaced. */
  replacing: number
  /** What is stored for this stock now. */
  storedDays: number
  storedFrom: string | null
  storedTo: string | null
}

export interface PricesPreview {
  ok: true
  kind: 'prices'
  message: string
  /** How the stock was decided, when the file itself does not say. */
  symbolFrom?: 'column' | 'chosen' | 'filename'
  /** Heading in the file → what it was read as. */
  columns: Record<string, string>
  issues: string[]
  symbols: PriceSymbolPlan[]
  rows: PriceRow[]
  totalRows: number
}

type Failure = { ok: false; message: string }

/** Well over a decade of daily prices for a handful of stocks. */
const MAX_ROWS = 40_000

/** What each stock has stored now, and how much of a file it already holds. */
async function storedFor(symbols: string[], dates: string[]) {
  if (symbols.length === 0) return new Map<string, { days: number; from: string | null; to: string | null; overlapping: number }>()

  const rows = await db
    .select({
      symbol: companies.dseSymbol,
      days: sql<number>`count(${dailyPrices.tradeDate})::int`,
      from: sql<string | null>`min(${dailyPrices.tradeDate})::text`,
      to: sql<string | null>`max(${dailyPrices.tradeDate})::text`,
      overlapping: sql<number>`count(${dailyPrices.tradeDate}) FILTER (
        WHERE ${dates.length > 0 ? inArray(dailyPrices.tradeDate, dates) : sql`false`}
      )::int`,
    })
    .from(companies)
    .leftJoin(dailyPrices, sql`${dailyPrices.companyId} = ${companies.id}`)
    .where(inArray(companies.dseSymbol, symbols))
    .groupBy(companies.dseSymbol)

  return new Map(rows.map((r) => [r.symbol, { days: r.days, from: r.from, to: r.to, overlapping: r.overlapping }]))
}

export async function previewPrices(
  text: string,
  chosenSymbol?: string,
  fileName?: string,
): Promise<PricesPreview | Failure> {
  const first = parsePriceCsv(text, chosenSymbol)
  const hasOwn = first.rows.length > 0 && first.rows.every((r) => r.symbol !== null)
  if (hasOwn) {
    return planPrices(first, chosenSymbol ? 'chosen' : 'column')
  }

  // A file with no trading code — investing.com and most foreign exports —
  // is named after the company often enough to be worth reading: "Square
  // Pharma Stock Price History.csv". A guess is only used when exactly one
  // company matches, and the preview says where it came from.
  const guess = fileName ? matchCompany(nameFromFile(fileName), await listCompanyNames()) : null
  if (!guess) {
    return {
      ok: false,
      message:
        'This file has no trading code column, so it does not say which stock it is. Choose one above and read it again.',
    }
  }
  return planPrices(parsePriceCsv(text, guess), 'filename')
}

/** The same preview, whether the prices came from a file or from DSE. */
export async function planPrices(
  { rows, columns, issues }: { rows: PriceRow[]; columns: Record<string, string>; issues: string[] },
  symbolFrom?: PricesPreview['symbolFrom'],
): Promise<PricesPreview | Failure> {

  if (rows.length === 0) {
    return { ok: false, message: `No prices could be read. ${issues.join(' ')}`.trim() }
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, message: `That file has ${rows.length.toLocaleString()} rows; ${MAX_ROWS.toLocaleString()} is the most this imports at once.` }
  }

  const symbols = [...new Set(rows.map((r) => r.symbol).filter((s): s is string => s !== null))]
  const stored = await storedFor(symbols, [...new Set(rows.map((r) => r.date))])

  const plans: PriceSymbolPlan[] = symbols.map((symbol) => {
    const own = rows.filter((r) => r.symbol === symbol)
    const existing = stored.get(symbol)
    return {
      symbol,
      known: existing !== undefined,
      rows: own.length,
      from: own[0].date,
      to: own[own.length - 1].date,
      // The overlap is counted across the file's dates; with one stock in
      // the file that is exactly this stock's overlap, which is the usual case.
      replacing: symbols.length === 1 ? (existing?.overlapping ?? 0) : 0,
      storedDays: existing?.days ?? 0,
      storedFrom: existing?.from ?? null,
      storedTo: existing?.to ?? null,
    }
  })

  const unknown = plans.filter((p) => !p.known).map((p) => p.symbol)
  if (unknown.length > 0) {
    issues.push(`Not in the database, so they cannot be imported: ${unknown.join(', ')}. Add the company first.`)
  }

  return {
    ok: true,
    kind: 'prices',
    symbolFrom,
    message: `Read ${rows.length.toLocaleString()} days for ${symbols.length} stock${symbols.length === 1 ? '' : 's'}.`,
    columns,
    issues,
    symbols: plans,
    rows,
    totalRows: rows.length,
  }
}

const SYMBOL = /^[A-Z0-9][A-Z0-9&\-.]{1,19}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Rows come back from the browser, so each one is checked again here. */
export function cleanPriceRows(value: unknown): PriceRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) return null

  const rows: PriceRow[] = []
  for (const row of value) {
    const optional = (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
    const open = optional(row?.open)
    const high = optional(row?.high)
    const low = optional(row?.low)
    const volume = optional(row?.volume)

    if (
      typeof row?.symbol !== 'string' || !SYMBOL.test(row.symbol) ||
      typeof row?.date !== 'string' || !DATE.test(row.date) ||
      typeof row?.close !== 'number' || !Number.isFinite(row.close) || row.close <= 0 ||
      open === undefined || high === undefined || low === undefined || volume === undefined
    ) {
      return null
    }
    rows.push({ symbol: row.symbol, date: row.date, close: row.close, open, high, low, volume })
  }
  return rows
}

export interface PricesApplied {
  written: number
  skipped: string[]
  coverage: { symbol: string; days: number; from: string | null; to: string | null }[]
}

/**
 * Write the rows. A day already stored is replaced — so importing the same
 * file twice changes nothing, and a longer export simply extends what is
 * there. Figures the file does not carry (a missing volume, say) leave what
 * is stored alone rather than blanking it.
 */
export async function applyPrices(rows: PriceRow[], source: string): Promise<PricesApplied> {
  const symbols = [...new Set(rows.map((r) => r.symbol!))]
  const known = await db
    .select({ id: companies.id, symbol: companies.dseSymbol })
    .from(companies)
    .where(inArray(companies.dseSymbol, symbols))

  const ids = new Map(known.map((c) => [c.symbol, c.id]))
  const skipped = symbols.filter((s) => !ids.has(s))
  const usable = rows.filter((r) => ids.has(r.symbol!))

  let written = 0
  await db.transaction(async (tx) => {
    // In batches: one statement per row would be thousands of round trips.
    const BATCH = 500
    for (let i = 0; i < usable.length; i += BATCH) {
      const batch = usable.slice(i, i + BATCH)
      await tx
        .insert(dailyPrices)
        .values(
          batch.map((r) => ({
            companyId: ids.get(r.symbol!)!,
            tradeDate: r.date,
            openPrice: r.open === null ? null : String(r.open),
            highPrice: r.high === null ? null : String(r.high),
            lowPrice: r.low === null ? null : String(r.low),
            closePrice: String(r.close),
            volume: r.volume === null ? null : Math.round(r.volume),
            source,
          })),
        )
        .onConflictDoUpdate({
          target: [dailyPrices.companyId, dailyPrices.tradeDate],
          set: {
            openPrice: sql`coalesce(excluded.open_price, ${dailyPrices.openPrice})`,
            highPrice: sql`coalesce(excluded.high_price, ${dailyPrices.highPrice})`,
            lowPrice: sql`coalesce(excluded.low_price, ${dailyPrices.lowPrice})`,
            closePrice: sql`excluded.close_price`,
            volume: sql`coalesce(excluded.volume, ${dailyPrices.volume})`,
            source: sql`excluded.source`,
            fetchedAt: sql`now()`,
          },
        })
      written += batch.length
    }
  })

  const after = await storedFor([...ids.keys()], [])
  return {
    written,
    skipped,
    coverage: [...after.entries()]
      .map(([symbol, s]) => ({ symbol, days: s.days, from: s.from, to: s.to }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
  }
}
