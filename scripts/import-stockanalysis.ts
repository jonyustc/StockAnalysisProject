/**
 * Bootstrap import for every company with a dataset.
 *
 *   npx tsx scripts/import-stockanalysis.ts [--symbol=MARICO] [--target=supabase]
 *
 * These are SECONDARY figures, from stockanalysis.com rather than the
 * companies' own filings, so every fact is written unverified and points at a
 * source document that says so.
 *
 * Nothing is written until the numbers re-derive correctly. The checks split
 * into two kinds, and the distinction matters:
 *
 *   HARD  — arithmetic that cannot legitimately fail. A balance sheet that
 *           does not balance means the transcription is wrong. These block
 *           the import.
 *
 *   SOFT  — a share count that moves between years. This is not an error; it
 *           is a bonus issue, rights issue or split, and it is exactly why
 *           corporate_actions exists. It does not block the import, but the
 *           company's per-share history is NOT comparable across that break
 *           until the action is recorded, so it is flagged loudly and written
 *           into the company's notes.
 */

import { Client } from 'pg'

import '../db/pg-types'
import { fiscalYearBounds } from '../lib/fiscal'
import { DATASETS, UNSCALED_TAGS, type Dataset } from './data/stockanalysis'
import { resolveTarget, sslFor } from './target'

const SOURCE_TITLE = 'stockanalysis.com financial statements (secondary source)'
const SOURCE_URL = 'https://stockanalysis.com/quote/dse/'

/** Rounding in the source means exact equality is not available. */
const BALANCE_TOLERANCE = 2
const FCF_TOLERANCE = 2
const SHARE_DRIFT_TOLERANCE = 0.005

interface Verdict {
  hardFailures: string[]
  /**
   * A year whose EPS implies a different share count than its NAVPS does.
   * Almost always means EPS is stated on a pre-issue base while the balance
   * sheet is post-issue — i.e. a bonus or rights issue sits on that boundary.
   *
   * Counts are in millions, because the source's amounts are.
   */
  shareBreaks: { fiscalYear: number; fromEps: number; fromNavps: number }[]
}

function verify(symbol: string, set: Dataset): Verdict {
  const hardFailures: string[] = []
  const shareBreaks: Verdict['shareBreaks'] = []
  const { data, fiscalYears, published } = set

  const at = (tag: string, i: number) => data[tag]?.[i] ?? null

  fiscalYears.forEach((fy, i) => {
    const equity = at('total_equity', i)
    const liabilities = at('total_liabilities', i)
    const assets = at('total_assets', i)

    if (equity !== null && liabilities !== null && assets !== null) {
      const gap = Math.abs(equity + liabilities - assets)
      if (gap > BALANCE_TOLERANCE) {
        hardFailures.push(`${symbol} FY${fy}: balance sheet off by ${gap.toFixed(2)}`)
      }
    }

    const ocf = at('net_operating_cash_flow', i)
    const capex = at('capex', i)
    if (ocf !== null && capex !== null && published.fcf[i] !== undefined) {
      const gap = Math.abs(ocf + capex - published.fcf[i])
      if (gap > FCF_TOLERANCE) {
        hardFailures.push(
          `${symbol} FY${fy}: OCF + capex = ${(ocf + capex).toFixed(2)}, source says ${published.fcf[i]}`,
        )
      }
    }

    const revenue = at('revenue', i)
    const gross = at('gross_profit', i)
    const operating = at('operating_profit', i)
    if (revenue !== null && gross !== null && gross > revenue) {
      hardFailures.push(`${symbol} FY${fy}: gross profit exceeds revenue`)
    }
    if (gross !== null && operating !== null && operating > gross) {
      hardFailures.push(`${symbol} FY${fy}: operating profit exceeds gross profit`)
    }

    if (published.roePct?.[i] !== undefined && i > 0) {
      const previousEquity = at('total_equity', i - 1)
      const profit = at('net_profit', i)
      if (previousEquity !== null && equity !== null && profit !== null) {
        const roe = (profit / ((previousEquity + equity) / 2)) * 100
        if (Math.abs(roe - published.roePct[i]) > 0.05) {
          hardFailures.push(
            `${symbol} FY${fy}: recomputed ROE ${roe.toFixed(2)}% vs published ${published.roePct[i]}%`,
          )
        }
      }
    }

    // Share count, derived two independent ways. They agree only if net
    // profit, EPS, equity and NAVPS are all consistent with one share base.
    const profit = at('net_profit', i)
    const eps = at('eps_basic', i)
    const equityValue = equity
    const navps = at('navps', i)

    if (profit !== null && eps !== null && eps !== 0 && equityValue !== null && navps) {
      const fromEps = profit / eps
      const fromNavps = equityValue / navps
      const drift = Math.abs(fromEps - fromNavps) / fromNavps

      if (drift > SHARE_DRIFT_TOLERANCE) {
        shareBreaks.push({ fiscalYear: fy, fromEps, fromNavps })
      }
    }
  })

  return { hardFailures, shareBreaks }
}

