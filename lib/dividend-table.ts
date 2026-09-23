/**
 * Reading a company's dividend history out of a pasted table.
 *
 * Sites list dividends by ex-date, with the amount per share and usually a
 * payment date. Two things need saying about what arrives:
 *
 *   - Some sites restate old dividends onto today's share base, so a ৳3.50
 *     dividend from before a bonus issue appears as 3.20427236. DSE quotes
 *     dividends as whole percentages of face value, so a figure with a long
 *     tail of decimals has been adjusted, and is flagged rather than stored
 *     as though the company had declared it.
 *   - A dividend of nothing is not a dividend; those rows are dropped.
 */

import { cleanCell, parseCell, parseDate } from './price-csv'
import { pastedTable } from './table'

export interface DividendRow {
  exDate: string
  /** Per share, as the table gave it. */
  amount: number
  paymentDate: string | null
  /** "12M", "Annual", "Interim" — as printed, when the table says. */
  kind: string | null
  /** True when the figure carries more precision than a declared dividend can. */
  looksAdjusted: boolean
}

export interface ParsedDividends {
  rows: DividendRow[]
  columns: Record<string, string>
  issues: string[]
}

const ALIASES = {
  exDate: ['ex-dividend date', 'ex dividend date', 'ex date', 'ex-date', 'exdate', 'ex'],
  amount: ['dividend', 'cash dividend', 'amount', 'dividend per share', 'dps', 'dividend amount', 'rate'],
  paymentDate: ['payment date', 'pay date', 'paid on', 'payable', 'payment'],
  kind: ['type', 'frequency', 'kind'],
} as const

const normalise = (heading: string) => cleanCell(heading).toLowerCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A declared dividend on DSE is a percentage of face value — 120% of ৳10 is
 * ৳12.00 — so it lands on a whole paisa. More decimals than that means the
 * figure has been restated for a later bonus issue.
 */
export function looksAdjusted(amount: number): boolean {
  return Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-9
}

/**
 * A dividend as the percentage of face value DSE announces it as — ৳12.00 on
 * a ৳10 share is 120%.
 *
 * Given back as decimal text, fixed at six places. Worked out in doubles and
 * handed over as a bare number, a dividend of 0.123455 on a ৳10 share comes
 * to 1.2345499999999998 rather than 1.23455, and a column holding four
 * decimals then rounds it down where the exact figure rounds up. Six places
 * is past anything a dividend is declared to and short of where that drift
 * lives.
 */
export function percentOfFace(amount: number, faceValue: number): string | null {
  if (!Number.isFinite(amount) || !Number.isFinite(faceValue) || faceValue <= 0) return null
  return ((amount / faceValue) * 100).toFixed(6)
}

export function parseDividendTable(text: string): ParsedDividends {
  const table = pastedTable(text)
  if (table.length === 0) return { rows: [], columns: {}, issues: ['Nothing that looks like a table was pasted.'] }

  const headings = table[0].map(normalise)
  const index: Partial<Record<keyof typeof ALIASES, number>> = {}
  const columns: Record<string, string> = {}

  for (const [field, aliases] of Object.entries(ALIASES) as [keyof typeof ALIASES, readonly string[]][]) {
    for (const alias of aliases) {
      const at = headings.findIndex((h) => h === alias)
      if (at >= 0) {
        index[field] = at
        columns[cleanCell(table[0][at])] = field
        break
      }
    }
  }

  const issues: string[] = []
  const hasHeadings = index.exDate !== undefined && index.amount !== undefined
  // A paste of rows alone — no heading row — is the usual shape when someone
  // copies part of a page: then the first date column and the first number
  // after it are the ex-date and the dividend.
  const body = hasHeadings ? table.slice(1) : table

  if (!hasHeadings) {
    issues.push('No headings found, so the first date in each row was read as the ex-date and the first amount after it as the dividend.')
  }

  const rows: DividendRow[] = []
  const seen = new Set<string>()
  let unreadable = 0
  let zero = 0

  for (const cells of body) {
    let exDate: string | null = null
    let amount: number | null = null
    let paymentDate: string | null = null
    let kind: string | null = null

    if (hasHeadings) {
      exDate = parseDate(cells[index.exDate!] ?? '')
      amount = parseCell(cells[index.amount!] ?? '')
      paymentDate = index.paymentDate === undefined ? null : parseDate(cells[index.paymentDate] ?? '')
      kind = index.kind === undefined ? null : cleanCell(cells[index.kind] ?? '') || null
    } else {
      const dates = cells.map((cell) => parseDate(cell))
      const firstDate = dates.findIndex((d) => d !== null)
      if (firstDate >= 0) {
        exDate = dates[firstDate]
        paymentDate = dates.slice(firstDate + 1).find((d) => d !== null) ?? null
        const after = cells.slice(firstDate + 1).map(parseCell)
        amount = after.find((value) => value !== null && value > 0) ?? null
      }
    }

    if (!exDate || amount === null) {
      unreadable += 1
      if (unreadable <= 3) issues.push(`Could not read "${cells.join(' | ').slice(0, 70)}".`)
      continue
    }
    if (amount <= 0) {
      zero += 1
      continue
    }
    if (seen.has(exDate)) continue
    seen.add(exDate)

    rows.push({ exDate, amount, paymentDate, kind, looksAdjusted: looksAdjusted(amount) })
  }

  if (rows.length === 0) {
    return {
      rows: [],
      columns,
      issues: [
        'No dividends could be read from that. A row needs a date and an amount — paste the table with its headings, or the rows themselves.',
      ],
    }
  }

  if (unreadable > 3) issues.push(`…and ${unreadable - 3} more rows that could not be read.`)
  if (zero > 0) issues.push(`${zero} row${zero === 1 ? '' : 's'} had no dividend amount and ${zero === 1 ? 'was' : 'were'} left out.`)

  rows.sort((a, b) => (a.exDate < b.exDate ? 1 : -1))

  const adjusted = rows.filter((r) => r.looksAdjusted)
  if (adjusted.length > 0) {
    issues.push(
      `${adjusted.length} older dividend${adjusted.length === 1 ? '' : 's'} (${adjusted[0].exDate} and earlier) ` +
        'carry more decimals than a declared dividend can, so that source has restated them for later bonus issues. ' +
        'They are kept, marked as restated — a dividend DSE announced would be a round percentage of face value.',
    )
  }

  return { rows, columns, issues }
}
