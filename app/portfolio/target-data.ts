import 'server-only'

import { getLatestQuotes, listPortfolioTransactions, listPriceTargets } from '@/db/queries'
import { buildPortfolio, type PortfolioTransaction } from '@/lib/portfolio'
import { commissionRate, evaluateTarget, sortByUrgency, type Position } from '@/lib/targets'

/**
 * Every target with where the price stands against it — for the targets page
 * and the reminder on the holdings page. Each target is judged against the
 * shares it is about: one account's, or all of them for "any account".
 */
export async function targetStatuses(prefetched?: {
  transactions?: PortfolioTransaction[]
  quotes?: Awaited<ReturnType<typeof getLatestQuotes>>
}) {
  const [targets, transactions, quotes] = await Promise.all([
    listPriceTargets(),
    prefetched?.transactions ?? listPortfolioTransactions(),
    prefetched?.quotes ?? getLatestQuotes(),
  ])

  const positionOf = (symbol: string, accountId: number | null): Position | null => {
    const own = transactions.filter((t) => t.symbol === symbol && (accountId === null || t.accountId === accountId))
    if (own.length === 0) return null
    const h = buildPortfolio(own, new Map()).holdings[0]
    return h ? { quantity: h.quantity, averageCost: h.averageCost, netCostPerShare: h.netCostPerShare } : null
  }
  const rateOf = (accountId: number | null) =>
    commissionRate(accountId === null ? transactions : transactions.filter((t) => t.accountId === accountId))

  const statuses = targets.map((t) =>
    evaluateTarget(t, quotes.get(t.symbol) ?? null, positionOf(t.symbol, t.accountId), rateOf(t.accountId)),
  )

  return { statuses: sortByUrgency(statuses), transactions, quotes, positionOf, rateOf }
}
