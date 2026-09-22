/**
 * Holdings derived from the transaction ledger.
 *
 * A holding is not a fact — it is the outcome of a sequence of events, so it
 * is computed here rather than stored. Everything is pure, which is what makes
 * the cost-basis rules testable without a database.
 *
 * Cost basis is weighted average, applied in trade-date order.
 */

export type TransactionType = 'buy' | 'sell' | 'bonus' | 'rights' | 'dividend'

export interface PortfolioTransaction {
  id?: number
  /** The BO account the event happened in. Cost basis never crosses accounts. */
  accountId: number
  accountName?: string
  symbol: string
  tradeDate: string
  txnType: TransactionType
  quantity: number | null
  pricePerShare: number | null
  grossAmount: number | null
  commission: number
  taxWithheld: number
}

export interface Holding {
  symbol: string
  /** The account this position sits in; null once merged across accounts. */
  accountId: number | null
  accountName: string | null
  /** How many BO accounts hold this stock (1 for a single position). */
  accountCount: number
  quantity: number
  /** Cost of the shares still held, commission included. */
  costBasis: number
  averageCost: number | null

  realisedGain: number
  dividendsGross: number
  dividendsNet: number

  marketValue: number | null
  unrealisedGain: number | null
  unrealisedPct: number | null

  /** Gross dividends received in the trailing twelve months. */
  dividendsTtm: number
  /** Dividends of the trailing twelve months against current cost. */
  yieldOnCost: number | null

  /**
   * Net cost: every taka paid into this stock (buys, rights, commission) less
   * every taka it has paid back (sale proceeds after commission, dividends
   * after tax). Unlike weighted-average cost it falls with every profitable
   * sale and every dividend — at zero or below, the shares still held are free.
   */
  invested: number
  returned: number
  netCost: number
  /** Net cost over shares still held. Null with nothing held. */
  netCostPerShare: number | null

  firstTrade: string | null
  lastTrade: string | null
  /** Anything that did not add up, e.g. selling more than was held. */
  warnings: string[]
}

const DAY = 24 * 60 * 60 * 1000

function chronological(a: PortfolioTransaction, b: PortfolioTransaction): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1
  // A bonus or rights entry dated the same day as a buy must land after it,
  // or the shares arrive before there is a holding to apply them to.
  const rank = (t: TransactionType) => (t === 'buy' ? 0 : t === 'rights' ? 1 : t === 'bonus' ? 2 : 3)
  return rank(a.txnType) - rank(b.txnType)
}

/**
 * Cash leaving (negative) or arriving (positive) for one transaction.
 * A bonus issue moves no cash, which is precisely why it lowers average cost.
 */
export function cashFlowOf(txn: PortfolioTransaction): number {
  switch (txn.txnType) {
    case 'buy':
    case 'rights':
      return -((txn.quantity ?? 0) * (txn.pricePerShare ?? 0) + txn.commission)
    case 'sell':
      return (txn.quantity ?? 0) * (txn.pricePerShare ?? 0) - txn.commission
    case 'dividend':
      return (txn.grossAmount ?? 0) - txn.taxWithheld
    case 'bonus':
      return 0
  }
}

/**
 * One position: one stock in one BO account. Callers must pass only that
 * account's transactions — a sale is matched against the shares held in the
 * same account, never against another account's cheaper lot.
 */
