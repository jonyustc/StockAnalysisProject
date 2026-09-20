/**
 * Backfill Square Pharmaceuticals FY2021-FY2025.
 *
 * PROVENANCE, READ THIS FIRST
 * ---------------------------
 * These figures come from stockanalysis.com, not from Square's annual reports.
 * That makes them a SECONDARY source, so every fact is written with
 * verification = 'unverified' and points at a source document that says plainly
 * where it came from. The intended workflow is: bootstrap here, then open the
 * annual report, check each number, and mark it verified. Nothing in the app
 * treats an unverified figure as settled.
 *
 * Before writing anything, the script re-derives what the data should imply and
 * refuses to insert if it doesn't. Transcribed numbers are exactly the kind of
 * thing that goes subtly wrong, and a financial database with a wrong figure in
 * it is worse than one with a gap.
 *
 *   npx tsx scripts/import-square.ts [--target=supabase]
 */

import { Client } from 'pg'

import '../db/pg-types'
import { fiscalYearBounds } from '../lib/fiscal'
import { resolveTarget, sslFor } from './target'

const SYMBOL = 'SQURPHARMA'
const FISCAL_YEARS = [2021, 2022, 2023, 2024, 2025] as const

/** Amounts in millions BDT; per-share figures as printed. */
const DATA: Record<string, (number | null)[]> = {
  // Income statement
  revenue: [50703, 57598, 60708, 70101, 76288],
  gross_profit: [25233, 28879, 28235, 32553, 35911],
  operating_profit: [15269, 16860, 16690, 17974, 19393],
  net_profit: [15947, 18157, 18980, 20926, 23968],

  // Balance sheet
  cash_and_equivalents: [43364, 48962, 50094, 52013, 55396],
  current_assets: [55076, 62348, 70487, 71206, 74562],
  ppe: [22884, 27183, 26059, 27750, 31687],
  total_assets: [95452, 111758, 121816, 132637, 146815],
  current_liabilities: [3179, 3662, 4229, 5282, 5823],
  total_debt: [103.71, 1914, 1987, 1429, 825.5],
  total_liabilities: [4557, 6555, 6620, 6716, 6860],
  total_equity: [90895, 105203, 115197, 125922, 139956],

  // Cash flow. Capex is negative because that is how a cash flow statement
  // prints an outflow, and figures are stored as printed.
  net_operating_cash_flow: [10976, 12875, 8546, 18529, 17302],
  capex: [-3798, -6183, -2861, -4181, -6177],
  net_investing_cash_flow: [3607, -3970, 787.69, -7049, -3897],
  net_financing_cash_flow: [-3819, -3754, -8762, -9833, -10313],
  dividends_paid: [-3923, -5302, -8803, -9275, -9709],

  // Per share — never scaled
  eps_basic: [17.99, 20.48, 21.41, 23.61, 27.04],
  navps: [102.54, 118.68, 129.95, 142.05, 157.88],
  dividend_per_share: [6.0, 10.0, 10.5, 11.0, 12.0],
}

/** Published values used only to check the import, never stored. */
const PUBLISHED_FCF = [7178, 6692, 5685, 14348, 11125]
const PUBLISHED_ROE_PCT = [18.96, 18.52, 17.22, 17.36, 18.03]

const UNSCALED = new Set(['eps_basic', 'navps', 'dividend_per_share'])

let failures = 0

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

function verifyData() {
  console.log('\nConsistency checks before writing anything\n')

  FISCAL_YEARS.forEach((fy, i) => {
    const assets = DATA.total_assets[i]!
    const equity = DATA.total_equity[i]!
    const liabilities = DATA.total_liabilities[i]!
    const balanceGap = Math.abs(equity + liabilities - assets)

    check(
      `FY${fy} balance sheet balances`,
      balanceGap <= 2,
      `|E+L-A| = ${balanceGap.toFixed(2)}`,
    )

    const fcf = DATA.net_operating_cash_flow[i]! + DATA.capex[i]!
    check(
      `FY${fy} OCF + capex reproduces published FCF`,
      Math.abs(fcf - PUBLISHED_FCF[i]) < 1,
      `${fcf} vs ${PUBLISHED_FCF[i]}`,
    )

    // Share count derived two independent ways must agree, which cross-checks
    // net profit, EPS, equity and NAVPS all at once.
    const sharesFromEps = (DATA.net_profit[i]! * 1_000_000) / DATA.eps_basic[i]!
    const sharesFromNavps = (DATA.total_equity[i]! * 1_000_000) / DATA.navps[i]!
    const drift = Math.abs(sharesFromEps - sharesFromNavps) / sharesFromNavps

    check(
      `FY${fy} share count agrees from EPS and NAVPS`,
      drift < 0.005,
      `${(sharesFromEps / 1e6).toFixed(1)}M vs ${(sharesFromNavps / 1e6).toFixed(1)}M`,
    )

    check(
      `FY${fy} subtotals ordered`,
      DATA.gross_profit[i]! <= DATA.revenue[i]! &&
        DATA.operating_profit[i]! <= DATA.gross_profit[i]! &&
        DATA.current_assets[i]! <= DATA.total_assets[i]!,
    )

    if (i > 0) {
      const avgEquity = (DATA.total_equity[i - 1]! + DATA.total_equity[i]!) / 2
      const roe = (DATA.net_profit[i]! / avgEquity) * 100
      check(
        `FY${fy} recomputed ROE matches published`,
        Math.abs(roe - PUBLISHED_ROE_PCT[i]) < 0.05,
        `${roe.toFixed(2)}% vs ${PUBLISHED_ROE_PCT[i]}%`,
      )
    }
  })
}