async function importCompany(
  client: Client,
  symbol: string,
  set: Dataset,
  shareBreaks: Verdict['shareBreaks'],
): Promise<number> {
  const { rows: companyRows } = await client.query<{
    id: string
    fiscal_year_end_month: number
    fiscal_year_end_day: number
  }>(
    'SELECT id, fiscal_year_end_month, fiscal_year_end_day FROM companies WHERE dse_symbol = $1',
    [symbol],
  )
  if (companyRows.length === 0) throw new Error(`${symbol} not found — run the seed first.`)

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
      `${SOURCE_TITLE} — ${symbol}`,
      `${SOURCE_URL}${symbol}/financials/`,
      'Bootstrap import. Unverified until checked against the annual report.',
    ],
  )
  const documentId = docRows[0].id

  const { rows: itemRows } = await client.query<{ id: number; tag: string }>(
    'SELECT id, tag FROM line_item_defs',
  )
  const itemIdByTag = new Map(itemRows.map((row) => [row.tag, row.id]))

  let written = 0

  for (const [index, fiscalYear] of set.fiscalYears.entries()) {
    const bounds = fiscalYearBounds(fye, fiscalYear)

    const { rows: periodRows } = await client.query<{ id: string }>(
      `INSERT INTO fiscal_periods
         (company_id, fiscal_year, period_type, basis, period_start, period_end,
          months_covered, audit_status, source_document_id, is_complete, notes)
       VALUES ($1,$2,'annual','consolidated',$3,$4,12,'audited',$5,false,$6)
       ON CONFLICT (company_id, fiscal_year, period_type, basis)
       DO UPDATE SET source_document_id = EXCLUDED.source_document_id, notes = EXCLUDED.notes
       RETURNING id`,
      [
        company.id,
        fiscalYear,
        bounds.start,
        bounds.end,
        documentId,
        'Secondary source; unverified against the annual report.',
      ],
    )
    const periodId = periodRows[0].id

    for (const [tag, values] of Object.entries(set.data)) {
      const value = values[index]
      if (value === null || value === undefined) continue

      const lineItemId = itemIdByTag.get(tag)
      if (!lineItemId) throw new Error(`No line item with tag "${tag}"`)

      await client.query(
        `INSERT INTO financial_facts
           (period_id, line_item_id, value_reported, scale, revision, is_current,
            source_document_id, verification)
         VALUES ($1,$2,$3,$4,1,true,$5,'unverified')
         ON CONFLICT (period_id, line_item_id, revision)
         DO UPDATE SET value_reported = EXCLUDED.value_reported,
                       scale = EXCLUDED.scale,
                       source_document_id = EXCLUDED.source_document_id`,
        [periodId, lineItemId, value, UNSCALED_TAGS.has(tag) ? 'unit' : 'million', documentId],
      )
      written += 1
    }
  }

  if (shareBreaks.length > 0) {
    const note =
      `share count changed around ${shareBreaks
        .map((b) => `FY${b.fiscalYear}`)
        .join(', ')} — EPS implies ${shareBreaks
        .map((b) => `${b.fromEps.toFixed(2)}M`)
        .join('/')} shares while NAVPS implies ${shareBreaks
        .map((b) => `${b.fromNavps.toFixed(2)}M`)
        .join('/')}. The corporate action behind it is not yet recorded, so EPS growth and EPS CAGR across that break are not trustworthy.`

    await client.query(
      `UPDATE companies
          SET notes = COALESCE(notes || ' ', '') || $2
        WHERE id = $1 AND COALESCE(notes, '') NOT LIKE '%share count changed%'`,
      [company.id, note],
    )
  }

  return written
}

async function main() {
  const resolved = resolveTarget()
  const only = process.argv
    .find((arg) => arg.startsWith('--symbol='))
    ?.split('=')[1]
    ?.toUpperCase()

  const symbols = only ? [only] : Object.keys(DATASETS)

  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}`)
  console.log(`companies: ${symbols.join(', ')}\n`)

  const verdicts = new Map<string, Verdict>()
  const allHardFailures: string[] = []

  for (const symbol of symbols) {
    const set = DATASETS[symbol]
    if (!set) {
      console.error(`  no dataset for ${symbol}`)
      process.exit(1)
    }

    const verdict = verify(symbol, set)
    verdicts.set(symbol, verdict)
    allHardFailures.push(...verdict.hardFailures)

    const status = verdict.hardFailures.length > 0 ? 'FAIL' : 'ok  '
    console.log(
      `  ${status}  ${symbol.padEnd(11)} ${set.fiscalYears.length} years, ` +
        `${Object.keys(set.data).length} line items` +
        (verdict.shareBreaks.length > 0 ? `  [${verdict.shareBreaks.length} share break]` : ''),
    )

    for (const failure of verdict.hardFailures) console.log(`          ${failure}`)
    for (const bad of verdict.shareBreaks) {
      console.log(
        `          FY${bad.fiscalYear}: EPS implies ${bad.fromEps.toFixed(2)}M shares, ` +
          `NAVPS implies ${bad.fromNavps.toFixed(2)}M ` +
          `(${(((bad.fromNavps - bad.fromEps) / bad.fromEps) * 100).toFixed(1)}%) ` +
          `— corporate action needed before EPS growth is trustworthy`,
      )
    }
  }

  if (allHardFailures.length > 0) {
    console.error(`\n${allHardFailures.length} hard check(s) failed. Nothing written.\n`)
    process.exit(1)
  }

  const client = new Client({
    connectionString: resolved.connectionString,
    ssl: sslFor(resolved),
  })
  await client.connect()

  try {
    await client.query('BEGIN')

    let total = 0
    for (const symbol of symbols) {
      total += await importCompany(
        client,
        symbol,
        DATASETS[symbol],
        verdicts.get(symbol)!.shareBreaks,
      )
    }

    await client.query('COMMIT')
    console.log(`\nWrote ${total} facts across ${symbols.length} companies.`)
    console.log('All unverified — check against the annual reports before relying on them.\n')
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
