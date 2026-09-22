/**
 * Fetches the daily board and writes quotes for tracked companies.
 *
 * Takes any object with a `query` method, so the scheduled route can hand it
 * the app's pool and the CLI script can hand it its own client — one
 * implementation, not two that drift.
 */

import { parseInstruments, PRICE_SOURCE_NAME, PRICE_SOURCE_URL } from './prices'

/** Structurally satisfied by both pg.Pool and pg.Client. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export interface IngestSummary {
  ok: boolean
  written: number
  skipped: { symbol: string; reason: string }[]
  tradeDates: string[]
  message: string
  durationMs: number
}

const FETCH_TIMEOUT_MS = 20_000

async function fetchBoard(): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(PRICE_SOURCE_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`${PRICE_SOURCE_NAME} returned HTTP ${response.status}`)
    }

    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function ingestDailyPrices(client: Queryable): Promise<IngestSummary> {
  const startedAt = Date.now()

  const { rows: jobRows } = await client.query(
    `INSERT INTO job_runs (job_name) VALUES ('prices') RETURNING id`,
  )
  const jobId = jobRows[0].id

  async function finish(summary: Omit<IngestSummary, 'durationMs'>): Promise<IngestSummary> {
    await client.query(
      `UPDATE job_runs
          SET finished_at = now(), succeeded = $2, rows_affected = $3, message = $4
        WHERE id = $1`,
      [jobId, summary.ok, summary.written, summary.message],
    )
    return { ...summary, durationMs: Date.now() - startedAt }
  }

  try {
    const { rows: companyRows } = await client.query(
      // Researched companies, plus any in the portfolio ledger: a holding in a
      // company with no fundamentals entered still needs a price.
      `SELECT id, dse_symbol FROM companies
        WHERE is_active
          AND (is_tracked OR id IN (SELECT company_id FROM portfolio_transactions))
        ORDER BY dse_symbol`,
    )

    if (companyRows.length === 0) {
      return finish({
        ok: false,
        written: 0,
        skipped: [],
        tradeDates: [],
        message: 'No tracked companies.',
      })
    }

    const idBySymbol = new Map(
      companyRows.map((row) => [String(row.dse_symbol).toUpperCase(), row.id]),
    )

    const payload = await fetchBoard()
    const { quotes, skipped } = parseInstruments(payload, [...idBySymbol.keys()])

    if (quotes.length === 0) {
      // Every stock being unquotable means the feed changed shape or broke —
      // worth failing loudly rather than recording a quiet success.
      return finish({
        ok: false,
        written: 0,
        skipped,
        tradeDates: [],
        message: `No usable quotes from ${PRICE_SOURCE_NAME}. ${skipped
          .slice(0, 3)
          .map((s) => `${s.symbol}: ${s.reason}`)
          .join('; ')}`,
      })
    }

    let written = 0

    for (const quote of quotes) {
      await client.query(
        `INSERT INTO daily_prices
           (company_id, trade_date, open_price, high_price, low_price, close_price,
            ycp, volume, value_bdt, trade_count, yearly_high, yearly_low, source, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
         ON CONFLICT (company_id, trade_date) DO UPDATE SET
            open_price = EXCLUDED.open_price,
            high_price = EXCLUDED.high_price,
            low_price = EXCLUDED.low_price,
            close_price = EXCLUDED.close_price,
            ycp = EXCLUDED.ycp,
            volume = EXCLUDED.volume,
            value_bdt = EXCLUDED.value_bdt,
            trade_count = EXCLUDED.trade_count,
            yearly_high = EXCLUDED.yearly_high,
            yearly_low = EXCLUDED.yearly_low,
            source = EXCLUDED.source,
            fetched_at = now()`,
        [
          idBySymbol.get(quote.symbol),
          quote.tradeDate,
          quote.open,
          quote.high,
          quote.low,
          quote.close,
          quote.ycp,
          quote.volume,
          quote.valueBdt,
          quote.trades,
          quote.yearlyHigh,
          quote.yearlyLow,
          PRICE_SOURCE_NAME,
        ],
      )
      written += 1
    }

    const tradeDates = [...new Set(quotes.map((q) => q.tradeDate))].sort()

    return finish({
      ok: true,
      written,
      skipped,
      tradeDates,
      message: `Wrote ${written} quote(s) for ${tradeDates.join(', ')}${
        skipped.length > 0 ? `; skipped ${skipped.length}` : ''
      }`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finish({ ok: false, written: 0, skipped: [], tradeDates: [], message })
    throw error
  }
}
