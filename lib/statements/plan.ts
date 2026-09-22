/**
 * What importing a broker ledger, dividend report or profit/loss report would
 * change — worked out before anything is written, so the preview can show it
 * and the apply step can do exactly that and nothing else.
 */

import { alreadyRecorded, matchCompany, type CompanyName } from '../dividends'
import { buildHolding, type PortfolioTransaction } from '../portfolio'
import type { ParsedDividendLedger } from './lankabangla-dividends'
import type { LedgerKind, ParsedLedger } from './lankabangla-ledger'
import type { ParsedPnl } from './lankabangla-pnl'

type Existing = PortfolioTransaction & { id?: number; notes?: string | null }

export interface PlannedTrade {
  date: string
  txnType: 'buy' | 'sell'
  symbol: string
  quantity: number
  /** Exact: the broker's amount over quantity, not the rounded printed rate. */
  pricePerShare: number
  commission: number
}

export interface PlannedCash {
  date: string
  kind: Exclude<LedgerKind, 'buy' | 'sell'>
  /** Signed: positive into the account. */
  amount: number
  description: string
}

export interface LedgerPlan {
  from: string
  to: string
  trades: PlannedTrade[]
  cash: PlannedCash[]
  /**
   * Existing buys and sells in the period that the ledger replaces: rows an
   * earlier import wrote, and hand-entered rows that match a ledger trade.
   */
  replaced: (Existing & { reason: string })[]
  /**
   * Hand-entered buys and sells in the period with no matching ledger trade.
   * Kept unless the person chooses to remove them: they may be an IPO
   * allotment or a transfer in, which a cash ledger does not list as a trade.
   */
  keptManual: Existing[]
  /** Shares per stock before and after, for every stock either touches. */
  holdings: { symbol: string; before: number; after: number }[]
  /** Symbols with no company row yet — added as untracked. */
  newSymbols: string[]
  /** Lines not imported, and why. */
  skipped: string[]
  /** Reasons the import cannot go ahead at all. */
  blockers: string[]
}

const quantities = (transactions: PortfolioTransaction[]) => {
  const out = new Map<string, number>()
  for (const symbol of new Set(transactions.map((t) => t.symbol))) {
    out.set(symbol, buildHolding(symbol, transactions.filter((t) => t.symbol === symbol), null).quantity)
  }
  return out
}

/**
 * The ledger is the complete record of trades for its period, so it replaces
 * whatever buys and sells the account had in that period — typically the one
 * "opening position" an earlier statement import created. Bonus, rights and
 * dividend entries are kept: a cash ledger does not show them.
 *
 * @param existing  this account's transactions only.
 */
