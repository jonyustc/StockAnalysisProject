/**
 * Fetch today's closing prices for every tracked company.
 *
 *   npx tsx scripts/fetch-prices.ts [--target=supabase]
 *
 * The same ingestion the scheduled job runs, so a manual run and the cron
 * cannot drift apart.
 */

import { Client } from 'pg'

import '../db/pg-types'
import { ingestDailyPrices } from '../lib/ingest-prices'
import { resolveTarget, sslFor } from './target'

async function main() {
  const resolved = resolveTarget()
  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}\n`)

  const client = new Client({
    connectionString: resolved.connectionString,
    ssl: sslFor(resolved),
  })
  await client.connect()

  try {
    const summary = await ingestDailyPrices(client)

    console.log(`  ${summary.ok ? 'ok  ' : 'FAIL'}  ${summary.message}`)
    console.log(`        ${summary.durationMs} ms`)

    for (const skip of summary.skipped) {
      console.log(`        skipped ${skip.symbol}: ${skip.reason}`)
    }

    if (summary.written > 0) {
      const { rows } = await client.query(
        `SELECT c.dse_symbol, p.trade_date, p.close_price, p.ycp,
                p.yearly_low, p.yearly_high, p.volume
           FROM daily_prices p
           JOIN companies c ON c.id = p.company_id
          WHERE p.trade_date = (SELECT max(trade_date) FROM daily_prices)
          ORDER BY c.dse_symbol`,
      )
      console.log()
      console.table(rows)
    }

    process.exitCode = summary.ok ? 0 : 1
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('\n', error instanceof Error ? error.message : error, '\n')
  process.exit(1)
})
