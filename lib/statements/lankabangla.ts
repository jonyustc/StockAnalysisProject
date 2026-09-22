/**
 * Parser for LankaBangla Securities' "Client Wise Portfolio Statement".
 *
 * Works from positioned text items rather than flattened text. Flattening
 * fuses adjacent columns — cost amount "2,903.47" and market price "1,463.80"
 * come out as "2,903.471,463.80", lock and lien quantities as "00" — and a
 * parser built on that would misread exactly the numbers that matter.
 *
 * Every holding is then checked against its own arithmetic before it is
 * accepted. The statement prints enough redundant figures (total quantity is
 * the sum of the parts; value is quantity times price; gain is value less
 * cost) that a misread almost always shows up as a sum that does not add up.
 * A row that fails is reported, never imported.
 */

import { parseReportedNumber } from '../units'
import type {
  DividendReceivable,
  ParseResult,
  ParsedStatement,
  StatementHolding,
  TextItem,
} from './types'

export const FORMAT = 'lankabangla-client-portfolio'

/** Items within this many points vertically are on the same printed line. */
const ROW_TOLERANCE = 2.5

/** DSE trading codes: capitals and digits, occasionally with & or a dash. */
const SYMBOL = /^[A-Z0-9][A-Z0-9&\-.]{1,19}$/

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/** "22-Sep-2026" -> "2026-09-22". */
export function parseStatementDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (!match) return null
  const month = MONTHS[match[2].toLowerCase()]
  if (!month) return null
  const day = match[1].padStart(2, '0')
  if (Number(day) < 1 || Number(day) > 31) return null
  return `${match[3]}-${month}-${day}`
}

interface Row {
  y: number
  page: number
  cells: TextItem[]
  text: string
}

/** Group items into printed lines, top of each page first. */
export function groupRows(items: TextItem[]): Row[] {
  const rows: Row[] = []

  const sorted = items
    .filter((item) => item.str.trim() !== '')
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)

  for (const item of sorted) {
    const row = rows.find((r) => r.page === item.page && Math.abs(r.y - item.y) <= ROW_TOLERANCE)
    if (row) row.cells.push(item)
    else rows.push({ y: item.y, page: item.page, cells: [item], text: '' })
  }

  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x)
    row.cells = row.cells.map((cell) => ({ ...cell, str: cell.str.trim() }))
    row.text = row.cells.map((cell) => cell.str).join(' ')
  }

  return rows.sort((a, b) => a.page - b.page || b.y - a.y)
}

function num(value: string | undefined): number | null {
  return value === undefined ? null : parseReportedNumber(value)
}

/** Within a tolerance that scales with the size of the figures involved. */
function close(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance
}

function checkHolding(h: Omit<StatementHolding, 'issues'>): string[] {
  const issues: string[] = []

  if (h.saleableQty + h.lockQty + h.lienQty !== h.totalQty) {
    issues.push(
      `quantities do not add up: ${h.saleableQty} saleable + ${h.lockQty} lock + ${h.lienQty} lien ≠ ${h.totalQty} total`,
    )
  }

  // Cost price is printed rounded to 2 decimals, so qty x price can miss the
  // exact cost amount by up to half a paisa per share.
  if (!close(h.totalQty * h.costPrice, h.costAmount, h.totalQty * 0.005 + 0.02)) {
    issues.push(`cost amount ${h.costAmount} is not ${h.totalQty} x ${h.costPrice}`)
  }

  if (!close(h.totalQty * h.marketPrice, h.marketValue, 0.05)) {
    issues.push(`market value ${h.marketValue} is not ${h.totalQty} x ${h.marketPrice}`)
  }

  if (!close(h.marketValue - h.costAmount, h.unrealised, 0.05)) {
    issues.push(`unrealised ${h.unrealised} is not value ${h.marketValue} less cost ${h.costAmount}`)
  }

  if (h.totalQty <= 0) issues.push('total quantity is not positive')
  if (!Number.isInteger(h.totalQty)) issues.push('total quantity is not a whole number of shares')

  return issues
}

/** The 13 cells of a holding row, in the order the statement prints them. */
function readHolding(row: Row): StatementHolding | { unreadable: string } {
  const cells = row.cells.map((c) => c.str)

  if (cells.length !== 13) {
    return {
      unreadable: `${cells[0] ?? '?'}: expected 13 columns, found ${cells.length} — "${row.text}"`,
    }
  }

  const [symbol, category, saleable, lock, lien, total, costPrice, costAmount, marketPrice, marketValue, , unrealised] =
    cells

  const values = {
    saleableQty: num(saleable),
    lockQty: num(lock),
    lienQty: num(lien),
    totalQty: num(total),
    costPrice: num(costPrice),
    costAmount: num(costAmount),
    marketPrice: num(marketPrice),
    marketValue: num(marketValue),
    unrealised: num(unrealised),
  }

  const missing = Object.entries(values)
    .filter(([, value]) => value === null)
    .map(([key]) => key)

  if (missing.length > 0) {
    return { unreadable: `${symbol}: could not read ${missing.join(', ')} — "${row.text}"` }
  }

  const holding = {
    symbol,
    category: category || null,
    ...(values as Record<keyof typeof values, number>),
  }

  return { ...holding, issues: checkHolding(holding) }
}

