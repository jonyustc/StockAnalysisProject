/**
 * Parser for LankaBangla's "Client's Ledger Details" — every movement of cash
 * through the account: trades, deposits, fees, dividends received.
 *
 * It is the account's full history, so it is checked harder than anything
 * else imported. The ledger prints a running balance on every line, which
 * means every single row can be verified against the one before it: opening
 * balance, less debit, plus credit, must equal the balance printed. Then the
 * column totals and the closing balance are checked on top. One misread
 * amount anywhere breaks the chain, and the import is refused.
 */

import { parseReportedNumber } from '../units'
import { groupRows, parseStatementDate, type Row } from './lankabangla'
import type { TextItem } from './types'

export const LEDGER_FORMAT = 'lankabangla-client-ledger'

export type LedgerKind = 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'fee' | 'dividend' | 'ipo' | 'other'

export interface LedgerEntry {
  date: string
  kind: LedgerKind
  /** As printed: "Buy", "Sale", "Receive", "Addition"… */
  label: string
  /** The particulars, continuation lines joined. */
  description: string
  symbol: string | null
  quantity: number | null
  /** Printed rate — rounded; use amount / quantity for the exact price. */
  rate: number | null
  amount: number | null
  commission: number
  debit: number
  credit: number
  balance: number
  issues: string[]
}

export interface ParsedLedger {
  broker: string
  format: string
  clientCode: string | null
  boId: string | null
  accountType: string | null
  from: string
  to: string
  openingBalance: number
  closingBalance: number
  entries: LedgerEntry[]
  totals: { commission: number; debit: number; credit: number } | null
  issues: string[]
}

export type LedgerParseResult = { ok: true; ledger: ParsedLedger } | { ok: false; reason: string }

const SYMBOL = /^[A-Z0-9][A-Z0-9&\-.]{1,19}$/

const num = (value: string | undefined) => (value === undefined ? null : parseReportedNumber(value))
const close = (a: number, b: number, tolerance = 0.011) => Math.abs(a - b) <= tolerance
const round2 = (v: number) => Math.round(v * 100) / 100

export function isLankaBanglaLedger(items: TextItem[]): boolean {
  const text = items.map((i) => i.str).join(' ').toUpperCase()
  return text.includes('LANKABANGLA') && text.includes("CLIENT'S LEDGER DETAILS")
}

/** What a non-trade line is, from its label and particulars. */
export function classify(label: string, description: string, debit: number, credit: number): LedgerKind {
  const text = description.toUpperCase()
  if (/^buy$/i.test(label)) return 'buy'
  if (/^sa(le|ll)$/i.test(label)) return 'sell'
  if (/DIVIDEND/.test(text)) return 'dividend'
  if (/\bIPO\b/.test(text)) return 'ipo'
  if (credit > 0 && debit === 0) return 'deposit'
  if (debit > 0 && credit === 0) {
    if (/FEE|CHARGE|MAINTENANCE|CDBL|EXCISE|DUTY/.test(text)) return 'fee'
    if (/WITHDRAW|PAYMENT|CHEQUE|CHQ|BEFTN|RTGS|NPSB|FUND TRANSFER|PAID TO/.test(text)) return 'withdrawal'
  }
  return 'other'
}

/** The trading code, from particulars split over lines: "SQURPHARM" + "A". */
function symbolFrom(parts: string[]): string | null {
  const joined = parts.join('')
  return SYMBOL.test(joined) ? joined : null
}