async function main() {
  const resolved = resolveTarget()
  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}`)

  verifyData()

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed. Nothing was written.\n`)
    process.exit(1)
  }

  const client = new Client({
    connectionString: resolved.connectionString,
    ssl: sslFor(resolved),
  })
  await client.connect()

  try {
    await client.query('BEGIN')

    const { rows: companyRows } = await client.query<{
      id: string
      fiscal_year_end_month: number
      fiscal_year_end_day: number
    }>(
      'SELECT id, fiscal_year_end_month, fiscal_year_end_day FROM companies WHERE dse_symbol = $1',
      [SYMBOL],
    )
    if (companyRows.length === 0) throw new Error(`${SYMBOL} not found — run the seed first.`)

    const company = companyRows[0]
    const fye = {
      month: company.fiscal_year_end_month,
      day: company.fiscal_year_end_day,
    }

    const { rows: docRows } = await client.query<{ id: string }>(
      `INSERT INTO source_documents (company_id, doc_type, title, source_url, notes)
       VALUES ($1, 'other', $2, $3, $4)
       RETURNING id`,
      [
        company.id,
        'stockanalysis.com — SQURPHARMA financial statements (secondary source)',
        'https://stockanalysis.com/quote/dse/SQURPHARMA/financials/',
        'Bootstrap import. SECONDARY source, not the annual report. Every fact from this document is unverified until checked against Square Pharma\'s published annual report and marked verified.',
      ],
    )
    const documentId = docRows[0].id

    const { rows: itemRows } = await client.query<{ id: number; tag: string }>(
      'SELECT id, tag FROM line_item_defs',
    )
    const itemIdByTag = new Map(itemRows.map((row) => [row.tag, row.id]))

    let written = 0

    for (const [index, fiscalYear] of FISCAL_YEARS.entries()) {
      const bounds = fiscalYearBounds(fye, fiscalYear)

      const { rows: periodRows } = await client.query<{ id: string }>(
        `INSERT INTO fiscal_periods
           (company_id, fiscal_year, period_type, basis, period_start, period_end,
            months_covered, audit_status, source_document_id, is_complete, notes)
         VALUES ($1, $2, 'annual', 'consolidated', $3, $4, 12, 'audited', $5, false, $6)
         ON CONFLICT (company_id, fiscal_year, period_type, basis)
         DO UPDATE SET source_document_id = EXCLUDED.source_document_id,
                       notes = EXCLUDED.notes
         RETURNING id`,
        [
          company.id,
          fiscalYear,
          bounds.start,
          bounds.end,
          documentId,
          'Imported from a secondary source; figures unverified against the annual report.',
        ],
      )
      const periodId = periodRows[0].id

      for (const [tag, values] of Object.entries(DATA)) {
        const value = values[index]
        if (value === null || value === undefined) continue

        const lineItemId = itemIdByTag.get(tag)
        if (!lineItemId) throw new Error(`No line item with tag "${tag}"`)

        await client.query(
          `INSERT INTO financial_facts
             (period_id, line_item_id, value_reported, scale, revision, is_current,
              source_document_id, verification)
           VALUES ($1, $2, $3, $4, 1, true, $5, 'unverified')
           ON CONFLICT (period_id, line_item_id, revision)
           DO UPDATE SET value_reported = EXCLUDED.value_reported,
                         scale = EXCLUDED.scale,
                         source_document_id = EXCLUDED.source_document_id`,
          [periodId, lineItemId, value, UNSCALED.has(tag) ? 'unit' : 'million', documentId],
        )
        written += 1
      }
    }

    await client.query('COMMIT')
    console.log(`\nWrote ${written} facts across ${FISCAL_YEARS.length} fiscal years.`)
    console.log('All marked unverified — check them against the annual report.\n')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('\n', error instanceof Error ? error.message : error, '\n')
  process.exit(1)
})
