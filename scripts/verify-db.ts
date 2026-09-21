/**
 * Smoke test for whichever database DIRECT_URL points at.
 *
 * Checks that the schema applied, the seed loaded, the generated column
 * computes, dates survive the round trip unshifted, and the one-current-
 * revision guard holds. Everything it writes is rolled back.
 *
 * Run it again after pointing at Supabase — a schema that works locally can
 * still differ in the cloud.
 */

import { Client } from 'pg'

import '../db/pg-types'
import { fiscalYearBounds } from '../lib/fiscal'
import { resolveTarget, sslFor } from './target'

/** No real period will ever carry this year, so the test cannot touch live data. */
const SENTINEL_FISCAL_YEAR = 1900

const resolved = resolveTarget()

const client = new Client({
  connectionString: resolved.connectionString,
  ssl: sslFor(resolved),
})

async function main() {
  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}\n`)
  await client.connect()

  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM sectors)         AS sectors,
      (SELECT count(*) FROM companies)       AS companies,
      (SELECT count(*) FROM line_item_defs)  AS line_items,
      (SELECT count(*) FROM metric_defs)     AS metrics,
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public')       AS tables
  `)
  console.log('counts:', counts.rows[0])

  const companies = await client.query(`
    SELECT c.dse_symbol, c.short_name, s.name AS sector,
           c.fiscal_year_end_month AS fye_m, c.fiscal_year_end_day AS fye_d
    FROM companies c LEFT JOIN sectors s ON s.id = c.sector_id
    ORDER BY c.dse_symbol
  `)
  console.table(companies.rows)

  // Round-trip a real figure: Marico's FY2026 revenue of 20,712 as printed in
  // a "Taka in million" statement — but filed under a sentinel fiscal year, so
  // it cannot collide with a real period. Using a live year worked only while
  // the database was empty; once Marico FY2026 was imported this failed on the
  // unique index, and had the insert succeeded the cleanup would have deleted
  // genuine data.
  await client.query('BEGIN')

  const { start, end } = fiscalYearBounds({ month: 3, day: 31 }, SENTINEL_FISCAL_YEAR)

  const period = await client.query(
    `INSERT INTO fiscal_periods (company_id, fiscal_year, period_start, period_end)
     VALUES ((SELECT id FROM companies WHERE dse_symbol = 'MARICO'), $3, $1, $2)
     RETURNING id, period_start, period_end`,
    [start, end, SENTINEL_FISCAL_YEAR],
  )
  const stored = period.rows[0]
  const datesIntact = stored.period_start === start && stored.period_end === end
  console.log(
    `period: ${stored.period_start} .. ${stored.period_end}`,
    datesIntact
      ? '— ok, no timezone shift'
      : `— FAILED, expected ${start} .. ${end} (DATE parser not applied?)`,
  )

  const fact = await client.query(
    `INSERT INTO financial_facts (period_id, line_item_id, value_reported, scale)
     VALUES ($1, (SELECT id FROM line_item_defs WHERE tag = 'revenue'), 20712, 'million')
     RETURNING value_reported, scale, value_base`,
    [period.rows[0].id],
  )
  console.log('fact:', fact.rows[0])

  // The partial unique index must reject a second current revision.
  try {
    await client.query(
      `INSERT INTO financial_facts (period_id, line_item_id, value_reported, scale, revision)
       VALUES ($1, (SELECT id FROM line_item_defs WHERE tag = 'revenue'), 99999, 'million', 2)`,
      [period.rows[0].id],
    )
    console.log('duplicate-current guard: FAILED — second current revision allowed')
  } catch (error) {
    console.log(
      'duplicate-current guard: ok —',
      (error as Error).message.split('\n')[0],
    )
  }

  await client.query('ROLLBACK')

  const after = await client.query(
    'SELECT count(*)::int AS n FROM fiscal_periods WHERE fiscal_year = $1',
    [SENTINEL_FISCAL_YEAR],
  )
  console.log(
    'rollback:',
    after.rows[0].n === 0 ? 'ok — nothing left behind' : `FAILED — ${after.rows[0].n} row(s) remain`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => client.end())