export function buildHolding(
  symbol: string,
  transactions: PortfolioTransaction[],
  price: number | null,
  asOf: Date = new Date(),
  account: { id: number; name: string | null } | null = null,
): Holding {
  const ordered = [...transactions].sort(chronological)

  let quantity = 0
  let costBasis = 0
  let realisedGain = 0
  let dividendsGross = 0
  let dividendsNet = 0
  let recentDividends = 0
  let invested = 0
  let returned = 0
  const warnings: string[] = []

  const twelveMonthsAgo = new Date(asOf.getTime() - 365 * DAY).toISOString().slice(0, 10)

  for (const txn of ordered) {
    const qty = txn.quantity ?? 0
    const price = txn.pricePerShare ?? 0

    switch (txn.txnType) {
      case 'buy':
      case 'rights':
        quantity += qty
        costBasis += qty * price + txn.commission
        invested += qty * price + txn.commission
        break

      case 'bonus':
        // Shares in, no cash. Total cost is unchanged, so average cost falls.
        quantity += qty
        break

      case 'sell': {
        if (qty > quantity + 1e-9) {
          warnings.push(
            `${txn.tradeDate}: sold ${qty} but only ${quantity} held — check for a missing buy or bonus entry.`,
          )
        }

        const sold = Math.min(qty, quantity)
        const averageCost = quantity > 0 ? costBasis / quantity : 0
        const costRemoved = averageCost * sold
        const proceeds = sold * price - txn.commission

        realisedGain += proceeds - costRemoved
        // Proceeds of the shares actually held; an oversell is warned about above.
        returned += proceeds
        quantity -= sold
        costBasis -= costRemoved

        // Floating point can leave a costBasis of 1e-12 on a full exit.
        if (quantity < 1e-9) {
          quantity = 0
          costBasis = 0
        }
        break
      }

      case 'dividend': {
        const gross = txn.grossAmount ?? 0
        dividendsGross += gross
        dividendsNet += gross - txn.taxWithheld
        if (txn.tradeDate >= twelveMonthsAgo) recentDividends += gross
        returned += gross - txn.taxWithheld
        break
      }
    }
  }

  const marketValue = price !== null && quantity > 0 ? quantity * price : quantity === 0 ? 0 : null
  const unrealisedGain = marketValue === null ? null : marketValue - costBasis

  const tradeDates = ordered.filter((t) => t.txnType !== 'dividend').map((t) => t.tradeDate)

  return {
    symbol,
    accountId: account?.id ?? null,
    accountName: account?.name ?? null,
    accountCount: 1,
    quantity,
    costBasis,
    averageCost: quantity > 0 ? costBasis / quantity : null,
    realisedGain,
    dividendsGross,
    dividendsNet,
    marketValue,
    unrealisedGain,
    unrealisedPct:
      unrealisedGain === null || costBasis <= 0 ? null : unrealisedGain / costBasis,
    dividendsTtm: recentDividends,
    yieldOnCost: costBasis > 0 && recentDividends > 0 ? recentDividends / costBasis : null,
    invested,
    returned,
    netCost: invested - returned,
    netCostPerShare: quantity > 0 ? (invested - returned) / quantity : null,
    firstTrade: tradeDates[0] ?? null,
    lastTrade: tradeDates[tradeDates.length - 1] ?? null,
    warnings,
  }
}

/**
 * Combine the same stock held across several BO accounts into one row.
 *
 * This SUMS positions — quantity, cost, gains, dividends — rather than pooling
 * transactions into one weighted average. The result is identical for
 * quantity and total cost, but realised gains differ: a pooled average would
 * let a sale in one account be costed against cheaper shares in another and
 * report a gain that never happened.
 */
export function mergeBySymbol(positions: Holding[]): Holding[] {
  const bySymbol = new Map<string, Holding[]>()
  for (const position of positions) {
    if (!bySymbol.has(position.symbol)) bySymbol.set(position.symbol, [])
    bySymbol.get(position.symbol)!.push(position)
  }

  return [...bySymbol.entries()].map(([symbol, group]) => {
    if (group.length === 1) return group[0]

    const sum = (pick: (h: Holding) => number) => group.reduce((total, h) => total + pick(h), 0)

    const quantity = sum((h) => h.quantity)
    const costBasis = sum((h) => h.costBasis)
    const dividendsTtm = sum((h) => h.dividendsTtm)
    const invested = sum((h) => h.invested)
    const returned = sum((h) => h.returned)

    // Market value is unknown if the price is — and the price is per symbol,
    // so either every position has one or none does.
    const priced = group.every((h) => h.marketValue !== null)
    const marketValue = priced ? sum((h) => h.marketValue ?? 0) : null
    const unrealisedGain = marketValue === null ? null : marketValue - costBasis

    const dates = (pick: (h: Holding) => string | null) =>
      group.map(pick).filter((d): d is string => d !== null).sort()

    return {
      symbol,
      accountId: null,
      accountName: null,
      accountCount: group.filter((h) => h.quantity > 0 || h.realisedGain !== 0).length,
      quantity,
      costBasis,
      averageCost: quantity > 0 ? costBasis / quantity : null,
      realisedGain: sum((h) => h.realisedGain),
      dividendsGross: sum((h) => h.dividendsGross),
      dividendsNet: sum((h) => h.dividendsNet),
      marketValue,
      unrealisedGain,
      unrealisedPct:
        unrealisedGain === null || costBasis <= 0 ? null : unrealisedGain / costBasis,
      dividendsTtm,
      yieldOnCost: costBasis > 0 && dividendsTtm > 0 ? dividendsTtm / costBasis : null,
      invested,
      returned,
      netCost: invested - returned,
      netCostPerShare: quantity > 0 ? (invested - returned) / quantity : null,
      firstTrade: dates((h) => h.firstTrade)[0] ?? null,
      lastTrade: dates((h) => h.lastTrade).at(-1) ?? null,
      warnings: group.flatMap((h) => h.warnings),
    }
  })
}

