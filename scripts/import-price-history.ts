/**
 * Load historical daily prices from a CSV file.
 *
 *   npx tsx scripts/import-price-history.ts --file=prices.csv [--symbol=SQURPHARMA]
 *                                           [--target=supabase] [--dry-run]
 *
 * The daily job only collects prices from the day it was set up, so the
 * insights that compare a price with its own past need history loaded from
 * somewhere else — a broker terminal, DSE's day-end archive, any site that
 * exports a CSV. Columns are matched by meaning, so most exports work as
 * they come.
 *
 * A day already stored is replaced, so running the same file twice changes
 * nothing. Prices collected by the daily job are never touched unless the
 * file covers the same day.
 */

import { readFileSync } from 'node:fs'

import { Client } from 'pg'

import '../db/pg-types'
import { parsePriceCsv, type PriceRow } from '../lib/price-csv'
import { resolveTarget, sslFor } from './target'

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return match ? match.slice(name.length + 3) : undefined
}

async function main() {
  const file = flag('file')
  if (!file) {
    console.error('Usage: npx tsx scripts/import-price-history.ts --file=prices.csv [--symbol=SYM] [--target=supabase] [--dry-run]')
    process.exit(1)
  }
  const dryRun = process.argv.includes('--dry-run')
  const resolved = resolveTarget()
  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}${dryRun ? '  (dry run)' : ''}\n`)

  const { rows, columns, issues } = parsePriceCsv(readFileSync(file, 'utf8'), flag('symbol')?.toUpperCase())

  console.log(`  read ${rows.length} rows from ${file}`)
  console.log(`  columns: ${Object.entries(columns).map(([heading, field]) => `${heading} → ${field}`).join(', ') || 'none recognised'}`)
  for (const issue of issues) console.log(`  ! ${issue}`)
  if (rows.length === 0) process.exit(1)

  const client = new Client({ connectionString: resolved.connectionString, ssl: sslFor(resolved) })
  await client.connect()

  try {
    const symbols = [...new Set(rows.map((r) => r.symbol).filter((s): s is string => s !== null))]
    const { rows: known } = await client.query<{ id: string; dse_symbol: string }>(
      `SELECT id, dse_symbol FROM companies WHERE dse_symbol = ANY($1::text[])`,
      [symbols],
    )
    const ids = new Map(known.map((c) => [c.dse_symbol, Number(c.id)]))

    const unknown = symbols.filter((s) => !ids.has(s))
    if (unknown.length > 0) {
      console.log(`  ! not in the database, so skipped: ${unknown.join(', ')}`)
    }

    const usable = rows.filter((r) => r.symbol !== null && ids.has(r.symbol))
    const bySymbol = new Map<string, PriceRow[]>()
    for (const row of usable) {
      if (!bySymbol.has(row.symbol!)) bySymbol.set(row.symbol!, [])
      bySymbol.get(row.symbol!)!.push(row)
    }

    for (const [symbol, list] of bySymbol) {
      console.log(`  ${symbol}: ${list.length} days, ${list[0].date} to ${list[list.length - 1].date}`)
    }

    if (dryRun) {
      console.log('\n  dry run — nothing written.\n')
      return
    }

    let written = 0
    await client.query('BEGIN')
    for (const row of usable) {
      await client.query(
        `INSERT INTO daily_prices (company_id, trade_date, open_price, high_price, low_price, close_price, volume, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_id, trade_date) DO UPDATE SET
           open_price  = COALESCE(EXCLUDED.open_price, daily_prices.open_price),
           high_price  = COALESCE(EXCLUDED.high_price, daily_prices.high_price),
           low_price   = COALESCE(EXCLUDED.low_price, daily_prices.low_price),
           close_price = EXCLUDED.close_price,
           volume      = COALESCE(EXCLUDED.volume, daily_prices.volume),
           source      = EXCLUDED.source,
           fetched_at  = now()`,
        [ids.get(row.symbol!), row.date, row.open, row.high, row.low, row.close, row.volume, `csv:${file.split(/[\\/]/).pop()}`],
      )
      written += 1
    }
    await client.query('COMMIT')

    const { rows: coverage } = await client.query<{ dse_symbol: string; days: string; first: string; last: string }>(
      `SELECT c.dse_symbol, count(*)::text AS days, min(p.trade_date)::text AS first, max(p.trade_date)::text AS last
         FROM daily_prices p JOIN companies c ON c.id = p.company_id
        WHERE c.dse_symbol = ANY($1::text[])
        GROUP BY c.dse_symbol ORDER BY c.dse_symbol`,
      [[...bySymbol.keys()]],
    )

    console.log(`\n  wrote ${written} rows. Stored history now:`)
    for (const row of coverage) console.log(`    ${row.dse_symbol}: ${row.days} days, ${row.first} to ${row.last}`)
    console.log()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
