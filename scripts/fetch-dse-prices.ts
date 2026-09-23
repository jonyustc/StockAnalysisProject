/**
 * Fetch day-end price history from DSE and store it.
 *
 *   npx tsx scripts/fetch-dse-prices.ts --symbol=SQURPHARMA [--years=5]
 *   npx tsx scripts/fetch-dse-prices.ts --all [--years=5] [--target=supabase]
 *
 * --all covers every company in the database; --held, only the ones the
 * portfolio has traded. The archive answers about five hundred rows at a
 * time, so each stock is fetched in windows and stitched together, with a
 * pause between requests — a backfill of several years is a few dozen
 * polite requests, not a burst.
 *
 * A day already stored is replaced, so this can be run again at any time.
 */

import { Client } from 'pg'

import '../db/pg-types'
import { fetchDseHistory } from '../lib/dse-fetch'
import type { PriceRow } from '../lib/price-csv'
import { resolveTarget, sslFor } from './target'

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return match ? match.slice(name.length + 3) : undefined
}

const fetchPage = async (url: string) => {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'dse-research/1.0 (personal portfolio tracker)' },
    signal: AbortSignal.timeout(30_000),
  })
  return { ok: response.ok, status: response.status, text: await response.text() }
}

async function main() {
  const years = Number(flag('years') ?? 5)
  if (!Number.isInteger(years) || years < 1 || years > 20) {
    console.error('--years must be a whole number of years, 1 to 20.')
    process.exit(1)
  }

  const resolved = resolveTarget()
  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}\n`)

  const client = new Client({ connectionString: resolved.connectionString, ssl: sslFor(resolved) })
  await client.connect()

  try {
    const one = flag('symbol')?.toUpperCase()
    const { rows: choices } = await client.query<{ dse_symbol: string }>(
      one
        ? `SELECT dse_symbol FROM companies WHERE dse_symbol = $1`
        : process.argv.includes('--held')
          ? `SELECT DISTINCT c.dse_symbol FROM companies c
               JOIN portfolio_transactions t ON t.company_id = c.id ORDER BY 1`
          : process.argv.includes('--all')
            ? `SELECT dse_symbol FROM companies WHERE is_active ORDER BY 1`
            : `SELECT dse_symbol FROM companies WHERE false`,
      one ? [one] : [],
    )

    if (choices.length === 0) {
      console.error(one ? `No company with symbol ${one}.` : 'Choose --symbol=CODE, --held or --all.')
      process.exit(1)
    }

    const to = new Date().toISOString().slice(0, 10)
    const from = `${Number(to.slice(0, 4)) - years}${to.slice(4)}`
    console.log(`  ${choices.length} stock(s), ${from} to ${to}\n`)

    for (const { dse_symbol: symbol } of choices) {
      const history = await fetchDseHistory({ symbol, from, to, fetchPage })
      const windows = history.windows.length
      if (history.rows.length === 0) {
        console.log(`  ${symbol.padEnd(12)} nothing — ${history.issues[0] ?? 'no rows'}`)
        continue
      }

      const written = await write(client, symbol, history.rows)
      console.log(
        `  ${symbol.padEnd(12)} ${String(history.rows.length).padStart(5)} days ` +
          `(${history.rows[0].date} → ${history.rows[history.rows.length - 1].date}) ` +
          `from ${windows} request(s), ${written} stored` +
          (history.issues.length > 0 ? `  ! ${history.issues.join(' ')}` : ''),
      )
    }
    console.log()
  } finally {
    await client.end()
  }
}

/** Upsert one stock's rows; a day already stored is replaced. */
async function write(client: Client, symbol: string, rows: PriceRow[]): Promise<number> {
  const { rows: found } = await client.query<{ id: string }>(`SELECT id FROM companies WHERE dse_symbol = $1`, [symbol])
  if (found.length === 0) return 0
  const companyId = Number(found[0].id)

  await client.query('BEGIN')
  try {
    for (const row of rows) {
      await client.query(
        `INSERT INTO daily_prices (company_id, trade_date, open_price, high_price, low_price, close_price, volume, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'dsebd.org/day_end_archive')
         ON CONFLICT (company_id, trade_date) DO UPDATE SET
           open_price  = COALESCE(EXCLUDED.open_price,  daily_prices.open_price),
           high_price  = COALESCE(EXCLUDED.high_price,  daily_prices.high_price),
           low_price   = COALESCE(EXCLUDED.low_price,   daily_prices.low_price),
           close_price = EXCLUDED.close_price,
           volume      = COALESCE(EXCLUDED.volume,      daily_prices.volume),
           source      = EXCLUDED.source,
           fetched_at  = now()`,
        [companyId, row.date, row.open, row.high, row.low, row.close, row.volume],
      )
    }
    await client.query('COMMIT')
    return rows.length
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