export interface AccountSummary {
  accountId: number
  accountName: string
  totalCost: number
  totalMarketValue: number
  totalUnrealised: number
  totalRealised: number
  totalDividendsGross: number
  openPositions: number
}

export interface PortfolioSummary {
  /** One row per stock, combined across whichever accounts are in scope. */
  holdings: Holding[]
  /** One row per stock per account — the positions the totals are built from. */
  positions: Holding[]
  byAccount: AccountSummary[]
  totalCost: number
  totalMarketValue: number
  totalUnrealised: number
  totalUnrealisedPct: number | null
  totalRealised: number
  totalDividendsGross: number
  totalDividendsNet: number
  /** Share of market value in the largest position. */
  largestWeight: number | null
  /**
   * Money-weighted annual return across every cash flow. Null when undefined,
   * and deliberately null when there is under a year of history.
   */
  xirr: number | null
  /** Days from the first recorded cash flow to the valuation date. */
  historyDays: number
}

/**
 * Below this, an annual rate is not reported. Annualising a short period
 * compounds noise into nonsense: a 0.5% move over one day is an "annual
 * return" of 524%.
 */
export const MIN_DAYS_TO_ANNUALISE = 365

/**
 * @param accountId  restrict to one BO account; omit for every account.
 */
export function buildPortfolio(
  transactions: PortfolioTransaction[],
  prices: Map<string, number>,
  asOf: Date = new Date(),
  accountId?: number,
): PortfolioSummary {
  const scoped =
    accountId === undefined ? transactions : transactions.filter((t) => t.accountId === accountId)

  // Group by account AND symbol. This is the line that keeps cost basis from
  // leaking between accounts.
  const groups = new Map<string, PortfolioTransaction[]>()
  for (const txn of scoped) {
    const key = `${txn.accountId}|${txn.symbol}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(txn)
  }

  const positions = [...groups.values()].map((txns) => {
    const { symbol, accountId: id, accountName } = txns[0]
    const holding = buildHolding(symbol, txns, prices.get(symbol) ?? null, asOf, {
      id,
      name: accountName ?? null,
    })

    // Say which account a warning belongs to, or it cannot be acted on.
    if (accountName && holding.warnings.length > 0) {
      holding.warnings = holding.warnings.map((w) => `${accountName} · ${symbol}: ${w}`)
    }
    return holding
  })

  const byValue = (a: Holding, b: Holding) => (b.marketValue ?? 0) - (a.marketValue ?? 0)
  const holdings = mergeBySymbol(positions).sort(byValue)

  const totalCost = positions.reduce((sum, h) => sum + h.costBasis, 0)
  const totalMarketValue = positions.reduce((sum, h) => sum + (h.marketValue ?? 0), 0)
  const totalUnrealised = totalMarketValue - totalCost

  const accountIds = [...new Set(positions.map((p) => p.accountId!))]
  const byAccount: AccountSummary[] = accountIds
    .map((id) => {
      const own = positions.filter((p) => p.accountId === id)
      const cost = own.reduce((s, h) => s + h.costBasis, 0)
      const value = own.reduce((s, h) => s + (h.marketValue ?? 0), 0)
      return {
        accountId: id,
        accountName: own[0]?.accountName ?? `Account ${id}`,
        totalCost: cost,
        totalMarketValue: value,
        totalUnrealised: value - cost,
        totalRealised: own.reduce((s, h) => s + h.realisedGain, 0),
        totalDividendsGross: own.reduce((s, h) => s + h.dividendsGross, 0),
        openPositions: own.filter((h) => h.quantity > 0).length,
      }
    })
    .sort((a, b) => b.totalMarketValue - a.totalMarketValue)

  // The final flow is what the position is worth today, as if sold.
  const flows = scoped
    .map((txn) => ({ date: txn.tradeDate, amount: cashFlowOf(txn) }))
    .filter((f) => f.amount !== 0)

  const firstFlow = flows.map((f) => f.date).sort()[0]
  const historyDays = firstFlow ? Math.floor((asOf.getTime() - Date.parse(firstFlow)) / DAY) : 0

  if (totalMarketValue > 0) {
    flows.push({ date: asOf.toISOString().slice(0, 10), amount: totalMarketValue })
  }

  return {
    holdings,
    positions,
    byAccount,
    totalCost,
    totalMarketValue,
    totalUnrealised,
    totalUnrealisedPct: totalCost > 0 ? totalUnrealised / totalCost : null,
    totalRealised: holdings.reduce((sum, h) => sum + h.realisedGain, 0),
    totalDividendsGross: holdings.reduce((sum, h) => sum + h.dividendsGross, 0),
    totalDividendsNet: holdings.reduce((sum, h) => sum + h.dividendsNet, 0),
    largestWeight:
      totalMarketValue > 0
        ? Math.max(...holdings.map((h) => (h.marketValue ?? 0) / totalMarketValue))
        : null,
    xirr: historyDays >= MIN_DAYS_TO_ANNUALISE ? xirr(flows) : null,
    historyDays,
  }
}

export interface CashFlow {
  date: string
  amount: number
}

/**
 * Money-weighted annual return.
 *
 * The right measure when money went in at different times: buying more of
 * something before it fell should show up, and a simple percentage gain hides
 * it entirely.
 *
 * Returns null rather than a number when the maths is undefined — fewer than
 * two flows, or all flows the same sign (no round trip to measure).
 */
export function xirr(flows: CashFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null

  const hasNegative = flows.some((f) => f.amount < 0)
  const hasPositive = flows.some((f) => f.amount > 0)
  if (!hasNegative || !hasPositive) return null

  const sorted = [...flows].sort((a, b) => (a.date < b.date ? -1 : 1))
  const start = Date.parse(sorted[0].date)

  const years = sorted.map((f) => (Date.parse(f.date) - start) / (365 * DAY))
  const amounts = sorted.map((f) => f.amount)

  const npv = (rate: number) =>
    amounts.reduce((sum, amount, i) => sum + amount / Math.pow(1 + rate, years[i]), 0)

  // Newton first — it converges in a handful of steps for well-behaved flows.
  let rate = guess
  for (let i = 0; i < 60; i += 1) {
    const value = npv(rate)
    if (Math.abs(value) < 1e-7) return rate

    const derivative = amounts.reduce(
      (sum, amount, j) => sum - (years[j] * amount) / Math.pow(1 + rate, years[j] + 1),
      0,
    )
    if (derivative === 0 || !Number.isFinite(derivative)) break

    const next = rate - value / derivative
    if (!Number.isFinite(next) || next <= -0.9999) break
    if (Math.abs(next - rate) < 1e-9) return next
    rate = next
  }

  // Bisection as a fallback: slower, but it cannot diverge.
  let low = -0.9999
  let high = 10
  if (npv(low) * npv(high) > 0) return null

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2
    const value = npv(mid)
    if (Math.abs(value) < 1e-7) return mid
    if (npv(low) * value < 0) high = mid
    else low = mid
  }

  return (low + high) / 2
}

export interface CostStep {
  date: string
  txnType: TransactionType
  accountName: string | null
  /** Shares moved; null for a dividend. */
  quantity: number | null
  price: number | null
  /** Cash of the event itself: negative out, positive in. */
  cash: number
  /** Position after the event, summed across accounts. */
  held: number
  averageCost: number | null
  netCostPerShare: number | null
  netCost: number
}

/**
 * How average cost and net cost moved, event by event, for one stock.
 *
 * Each step rebuilds every account's position from its own events up to that
 * point, so the figures are exactly what buildHolding would have reported on
 * that day — the same rules, not a second implementation of them.
 */
export function costTimeline(transactions: PortfolioTransaction[]): CostStep[] {
  const ordered = [...transactions].sort(chronological)
  const accounts = [...new Set(ordered.map((t) => t.accountId))]

  return ordered.map((txn, i) => {
    const upTo = ordered.slice(0, i + 1)
    const positions = accounts.map((id) =>
      buildHolding(txn.symbol, upTo.filter((t) => t.accountId === id), null),
    )
    const held = positions.reduce((s, p) => s + p.quantity, 0)
    const cost = positions.reduce((s, p) => s + p.costBasis, 0)
    const netCost = positions.reduce((s, p) => s + p.netCost, 0)

    return {
      date: txn.tradeDate,
      txnType: txn.txnType,
      accountName: txn.accountName ?? null,
      quantity: txn.quantity,
      price: txn.pricePerShare,
      cash: cashFlowOf(txn),
      held,
      averageCost: held > 0 ? cost / held : null,
      netCostPerShare: held > 0 ? netCost / held : null,
      netCost,
    }
  })
}

export interface FreeSharePlan {
  /** Shares to sell at the price to take out all the net cost. */
  sell: number
  /** Shares left over, costing nothing. */
  keep: number
}

/**
 * The sale that makes the rest of a position free: sell enough at `price`,
 * after commission, to recover the whole net cost. Null when it is already
 * free, when there is no price, or when selling everything would still not
 * recover it.
 *
 * @param commissionRate  DSE brokerage is typically 0.3-0.5% of the trade.
 */
export function freeSharePlan(
  holding: Pick<Holding, 'quantity' | 'netCost'>,
  price: number | null,
  commissionRate = 0.005,
): FreeSharePlan | null {
  if (price === null || price <= 0 || holding.quantity <= 0 || holding.netCost <= 0) return null
  const sell = Math.ceil(holding.netCost / (price * (1 - commissionRate)) - 1e-9)
  if (sell >= holding.quantity) return null
  return { sell, keep: holding.quantity - sell }
}

export interface PlannedTrade {
  sellQty: number
  sellPrice: number
  buyQty: number
  buyPrice: number
  /** Brokerage as a fraction of each trade, e.g. 0.005. */
  commissionRate: number
}

export interface TradeOutcome {
  quantity: number
  averageCost: number | null
  netCostPerShare: number | null
  netCost: number
  /** Gain on the shares sold, against average cost, after commission. */
  realisedGain: number
  /** Cash the plan needs: positive to pay in, negative when it frees cash. */
  cashNeeded: number
  /** Selling more than is held. */
  invalid: string | null
}

/**
 * What a sale followed by a buy-back would do to a position — the move for
 * working net cost down: sell high, buy back lower, keep the difference.
 * Uses the same rules as buildHolding: a sale leaves average cost alone and
 * lowers net cost by its proceeds; a buy raises both by what it costs.
 */
export function simulateTrade(
  position: Pick<Holding, 'quantity' | 'costBasis' | 'netCost'>,
  plan: PlannedTrade,
): TradeOutcome {
  const { sellQty, sellPrice, buyQty, buyPrice, commissionRate } = plan
  if (sellQty > position.quantity + 1e-9) {
    return {
      quantity: position.quantity,
      averageCost: position.quantity > 0 ? position.costBasis / position.quantity : null,
      netCostPerShare: position.quantity > 0 ? position.netCost / position.quantity : null,
      netCost: position.netCost,
      realisedGain: 0,
      cashNeeded: 0,
      invalid: `Only ${position.quantity.toLocaleString()} held.`,
    }
  }

  const averageCost = position.quantity > 0 ? position.costBasis / position.quantity : 0
  const proceeds = sellQty * sellPrice * (1 - commissionRate)
  const outlay = buyQty * buyPrice * (1 + commissionRate)

  const quantity = position.quantity - sellQty + buyQty
  const costBasis = position.costBasis - averageCost * sellQty + outlay
  const netCost = position.netCost - proceeds + outlay

  return {
    quantity,
    averageCost: quantity > 0 ? costBasis / quantity : null,
    netCostPerShare: quantity > 0 ? netCost / quantity : null,
    netCost,
    realisedGain: proceeds - averageCost * sellQty,
    cashNeeded: outlay - proceeds,
    invalid: null,
  }
}