export function planLedgerImport(
  ledger: ParsedLedger,
  existing: Existing[],
  knownSymbols: Set<string>,
): LedgerPlan {
  const blockers = [...ledger.issues]
  const skipped: string[] = []
  const trades: PlannedTrade[] = []
  const cash: PlannedCash[] = []

  // The broker works out commission to fractions of a paisa and keeps its
  // running balance unrounded, but prints each line rounded — so the printed
  // debit and credit can each be a paisa off, and over a year of trades the
  // error builds up. The change in the printed balance is the broker's own
  // figure for what the line did to the cash; taking it (within a paisa of
  // the printed columns, which the parser has checked) makes the history
  // reproduce the broker's cash exactly.
  let previous = ledger.openingBalance
  const round2 = (v: number) => Math.round(v * 100) / 100

  for (const e of ledger.entries) {
    const effect = round2(e.balance - previous)
    previous = e.balance
    const printed = round2(e.credit - e.debit)
    const cashEffect = Math.abs(effect - printed) <= 0.011 ? effect : printed

    if (e.kind === 'buy' || e.kind === 'sell') {
      // A trade that does not add up cannot be left out — the history would
      // be quietly wrong from that day on — so it stops the import.
      if (e.issues.length > 0) {
        blockers.push(`${e.date} ${e.label} ${e.description}: ${e.issues.join('; ')}`)
        continue
      }
      trades.push({
        date: e.date,
        txnType: e.kind,
        symbol: e.symbol!,
        quantity: e.quantity!,
        pricePerShare: e.amount! / e.quantity!,
        commission: round2(e.kind === 'buy' ? -cashEffect - e.amount! : e.amount! - cashEffect),
      })
    } else if (e.kind === 'other') {
      skipped.push(`${e.date} ${e.label} ${e.description} (${e.credit ? `+${e.credit}` : `−${e.debit}`}) — not recognised`)
    } else {
      const issues = e.issues.filter((i) => !i.startsWith('unrecognised'))
      if (issues.length > 0) blockers.push(`${e.date} ${e.description}: ${issues.join('; ')}`)
      cash.push({ date: e.date, kind: e.kind, amount: cashEffect, description: e.description })
    }
  }

  // Which existing buys and sells in the period the ledger replaces.
  const inPeriod = (t: Existing) => t.tradeDate >= ledger.from && t.tradeDate <= ledger.to
  const candidates = existing.filter((t) => (t.txnType === 'buy' || t.txnType === 'sell') && inPeriod(t))
  const unclaimed = [...trades]
  const replaced: LedgerPlan['replaced'] = []
  const keptManual: Existing[] = []

  for (const t of candidates) {
    if (t.source && t.source !== 'manual') {
      replaced.push({ ...t, reason: `from an earlier ${t.source === 'ledger' ? 'ledger' : 'statement'} import` })
      continue
    }
    // Typed in by hand: replaced only by the ledger trade it duplicates —
    // same stock, side and shares, within a few days (a hand-entered date is
    // easily the order date rather than the trade date).
    const match = unclaimed.findIndex(
      (l) =>
        l.symbol === t.symbol &&
        l.txnType === t.txnType &&
        l.quantity === t.quantity &&
        Math.abs(Date.parse(l.date) - Date.parse(t.tradeDate)) <= 3 * 86_400_000,
    )
    if (match >= 0) {
      replaced.push({ ...t, reason: `entered by hand; the ledger has it on ${unclaimed[match].date}` })
      unclaimed.splice(match, 1)
    } else {
      keptManual.push(t)
    }
  }

  const kept = existing.filter((t) => !replaced.some((r) => r === t || (r.id !== undefined && r.id === t.id)))

  const accountId = existing[0]?.accountId ?? 0
  const after: PortfolioTransaction[] = [
    ...kept,
    ...trades.map((t) => ({
      accountId,
      symbol: t.symbol,
      tradeDate: t.date,
      txnType: t.txnType,
      quantity: t.quantity,
      pricePerShare: t.pricePerShare,
      grossAmount: null,
      commission: t.commission,
      taxWithheld: 0,
    })),
  ]

  const before = quantities(existing)
  const afterQty = quantities(after)
  const symbols = [...new Set([...before.keys(), ...afterQty.keys()])].sort()

  // The rebuilt history must not sell shares it never bought.
  for (const symbol of symbols) {
    const warnings = buildHolding(symbol, after.filter((t) => t.symbol === symbol), null).warnings
    for (const w of warnings) blockers.push(`${symbol}: ${w}`)
  }

  return {
    from: ledger.from,
    to: ledger.to,
    trades,
    cash,
    replaced,
    keptManual,
    holdings: symbols
      .map((symbol) => ({ symbol, before: before.get(symbol) ?? 0, after: afterQty.get(symbol) ?? 0 }))
      .filter((h) => h.before !== 0 || h.after !== 0 || trades.some((t) => t.symbol === h.symbol)),
    newSymbols: [...new Set(trades.map((t) => t.symbol))].filter((s) => !knownSymbols.has(s)).sort(),
    skipped,
    blockers,
  }
}

export interface PlannedDividend {
  key: string
  companyName: string
  symbol: string | null
  recordDate: string
  /** When the cash arrived; the record date when the broker does not know. */
  date: string
  gross: number
  taxWithheld: number
  paidVia: 'broker' | 'elsewhere'
  /** Shares the ledger says were held on the record date, when it knows. */
  ledgerHolding: number | null
  holding: number
  recorded: boolean
  /** Ticked by default in the preview. */
  suggested: boolean
  caveat: string | null
}

/**
 * Dividends from the broker's dividend report, as ledger entries.
 *
 * A dividend paid "elsewhere" went to the bank account registered with the
 * BO, so the broker prints no tax and no date. The tax rate is taken from the
 * dividends in the same report that it does know about — withholding is set
 * per person, so it is the same rate — and it is left unticked, to be
 * confirmed against the bank statement.
 */
