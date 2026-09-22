/**
 * Parser for LankaBangla's "Cash Dividend Receivable Ledger Details" — every
 * cash dividend the account was entitled to, with the tax the company
 * withheld and the date the cash arrived.
 *
 * Two sections. "LBSL (BO A/C)" dividends were paid into the broker account,
 * with tax and net printed. "Other than LBSL" dividends were paid elsewhere —
 * usually straight to the bank account registered with the BO — so the
 * broker prints only the gross.
 */

import { parseReportedNumber } from '../units'
import { groupRows, parseStatementDate } from './lankabangla'
import type { TextItem } from './types'

export const DIVIDEND_FORMAT = 'lankabangla-cash-dividend-ledger'

export interface DividendLine {
  companyName: string
  /** Paid into the broker account, or elsewhere (e.g. directly to the bank). */
  paidVia: 'broker' | 'elsewhere'
  recordDate: string
  /** Of face value: 120% of ৳10 is ৳12 a share. */
  percent: number
  holding: number
  gross: number
  tax: number | null
  net: number | null
  receivedDate: string | null
  issues: string[]
}

export interface ParsedDividendLedger {
  broker: string
  format: string
  clientCode: string | null
  boId: string | null
  from: string | null
  to: string | null
  lines: DividendLine[]
  total: number | null
  issues: string[]
}

export type DividendParseResult =
  | { ok: true; ledger: ParsedDividendLedger }
  | { ok: false; reason: string }

const num = (value: string | undefined) => (value === undefined ? null : parseReportedNumber(value))
const close = (a: number, b: number, tolerance = 0.011) => Math.abs(a - b) <= tolerance

export function isLankaBanglaDividendLedger(items: TextItem[]): boolean {
  const text = items.map((i) => i.str).join(' ').toUpperCase()
  return text.includes('CASH DIVIDEND RECEIVABLE LEDGER')
}

export function parseLankaBanglaDividends(items: TextItem[]): DividendParseResult {
  if (!isLankaBanglaDividendLedger(items)) {
    return { ok: false, reason: 'Not a LankaBangla cash dividend ledger.' }
  }

  const rows = groupRows(items)
  const field = (pattern: RegExp) => {
    for (const row of rows) {
      const match = row.text.match(pattern)
      if (match) return match[1].trim()
    }
    return null
  }

  const range = rows
    .map((r) => r.text.match(/From\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+To\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/))
    .find(Boolean)

  const header = rows.findIndex((r) => /Record Date/.test(r.text) && /Gross/.test(r.text))
  if (header < 0) return { ok: false, reason: 'Could not find the dividend table header.' }

  const lines: DividendLine[] = []
  const issues: string[] = []
  let paidVia: DividendLine['paidVia'] = 'broker'
  let total: number | null = null

  for (const row of rows.slice(header + 1)) {
    const cells = row.cells.map((c) => c.str)

    if (/^Other than/i.test(row.text)) {
      paidVia = 'elsewhere'
      continue
    }
    if (/^LBSL/i.test(row.text)) {
      paidVia = 'broker'
      continue
    }
    if (/^Total\s*:/i.test(row.text)) {
      total = num(cells[cells.length - 1])
      break
    }

    const dateAt = cells.findIndex((c) => parseStatementDate(c) !== null)
    // Section subtotals are figures only; footers carry no record date.
    if (dateAt < 1) continue

    const companyName = cells.slice(0, dateAt).join(' ')
    const rest = cells.slice(dateAt + 1)
    const receivedDate = rest.length > 0 ? parseStatementDate(rest[rest.length - 1]) : null
    const figures = (receivedDate ? rest.slice(0, -1) : rest).map((c) => num(c))

    if (figures.length < 3 || figures.some((f) => f === null)) {
      issues.push(`${companyName}: could not read the figures — "${row.text}"`)
      continue
    }

    const [percent, holding, gross, tax = null, net = null] = figures as number[]
    const lineIssues: string[] = []
    if (tax !== null && net !== null && !close(gross - tax, net)) {
      lineIssues.push(`net ${net} is not gross ${gross} less tax ${tax}`)
    }
    // Gross is holding x percent of a ৳10 face value — true of almost every
    // DSE share. A mismatch is flagged, not fatal: a few have other face values.
    if (!close(holding * percent * 0.1, gross, 0.05)) {
      lineIssues.push(`gross ${gross} is not ${holding} shares at ${percent}% of ৳10 — check the face value`)
    }

    lines.push({
      companyName,
      paidVia,
      recordDate: parseStatementDate(cells[dateAt])!,
      percent,
      holding,
      gross,
      tax,
      net,
      receivedDate,
      issues: lineIssues,
    })
  }

  if (lines.length === 0 && issues.length === 0) {
    return { ok: false, reason: 'No dividends listed in this report.' }
  }

  const sum = lines.reduce((s, l) => s + l.gross, 0)
  if (total === null) issues.push('no total line — is a page missing?')
  else if (!close(sum, total, 0.05)) issues.push(`gross amounts add to ${sum.toFixed(2)}, the total says ${total}`)

  return {
    ok: true,
    ledger: {
      broker: 'LankaBangla Securities',
      format: DIVIDEND_FORMAT,
      clientCode: field(/Client Code\s*:\s*(\S+)/),
      boId: field(/BO ID\.?\s*:?\s*(\d{16})\b/),
      from: range ? parseStatementDate(range[1]) : null,
      to: range ? parseStatementDate(range[2]) : null,
      lines,
      total,
      issues,
    },
  }
}
