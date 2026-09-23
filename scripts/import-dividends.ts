/**
 * Load a company's declared cash dividends from a saved table.
 *
 *   npx tsx scripts/import-dividends.ts --file=dividends.html --symbol=SQURPHARMA
 *                                       [--target=supabase] [--dry-run]
 *
 * The same reader the paste box on the import page uses, for when the table
 * has been saved to a file — or when the rows are already in one database and
 * the other needs them too. HTML copied from a page, a CSV, or tab-separated
 * text all read alike.
 *
 * A dividend already stored for an ex-date is updated rather than repeated,
 * so running the same file twice changes nothing. Cash dividends restate no
 * price and no per-share figure: their adjustment factor is 1.
 */

import { readFileSync } from 'node:fs'

import { Client } from 'pg'

import '../db/pg-types'
import { parseDividendTable, percentOfFace } from '../lib/dividend-table'
import { resolveTarget, sslFor } from './target'

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  if (match) return match.slice(name.length + 3)

  // Run without the -- (npm run dividends --file=x), npm turns the flag into
  // an npm_config_* variable instead of passing it on.
  const fromNpm = process.env[`npm_config_${name}`]
  return fromNpm && fromNpm !== 'true' ? fromNpm : undefined
}

async function main() {
  const file = flag('file')
  const symbol = flag('symbol')?.toUpperCase()
  if (!file || !symbol) {
    console.error('Usage: npx tsx scripts/import-dividends.ts --file=dividends.html --symbol=SYM [--target=supabase] [--dry-run]')
    process.exit(1)
  }

  const dryRun = process.argv.includes('--dry-run')
  const resolved = resolveTarget()
  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}${dryRun ? '  (dry run)' : ''}\n`)

  const { rows, columns, issues } = parseDividendTable(readFileSync(file, 'utf8'))
  console.log(`  read ${rows.length} dividends from ${file}`)
  console.log(`  columns: ${Object.entries(columns).map(([heading, field]) => `${heading} → ${field}`).join(', ') || 'none recognised'}`)
  for (const issue of issues) console.log(`  ! ${issue}`)
  if (rows.length === 0) process.exit(1)

  const client = new Client({ connectionString: resolved.connectionString, ssl: sslFor(resolved) })
  await client.connect()

  try {
    const { rows: found } = await client.query<{ id: string; face_value: string }>(
      `SELECT id, face_value FROM companies WHERE dse_symbol = $1`,
      [symbol],
    )
    if (found.length === 0) {
      console.log(`\n  ! ${symbol} is not in this database — nothing written.\n`)
      process.exit(1)
    }
    const companyId = Number(found[0].id)
    const faceValue = Number(found[0].face_value)

    console.log(`  ${symbol}: ${rows[rows.length - 1].exDate} to ${rows[0].exDate}`)
    if (dryRun) {
      console.log('\n  dry run — nothing written.\n')
      return
    }

    let added = 0
    let updated = 0
    await client.query('BEGIN')
    for (const row of rows) {
      const notes =
        `From ${file.split(/[\\/]/).pop()}.` +
        (row.looksAdjusted
          ? ' The figure carries more decimals than a declared dividend can, so that source had' +
            ' restated it for later bonus issues — treat it as approximate.'
          : '')

      const { rows: written } = await client.query<{ inserted: boolean }>(
        `INSERT INTO corporate_actions
           (company_id, action_type, ex_date, adjustment_factor, cash_per_share, cash_dividend_pct, payment_date, notes, verification)
         VALUES ($1, 'cash_dividend', $2, 1, $3, $4, $5, $6, 'unverified')
         ON CONFLICT (company_id, action_type, ex_date) DO UPDATE SET
           cash_per_share    = EXCLUDED.cash_per_share,
           cash_dividend_pct = EXCLUDED.cash_dividend_pct,
           payment_date      = EXCLUDED.payment_date,
           notes             = EXCLUDED.notes
         RETURNING (xmax = 0) AS inserted`,
        // Figures go over as decimal text. Sent as doubles they arrive a
        // fraction either side of what they should be, and a column of four
        // decimals rounds that fraction into the last place.
        [
          companyId,
          row.exDate,
          String(row.amount),
          percentOfFace(row.amount, faceValue),
          row.paymentDate,
          notes,
        ],
      )
      if (written[0]?.inserted) added += 1
      else updated += 1
    }
    await client.query('COMMIT')

    const { rows: coverage } = await client.query<{ count: string; first: string; last: string }>(
      `SELECT count(*)::text AS count, min(ex_date)::text AS first, max(ex_date)::text AS last
         FROM corporate_actions WHERE company_id = $1 AND action_type = 'cash_dividend'`,
      [companyId],
    )

    console.log(`\n  ${added} added, ${updated} updated.`)
    console.log(`  ${symbol} now has ${coverage[0].count} dividends on record, ${coverage[0].first} to ${coverage[0].last}.\n`)
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