export function planDividendImport(
  report: ParsedDividendLedger,
  accountId: number,
  transactions: PortfolioTransaction[],
  companies: CompanyName[],
): PlannedDividend[] {
  const known = report.lines.filter((l) => l.tax !== null && l.gross > 0)
  const rate =
    known.length > 0 ? known.reduce((s, l) => s + l.tax!, 0) / known.reduce((s, l) => s + l.gross, 0) : 0.1
  const own = transactions.filter((t) => t.accountId === accountId)

  return report.lines.map((line) => {
    const symbol = matchCompany(line.companyName, companies)
    const taxWithheld =
      line.tax ?? Math.round(line.gross * rate * 100) / 100
    const history = symbol ? own.filter((t) => t.symbol === symbol && t.tradeDate < line.recordDate) : []
    // Shares held going into the record date: trades up to the day before,
    // since a buy on the record date itself settles too late to qualify.
    const ledgerHolding = symbol && history.length > 0 ? buildHolding(symbol, history, null).quantity : null
    const recorded = symbol !== null && alreadyRecorded(transactions, accountId, symbol, line.gross, line.recordDate)

    const caveats = [...line.issues]
    if (line.paidVia === 'elsewhere') {
      caveats.push(
        `Paid outside the broker — usually straight to your bank. Tax assumed ${(rate * 100).toFixed(0)}% like the rest of this report; tick it once you have seen it arrive.`,
      )
    }
    if (ledgerHolding !== null && ledgerHolding !== line.holding) {
      caveats.push(`The ledger shows ${ledgerHolding} shares held before the record date; the report says ${line.holding}.`)
    }

    return {
      key: `${line.companyName}|${line.recordDate}`,
      companyName: line.companyName,
      symbol,
      recordDate: line.recordDate,
      date: line.receivedDate ?? line.recordDate,
      gross: line.gross,
      taxWithheld,
      paidVia: line.paidVia,
      ledgerHolding,
      holding: line.holding,
      recorded,
      suggested: !recorded && symbol !== null && line.paidVia === 'broker' && line.issues.length === 0,
      caveat: caveats.length > 0 ? caveats.join(' ') : null,
    }
  })
}

export interface PnlComparison {
  companyName: string
  symbol: string | null
  broker: { buyQty: number; saleQty: number; profit: number }
  ledger: { buyQty: number; saleQty: number; profit: number } | null
  /** Quantities agree: no trade is missing from the ledger. */
  complete: boolean
}

/**
 * The broker's profit/loss report beside the ledger, company by company.
 *
 * Names on the report are full company names; companies added from a ledger
 * are known only by their trading code. So a name is matched first, and when
 * that fails, by the one stock whose bought and sold quantities in the
 * period are the same as the report's.
 */
export function comparePnl(
  pnl: ParsedPnl,
  accountId: number,
  transactions: PortfolioTransaction[],
  companies: CompanyName[],
): { rows: PnlComparison[]; total: { broker: number; ledger: number } } {
  const from = pnl.from ?? '0000-00-00'
  const to = pnl.to ?? '9999-99-99'
  const own = transactions.filter((t) => t.accountId === accountId)
  const inPeriod = own.filter((t) => t.tradeDate >= from && t.tradeDate <= to)

  const bySymbol = new Map<string, { buyQty: number; saleQty: number; profit: number }>()
  for (const symbol of new Set(inPeriod.filter((t) => t.txnType === 'buy' || t.txnType === 'sell').map((t) => t.symbol))) {
    const trades = inPeriod.filter((t) => t.symbol === symbol)
    const qty = (type: string) => trades.filter((t) => t.txnType === type).reduce((s, t) => s + (t.quantity ?? 0), 0)
    // Realised gain on sales in the period, with every earlier trade counted
    // for the cost — the same way the broker costs a sale.
    const upTo = own.filter((t) => t.symbol === symbol && t.tradeDate <= to)
    const before = own.filter((t) => t.symbol === symbol && t.tradeDate < from)
    const profit =
      buildHolding(symbol, upTo, null).realisedGain - buildHolding(symbol, before, null).realisedGain
    bySymbol.set(symbol, { buyQty: qty('buy'), saleQty: qty('sell'), profit })
  }

  const used = new Set<string>()
  const rows = pnl.lines.map((line) => {
    let symbol = matchCompany(line.companyName, companies)
    if (!symbol || !bySymbol.has(symbol)) {
      const candidates = [...bySymbol.entries()].filter(
        ([s, v]) => !used.has(s) && v.buyQty === line.buyQty && v.saleQty === line.saleQty,
      )
      symbol = candidates.length === 1 ? candidates[0][0] : symbol
    }
    if (symbol) used.add(symbol)
    const ledger = symbol ? bySymbol.get(symbol) ?? null : null
    return {
      companyName: line.companyName,
      symbol,
      broker: { buyQty: line.buyQty, saleQty: line.saleQty, profit: line.profit },
      ledger,
      complete: !!ledger && ledger.buyQty === line.buyQty && ledger.saleQty === line.saleQty,
    }
  })

  // Stocks the ledger traded that the report does not list.
  for (const [symbol, v] of bySymbol) {
    if (!used.has(symbol)) {
      rows.push({ companyName: symbol, symbol, broker: { buyQty: 0, saleQty: 0, profit: 0 }, ledger: v, complete: false })
    }
  }

  return {
    rows,
    total: {
      broker: pnl.lines.reduce((s, l) => s + l.profit, 0),
      ledger: [...bySymbol.values()].reduce((s, v) => s + v.profit, 0),
    },
  }
}
