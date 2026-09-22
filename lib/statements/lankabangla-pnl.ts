/**
 * Parser for LankaBangla's "Client Profit Loss Analysis": per company, shares
 * bought and sold over a period, and the gain the broker books on the sales.
 *
 * Not imported as transactions — the ledger is the record of trades. This is
 * a second opinion: if its buy and sale quantities agree with the ledger's,
 * no trade is missing from the history.
 */

import { parseReportedNumber } from '../units'
import { groupRows } from './lankabangla'
import type { TextItem } from './types'

export const PNL_FORMAT = 'lankabangla-profit-loss'

export interface PnlLine {
  companyName: string
  buyQty: number
  /** Average cost of everything bought in the period, commission included. */
  costPrice: number
  buyAmount: number
  saleQty: number
  salePrice: number
  /** After commission. */
  saleAmount: number
  profit: number
  issues: string[]
}

export interface ParsedPnl {
  broker: string
  format: string
  clientCode: string | null
  boId: string | null
  from: string | null
  to: string | null
  previousGain: number | null
  lines: PnlLine[]
  total: number | null
  issues: string[]
}

export type PnlParseResult = { ok: true; pnl: ParsedPnl } | { ok: false; reason: string }

const num = (value: string | undefined) => (value === undefined ? null : parseReportedNumber(value))
const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}
/** This report prints "1-Jul-2025", without the leading zero. */
function date(value: string): string | null {
  const m = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined
  return m && month ? `${m[3]}-${month}-${m[1].padStart(2, '0')}` : null
}

export function isLankaBanglaPnl(items: TextItem[]): boolean {
  const text = items.map((i) => i.str).join(' ').toUpperCase()
  return text.includes('CLIENT PROFIT LOSS ANALYSIS')
}

export function parseLankaBanglaPnl(items: TextItem[]): PnlParseResult {
  if (!isLankaBanglaPnl(items)) return { ok: false, reason: 'Not a LankaBangla profit/loss analysis.' }

  const rows = groupRows(items)
  const field = (pattern: RegExp) => {
    for (const row of rows) {
      const match = row.text.match(pattern)
      if (match) return match[1].trim()
    }
    return null
  }

  const range = rows
    .map((r) => r.text.match(/Transaction Date\s+(\S+)\s+To\s+(\S+)/))
    .find(Boolean)

  const header = rows.findIndex((r) => /Company Name/.test(r.text) && /Buy Qty/.test(r.text))
  if (header < 0) return { ok: false, reason: 'Could not find the profit/loss table header.' }

  const lines: PnlLine[] = []
  const issues: string[] = []
  let total: number | null = null
  let expectTotal = false

  for (const row of rows.slice(header + 1)) {
    const cells = row.cells.map((c) => c.str)
    if (/^Total\s*:/.test(row.text)) {
      // The figure is printed on the line below.
      total = cells.length > 1 ? num(cells[cells.length - 1]) : null
      expectTotal = total === null
      continue
    }
    if (expectTotal) {
      total = num(cells[cells.length - 1])
      break
    }
    if (cells.length < 8) continue

    const figures = cells.slice(-7).map((c) => num(c))
    const companyName = cells.slice(0, -7).join(' ')
    if (!companyName || figures.some((f) => f === null)) {
      if (companyName) issues.push(`${companyName}: could not read the figures — "${row.text}"`)
      continue
    }

    const [buyQty, costPrice, buyAmount, saleQty, salePrice, saleAmount, profit] = figures as number[]
    const lineIssues: string[] = []
    // Prices are printed rounded; allow half a paisa per share.
    if (!close(buyQty * costPrice, buyAmount, buyQty * 0.005 + 0.02)) lineIssues.push(`buy amount ${buyAmount} is not ${buyQty} × ${costPrice}`)
    if (!close(saleQty * salePrice, saleAmount, saleQty * 0.005 + 0.02)) lineIssues.push(`sale amount ${saleAmount} is not ${saleQty} × ${salePrice}`)
    // Only a closed position can be checked from this table: the broker costs
    // each sale at the running average on its day, which the period's
    // average cost does not show. Closed, the gain is simply out less in.
    if (saleQty === buyQty && !close(saleAmount - buyAmount, profit, 0.05)) {
      lineIssues.push(`profit ${profit} is not sale ${saleAmount} less cost ${buyAmount}`)
    }

    lines.push({ companyName, buyQty, costPrice, buyAmount, saleQty, salePrice, saleAmount, profit, issues: lineIssues })
  }

  if (lines.length === 0) return { ok: false, reason: 'No companies listed in this report.' }

  const sum = lines.reduce((s, l) => s + l.profit, 0)
  if (total === null) issues.push('no total line')
  else if (!close(sum, total, 0.05)) issues.push(`profits add to ${sum.toFixed(2)}, the total says ${total}`)

  return {
    ok: true,
    pnl: {
      broker: 'LankaBangla Securities',
      format: PNL_FORMAT,
      clientCode: field(/Client Code\s*:\s*(\S+)/),
      boId: field(/BO ID\s*:\s*(\d{16})\b/),
      from: range ? date(range[1]) : null,
      to: range ? date(range[2]) : null,
      previousGain: num(field(/Previous Gain\s*:\s*(-?[\d,.]+)/) ?? undefined),
      lines,
      total,
      issues,
    },
  }
}
