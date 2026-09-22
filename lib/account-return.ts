/**
 * Account-level returns, from broker statement snapshots.
 *
 * These answer "how has this ACCOUNT done" from cash: what you put in against
 * what it is worth now. That needs no trade history, and it catches things a
 * sum of gains cannot — broker and depository fees, for instance, which leave
 * the account without appearing as a loss on any holding.
 *
 * Two rules about what counts as money you put in:
 *
 *   - Cash dividends are income the account EARNED, not money you added.
 *     The broker's "Total Deposit" includes them; counting them as a deposit
 *     would make dividends shrink your return instead of adding to it.
 *   - IPO payments and refunds are money moving inside the account (out to
 *     apply, back if not allotted). They are in the broker's deposit and
 *     withdrawal totals too, and are excluded for the same reason.
 */

export interface AccountSnapshot {
  asOf: string
  /** Holdings at market. */
  marketValue: number
  cashBalance: number
  /** What the current holdings cost, per the broker. Null if unknown. */
  costOfHoldings: number | null

  deposit: number
  shareTransferIn: number
  withdraw: number
  shareTransferOut: number

  cashDividend: number
  realisedGain: number
}

const DAY = 24 * 60 * 60 * 1000

/** Money you put in, net of what you took out. */
export function netContributions(s: AccountSnapshot): number {
  return s.deposit + s.shareTransferIn - s.withdraw - s.shareTransferOut
}

/** What the account is worth: holdings at market plus cash. */
export function accountWorth(s: AccountSnapshot): number {
  return s.marketValue + s.cashBalance
}

export interface LifetimeReturn {
  moneyIn: number
  worth: number
  gain: number
  /** Gain over money in. Null when nothing net has gone in. */
  totalReturn: number | null

  realised: number
  dividends: number
  /** Null when the cost of the holdings is not known. */
  unrealised: number | null
  /**
   * What the named lines do not explain — in practice account charges such
   * as the annual BO maintenance fee. Inferred, not reported by the broker.
   */
  unexplained: number | null
}

export function lifetimeReturn(s: AccountSnapshot): LifetimeReturn {
  const moneyIn = netContributions(s)
  const worth = accountWorth(s)
  const gain = worth - moneyIn
  const unrealised = s.costOfHoldings === null ? null : s.marketValue - s.costOfHoldings

  return {
    moneyIn,
    worth,
    gain,
    totalReturn: moneyIn > 0 ? gain / moneyIn : null,
    realised: s.realisedGain,
    dividends: s.cashDividend,
    unrealised,
    unexplained: unrealised === null ? null : gain - (s.realisedGain + s.cashDividend + unrealised),
  }
}

export interface PeriodReturn {
  from: string
  to: string
  /** Net money added during the period. */
  flow: number
  /** Null when the start value leaves nothing to measure against. */
  return: number | null
}

/**
 * Return between two snapshots, by Modified Dietz.
 *
 * A deposit is not a gain, so money added during the period is taken out of
 * the change in value. Statements say HOW MUCH moved between two dates, not
 * on which day, so the flow is assumed to arrive mid-period — the standard
 * assumption, and close enough when statements are imported regularly.
 */
export function periodReturn(start: AccountSnapshot, end: AccountSnapshot): PeriodReturn {
  const v0 = accountWorth(start)
  const v1 = accountWorth(end)
  const flow = netContributions(end) - netContributions(start)
  const denominator = v0 + 0.5 * flow

  return {
    from: start.asOf,
    to: end.asOf,
    flow,
    return: denominator > 0 ? (v1 - v0 - flow) / denominator : null,
  }
}

export interface YearReturn {
  year: number
  /** Time-weighted: the periods within the year, chained. */
  return: number
  /** The dates actually covered — may be less than the calendar year. */
  from: string
  to: string
  /** True when the snapshots span close enough to the whole year. */
  complete: boolean
}

/**
 * Calendar-year returns, time-weighted, from a series of snapshots.
 *
 * Time-weighting chains the return of each period between snapshots, so the
 * result measures how the investments did — not how much money happened to be
 * added when. Each period is assigned to the year its END falls in; with
 * regular imports the few days either side of New Year are a rounding error,
 * with sparse ones they are not, which is what `complete` reports.
 */
export function yearlyReturns(snapshots: AccountSnapshot[]): YearReturn[] {
  const ordered = [...snapshots].sort((a, b) => (a.asOf < b.asOf ? -1 : 1))
  const byYear = new Map<number, { growth: number; from: string; to: string }>()

  for (let i = 1; i < ordered.length; i += 1) {
    const period = periodReturn(ordered[i - 1], ordered[i])
    if (period.return === null) continue

    const year = Number(period.to.slice(0, 4))
    const current = byYear.get(year)

    if (current) {
      current.growth *= 1 + period.return
      current.to = period.to
    } else {
      byYear.set(year, { growth: 1 + period.return, from: period.from, to: period.to })
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, { growth, from, to }]) => ({
      year,
      return: growth - 1,
      from,
      to,
      // Within a week of both ends of the year.
      complete: Date.parse(from) <= Date.parse(`${year}-01-07`) && Date.parse(to) >= Date.parse(`${year}-12-24`),
    }))
}

export interface CashMovement {
  from: string
  to: string
  deposited: number
  withdrawn: number
  /** Net of tax, as credited. */
  dividends: number
  transferredIn: number
  transferredOut: number
  /** IPO refunds less IPO payments: negative while an application is pending. */
  ipoNet: number
}

/**
 * Money that moved between consecutive snapshots, read from the change in the
 * broker's lifetime totals. Periods where nothing moved are left out.
 *
 * Statements say how much moved between two dates, not on which day — import
 * daily and each row is one day.
 */
export function cashMovements(
  snapshots: (AccountSnapshot & { ipoPayment?: number; ipoRefund?: number })[],
): CashMovement[] {
  const ordered = [...snapshots].sort((a, b) => (a.asOf < b.asOf ? -1 : 1))
  const movements: CashMovement[] = []

  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]
    const b = ordered[i]
    const d = (pick: (s: typeof a) => number | undefined) => round2((pick(b) ?? 0) - (pick(a) ?? 0))

    const amounts = {
      deposited: d((s) => s.deposit),
      withdrawn: d((s) => s.withdraw),
      dividends: d((s) => s.cashDividend),
      transferredIn: d((s) => s.shareTransferIn),
      transferredOut: d((s) => s.shareTransferOut),
      ipoNet: d((s) => (s.ipoRefund ?? 0) - (s.ipoPayment ?? 0)),
    }

    if (Object.values(amounts).some((v) => Math.abs(v) >= 0.005)) {
      movements.push({ from: a.asOf, to: b.asOf, ...amounts })
    }
  }

  return movements.reverse()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Chained return across every snapshot — since tracking began. */
export function sinceFirstSnapshot(snapshots: AccountSnapshot[]): {
  return: number | null
  from: string | null
  to: string | null
  days: number
} {
  const ordered = [...snapshots].sort((a, b) => (a.asOf < b.asOf ? -1 : 1))
  if (ordered.length < 2) {
    return { return: null, from: ordered[0]?.asOf ?? null, to: ordered[0]?.asOf ?? null, days: 0 }
  }

  let growth = 1
  for (let i = 1; i < ordered.length; i += 1) {
    const r = periodReturn(ordered[i - 1], ordered[i]).return
    if (r !== null) growth *= 1 + r
  }

  const from = ordered[0].asOf
  const to = ordered[ordered.length - 1].asOf
  return { return: growth - 1, from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / DAY) }
}
