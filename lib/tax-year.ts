/**
 * A Bangladesh income-year summary of the portfolio: 1 July to 30 June.
 *
 * What a return and the wealth statement ask about shares — dividends with
 * the tax already withheld, gains realised on sales, money put in and taken
 * out, and what was held at the year end at cost — gathered from the ledger
 * for one income year. It reports the records; the tax treatment of each is
 * for the current rules, not for this code, to decide.
 */

import { buildHolding, cashFlowOf, tradingStats, type PortfolioTransaction, type Sale } from './portfolio'

/** The income year a date falls in, by its starting calendar year: 2025 is 2025–26. */
export function incomeYearOf(date: string): number {
  const year = Number(date.slice(0, 4))
  return Number(date.slice(5, 7)) >= 7 ? year : year - 1
}

export function incomeYear(start: number) {
  return {
    start,
    label: `${start}–${String(start + 1).slice(2)}`,
    from: `${start}-07-01`,
    to: `${start + 1}-06-30`,
  }
}

export interface DividendLine {
  date: string
  recordDate: string | null
  symbol: string
  accountName: string | null
  gross: number
  tax: number
  net: number
}

export interface HeldAtYearEnd {
  symbol: string
  accountId: number
  accountName: string | null
  quantity: number
  /** At cost: what the shares held cost, commission included. */
  cost: number
  averageCost: number
}

export interface IncomeYearReport {
  year: ReturnType<typeof incomeYear>
  dividends: DividendLine[]
  dividendTotals: { gross: number; tax: number; net: number }
  sales: Sale[]
  realised: number
  commission: number
  deposited: number
  withdrawn: number
  fees: number
  heldAtEnd: HeldAtYearEnd[]
  costAtEnd: number
  /**
   * Cash in each account at the year end, rebuilt from the ledger — only for
   * accounts whose ledger covers them from opening, without gaps, to that
   * date. Otherwise the account is left out and listed in `cashUnknown`.
   */
  cashAtEnd: number
  cashUnknown: string[]
}

export function incomeYearReport(
  start: number,
  transactions: PortfolioTransaction[],
  movements: { accountId: number; date: string; kind: string; amount: number }[],
  /** Accounts whose ledger reaches the year end from a zero opening balance. */
  cashKnownFor: Set<number>,
  accountNames: Map<number, string>,
): IncomeYearReport {
  const year = incomeYear(start)
  const inYear = (d: string) => d >= year.from && d <= year.to
  const upToEnd = transactions.filter((t) => t.tradeDate <= year.to)

  const dividends = transactions
    .filter((t) => t.txnType === 'dividend' && inYear(t.tradeDate))
    .map((t) => ({
      date: t.tradeDate,
      recordDate: t.recordDate ?? null,
      symbol: t.symbol,
      accountName: t.accountName ?? accountNames.get(t.accountId) ?? null,
      gross: t.grossAmount ?? 0,
      tax: t.taxWithheld,
      net: (t.grossAmount ?? 0) - t.taxWithheld,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // Sales are scored with every earlier trade counted for their cost, so the
  // history before the year is used; only sales inside it are reported.
  const sales = tradingStats(upToEnd).sales.filter((s) => inYear(s.date))
  const tradesInYear = transactions.filter(
    (t) => (t.txnType === 'buy' || t.txnType === 'sell' || t.txnType === 'rights') && inYear(t.tradeDate),
  )

  const heldAtEnd: HeldAtYearEnd[] = []
  const keys = new Set(upToEnd.map((t) => `${t.accountId}|${t.symbol}`))
  for (const key of keys) {
    const [accountId, symbol] = [Number(key.split('|')[0]), key.split('|')[1]]
    const h = buildHolding(symbol, upToEnd.filter((t) => t.accountId === accountId && t.symbol === symbol), null)
    if (h.quantity > 0) {
      heldAtEnd.push({
        symbol,
        accountId,
        accountName: accountNames.get(accountId) ?? null,
        quantity: h.quantity,
        cost: h.costBasis,
        averageCost: h.averageCost ?? 0,
      })
    }
  }
  heldAtEnd.sort((a, b) => (a.accountName ?? '').localeCompare(b.accountName ?? '') || a.symbol.localeCompare(b.symbol))

  const movesInYear = movements.filter((m) => inYear(m.date))
  const sumKind = (kind: string) => movesInYear.filter((m) => m.kind === kind).reduce((s, m) => s + m.amount, 0)

  const accounts = new Set([...transactions.map((t) => t.accountId), ...movements.map((m) => m.accountId)])
  let cashAtEnd = 0
  const cashUnknown: string[] = []
  for (const id of accounts) {
    if (!cashKnownFor.has(id)) {
      cashUnknown.push(accountNames.get(id) ?? `Account ${id}`)
      continue
    }
    cashAtEnd +=
      movements.filter((m) => m.accountId === id && m.date <= year.to).reduce((s, m) => s + m.amount, 0) +
      upToEnd
        .filter((t) => t.accountId === id && (t.txnType === 'buy' || t.txnType === 'sell' || t.txnType === 'rights'))
        .reduce((s, t) => s + cashFlowOf(t), 0)
  }

  return {
    year,
    dividends,
    dividendTotals: {
      gross: dividends.reduce((s, d) => s + d.gross, 0),
      tax: dividends.reduce((s, d) => s + d.tax, 0),
      net: dividends.reduce((s, d) => s + d.net, 0),
    },
    sales,
    realised: sales.reduce((s, x) => s + x.gain, 0),
    commission: tradesInYear.reduce((s, t) => s + t.commission, 0),
    deposited: sumKind('deposit'),
    withdrawn: Math.abs(sumKind('withdrawal')),
    fees: Math.abs(sumKind('fee')),
    heldAtEnd,
    costAtEnd: heldAtEnd.reduce((s, h) => s + h.cost, 0),
    cashAtEnd,
    cashUnknown,
  }
}