export function parseLankaBanglaLedger(items: TextItem[]): LedgerParseResult {
  if (!isLankaBanglaLedger(items)) {
    return { ok: false, reason: "Not a LankaBangla client's ledger." }
  }

  const rows = groupRows(items)
  const field = (pattern: RegExp) => {
    for (const row of rows) {
      const match = row.text.match(pattern)
      if (match) return match[1].trim()
    }
    return null
  }

  const clientCode = field(/Client Code\s*:\s*(\S+)/)
  const boId = field(/BO ID\.?\s*:?\s*(\d{16})\b/)
  const accountType = field(/A\/C Type\s*:\s*(.+?)$/)
  const range = rows
    .map((r) => r.text.match(/From\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+To\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/))
    .find(Boolean)
  const from = range ? parseStatementDate(range[1]) : null
  const to = range ? parseStatementDate(range[2]) : null
  if (!from || !to) return { ok: false, reason: 'Could not find the transaction date range.' }

  const openingRaw = field(/Opening Balance \(TK\.\)\s*:\s*(-?[\d,.]+)/)
  const closingRaw = field(/Closing Balance \(TK\.\)\s*:\s*(-?[\d,.]+)/)
  const openingBalance = num(openingRaw ?? undefined)
  const closingBalance = num(closingRaw ?? undefined)
  if (openingBalance === null) return { ok: false, reason: 'Could not find the opening balance.' }
  if (closingBalance === null) {
    return { ok: false, reason: 'Could not find the closing balance — is the last page missing?' }
  }

  const issues: string[] = []
  const entries: LedgerEntry[] = []
  let particulars: string[] = []
  let current: { row: Row; cells: string[] } | null = null
  let totalsRow: string[] | null = null

  const flush = () => {
    if (!current) return
    const entry = readEntry(current.cells, particulars)
    if ('unreadable' in entry) issues.push(entry.unreadable)
    else entries.push(entry)
    current = null
    particulars = []
  }

  for (const row of rows) {
    const cells = row.cells.map((c) => c.str)
    const date = parseStatementDate(cells[0] ?? '')

    if (date) {
      flush()
      current = { row, cells }
      particulars = [cells[2] ?? '']
      continue
    }

    if (/^Total\s*:/.test(row.text)) {
      flush()
      totalsRow = cells.slice(1)
      continue
    }

    // A wrapped line of particulars: one cell, in the particulars column,
    // on the same page as the entry it continues.
    if (current && row.page === current.row.page && cells.length === 1 && isParticularsColumn(row, current.row)) {
      particulars.push(cells[0])
      continue
    }

    // Anything else — page headers and footers — ends the entry.
    flush()
  }
  flush()

  if (entries.length === 0) return { ok: false, reason: 'No ledger lines found.' }

  // --- The running balance, line by line ------------------------------------
  let balance = openingBalance
  for (const entry of entries) {
    const expected = round2(balance - entry.debit + entry.credit)
    if (!close(expected, entry.balance)) {
      entry.issues.push(
        `balance ${entry.balance} does not follow: ${balance} − ${entry.debit} + ${entry.credit} = ${expected}`,
      )
    }
    balance = entry.balance
  }

  if (!close(balance, closingBalance)) {
    issues.push(`the last balance ${balance} is not the closing balance ${closingBalance}`)
  }

  let totals: ParsedLedger['totals'] = null
  if (totalsRow) {
    const [commission, debit, credit] = (totalsRow as string[]).map((c) => num(c))
    if (commission !== null && debit !== null && credit !== null) {
      totals = { commission, debit, credit }
      const sum = (pick: (e: LedgerEntry) => number) => round2(entries.reduce((s, e) => s + pick(e), 0))
      if (!close(sum((e) => e.commission), commission, 0.05)) {
        issues.push(`commissions add to ${sum((e) => e.commission)}, the total says ${commission}`)
      }
      if (!close(sum((e) => e.debit), debit, 0.05)) issues.push(`debits add to ${sum((e) => e.debit)}, the total says ${debit}`)
      if (!close(sum((e) => e.credit), credit, 0.05)) issues.push(`credits add to ${sum((e) => e.credit)}, the total says ${credit}`)
    } else {
      issues.push('could not read the totals line')
    }
  } else {
    issues.push('no totals line — is the last page missing?')
  }

  return {
    ok: true,
    ledger: {
      broker: 'LankaBangla Securities',
      format: LEDGER_FORMAT,
      clientCode,
      boId,
      accountType,
      from,
      to,
      openingBalance,
      closingBalance,
      entries,
      totals,
      issues,
    },
  }
}

/** Continuation text sits under the particulars cell of its entry. */
function isParticularsColumn(row: Row, entry: Row): boolean {
  const x = entry.cells[2]?.x
  return x !== undefined && Math.abs(row.cells[0].x - x) <= 4
}

/**
 * The column wraps at about ten characters, mid-word: "MAINTENANC" / "E FEE".
 * A full-width fragment with no space in it was cut, so the next one joins
 * without a space. The first part is a payment reference and stands alone.
 */
function joinWrapped(parts: string[]): string {
  return parts.reduce((text, part, i) => {
    if (i === 0) return part
    const previous = parts[i - 1]
    const cut = i > 1 && previous.length >= 9 && !previous.includes(' ')
    return text + (cut ? '' : ' ') + part
  }, '')
}

function readEntry(cells: string[], particulars: string[]): LedgerEntry | { unreadable: string } {
  if (cells.length !== 10) {
    return { unreadable: `${cells[0]}: expected 10 columns, found ${cells.length} — "${cells.join(' ')}"` }
  }

  const [dateRaw, label, , qtyRaw, rateRaw, amountRaw, commRaw, debitRaw, creditRaw, balanceRaw] = cells
  const values = [qtyRaw, rateRaw, amountRaw, commRaw, debitRaw, creditRaw, balanceRaw].map((v) => num(v))
  if (values.some((v) => v === null)) {
    return { unreadable: `${dateRaw} ${label}: a figure could not be read — "${cells.join(' ')}"` }
  }
  const [quantity, rate, amount, commission, debit, credit, balance] = values as number[]

  const isTrade = /^(buy|sale|sell)$/i.test(label)
  const symbol = isTrade ? symbolFrom(particulars) : null
  const description = isTrade ? particulars.join('') : joinWrapped(particulars)
  const kind = classify(label, description, debit, credit)
  const issues: string[] = []

  if (isTrade) {
    if (!symbol) issues.push(`"${description}" is not a trading code`)
    if (!(quantity > 0) || !Number.isInteger(quantity)) issues.push(`quantity ${quantity} is not a whole number of shares`)
    // The rate is printed rounded, so allow half a paisa per share.
    if (!close(quantity * rate, amount, quantity * 0.005 + 0.011)) issues.push(`amount ${amount} is not ${quantity} × ${rate}`)
    if (kind === 'buy' && !close(amount + commission, debit)) issues.push(`debit ${debit} is not amount ${amount} + commission ${commission}`)
    if (kind === 'sell' && !close(amount - commission, credit)) issues.push(`credit ${credit} is not amount ${amount} − commission ${commission}`)
  }
  if (kind === 'other') issues.push(`unrecognised line "${label} ${description}" — not imported`)

  return {
    date: parseStatementDate(dateRaw)!,
    kind,
    label,
    description,
    symbol,
    quantity: isTrade ? quantity : null,
    rate: isTrade ? rate : null,
    amount: isTrade ? amount : null,
    commission,
    debit,
    credit,
    balance,
    issues,
  }
}