export function isLankaBanglaPortfolio(items: TextItem[]): boolean {
  const text = items.map((i) => i.str).join(' ').toUpperCase()
  return text.includes('LANKABANGLA') && text.includes('PORTFOLIO STATEMENT')
}

export function parseLankaBanglaPortfolio(items: TextItem[]): ParseResult {
  if (!isLankaBanglaPortfolio(items)) {
    return { ok: false, reason: 'Not a LankaBangla client portfolio statement.' }
  }

  const rows = groupRows(items)
  const issues: string[] = []

  const field = (pattern: RegExp) => {
    for (const row of rows) {
      const match = row.text.match(pattern)
      if (match) return match[1].trim()
    }
    return null
  }

  const clientCode = field(/Client Code:\s*(\S+)/)
  const boId = field(/BO ID:\s*(\d{16})\b/)
  const accountType = field(/A\/C Type:\s*(.+?)(?:\s+BP ID:|$)/)

  const asOfRaw = field(/As On:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/)
  const asOf = asOfRaw ? parseStatementDate(asOfRaw) : null

  if (!asOf) {
    return { ok: false, reason: 'Could not find the "As On" date — the statement layout may have changed.' }
  }

  // --- Holdings table: between its header and the "Total:" line ------------

  const headerIndex = rows.findIndex(
    (row) => /\bCompany\b/.test(row.text) && /Saleabl/.test(row.text),
  )
  if (headerIndex < 0) {
    return { ok: false, reason: 'Could not find the holdings table header.' }
  }

  const totalIndex = rows.findIndex((row, i) => i > headerIndex && /^Total:/.test(row.text))

  const holdings: StatementHolding[] = []
  const tableRows = rows.slice(headerIndex + 1, totalIndex < 0 ? undefined : totalIndex)

  for (const row of tableRows) {
    const first = row.cells[0]?.str ?? ''
    // Section labels ("Marginable Securities") and header continuation lines
    // ("Name", "Qty.") are not holdings.
    if (!SYMBOL.test(first) || row.cells.length < 6) continue

    const result = readHolding(row)
    if ('unreadable' in result) issues.push(result.unreadable)
    else holdings.push(result)
  }

  // --- Totals line, cross-checked against the rows --------------------------

  let totals: ParsedStatement['totals'] = null

  if (totalIndex >= 0) {
    const cells = rows[totalIndex].cells.map((c) => c.str).slice(1)
    const [costAmount, marketValue, , unrealised] = cells.map((c) => num(c))

    if (costAmount !== null && marketValue !== null && unrealised !== null) {
      totals = { costAmount, marketValue, unrealised }

      const sum = (pick: (h: StatementHolding) => number) =>
        holdings.reduce((total, h) => total + pick(h), 0)

      if (!close(sum((h) => h.costAmount), costAmount, 0.05 * Math.max(holdings.length, 1))) {
        issues.push(`holdings cost sums to ${sum((h) => h.costAmount).toFixed(2)}, total line says ${costAmount}`)
      }
      if (!close(sum((h) => h.marketValue), marketValue, 0.05 * Math.max(holdings.length, 1))) {
        issues.push(`holdings value sums to ${sum((h) => h.marketValue).toFixed(2)}, total line says ${marketValue}`)
      }
    }
  } else {
    issues.push('No "Total:" line found, so the holdings could not be cross-checked.')
  }

  // --- Cash balance ----------------------------------------------------------

  let cashBalance: number | null = null
  const cashRow = rows.find((row) => /^Cash Balance\b/.test(row.text))
  if (cashRow) {
    const value = cashRow.cells.map((c) => num(c.str)).find((n) => n !== null)
    cashBalance = value ?? null
  }

  // --- Cash dividends declared but not yet paid -------------------------------

  const dividendsReceivable: DividendReceivable[] = []
  const dividendHeader = rows.findIndex(
    (row) => /Cash Entitlemen/.test(row.text) && /Record Dat/.test(row.text),
  )

  if (dividendHeader >= 0) {
    for (const row of rows.slice(dividendHeader + 1)) {
      const cells = row.cells.map((c) => c.str)
      // Each entry starts with a serial number and carries a record date.
      if (!/^\d+$/.test(cells[0] ?? '')) break
      const dateIndex = cells.findIndex((c) => parseStatementDate(c) !== null)
      if (dateIndex < 0) break

      // Serial, company name, type, holding, rate, entitlement, record date.
      const numbers = cells.slice(1, dateIndex).map((c) => num(c))
      const firstNumber = numbers.findIndex((n) => n !== null)
      const [holding, rate, entitlement] = numbers.slice(firstNumber)

      dividendsReceivable.push({
        companyName: cells.slice(1, firstNumber + 1).filter((c) => !/^CASH$/i.test(c)).join(' '),
        holding: holding ?? 0,
        rate: rate ?? 0,
        entitlement: entitlement ?? 0,
        recordDate: parseStatementDate(cells[dateIndex]),
      })
    }
  }

  return {
    ok: true,
    statement: {
      broker: 'LankaBangla Securities',
      format: FORMAT,
      clientCode,
      boId,
      accountType,
      asOf,
      holdings,
      totals,
      cashBalance,
      dividendsReceivable,
      issues,
    },
  }
}
