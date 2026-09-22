/**
 * Buy and sell targets, checked against the latest close.
 *
 * The sell side is measured against what the shares cost you, after the
 * commission a sale itself costs — so a target that would sell at a loss is
 * called out, and the break-even price is always to hand.
 */

import type { PortfolioTransaction } from './portfolio'

/** DSE brokerage is typically 0.3–0.5% a side; used until trades say otherwise. */
export const DEFAULT_COMMISSION_RATE = 0.004

/**
 * The commission rate actually paid, from recorded trades: total commission
 * over total trade value. Falls back to a typical rate with too few trades
 * to go on.
 */
export function commissionRate(transactions: PortfolioTransaction[]): number {
  const trades = transactions.filter((t) => t.txnType === 'buy' || t.txnType === 'sell')
  const value = trades.reduce((s, t) => s + (t.quantity ?? 0) * (t.pricePerShare ?? 0), 0)
  const commission = trades.reduce((s, t) => s + t.commission, 0)
  if (trades.length < 3 || value <= 0) return DEFAULT_COMMISSION_RATE
  return commission / value
}

/**
 * The lowest sale price that gets back what the shares cost, after the
 * sale's own commission. Average cost already includes the buying commission.
 */
export function breakEvenPrice(averageCost: number, rate: number): number {
  return averageCost / (1 - rate)
}

/** The sale price that clears `gain` (0.05 = 5%) on cost, after commission. */
export function priceForGain(averageCost: number, gain: number, rate: number): number {
  return (averageCost * (1 + gain)) / (1 - rate)
}

export interface Target {
  id: number
  symbol: string
  accountId: number | null
  accountName: string | null
  buyBelow: number | null
  sellAbove: number | null
  note: string | null
}

export interface Position {
  quantity: number
  averageCost: number | null
  netCostPerShare: number | null
}

export interface TargetStatus {
  target: Target
  price: number | null
  priceDate: string | null
  buy: SideStatus | null
  sell: SideStatus | null
  /** The shares this target is about: the account's, or all of them. */
  position: Position | null
  breakEven: number | null
  warnings: string[]
}

export interface SideStatus {
  level: number
  reached: boolean
  /** Within this fraction of the level, not yet reached. */
  near: boolean
  /** How far the price still has to move, as a fraction of it: + up, − down. */
  toGo: number | null
}

/** "Near" means within this share of the price. */
export const NEAR = 0.02

function side(level: number | null, price: number | null, direction: 'buy' | 'sell'): SideStatus | null {
  if (level === null) return null
  if (price === null) return { level, reached: false, near: false, toGo: null }
  const reached = direction === 'buy' ? price <= level : price >= level
  const toGo = (level - price) / price
  return { level, reached, near: !reached && Math.abs(toGo) <= NEAR, toGo: reached ? 0 : toGo }
}

export function evaluateTarget(
  target: Target,
  quote: { close: number; tradeDate: string } | null,
  position: Position | null,
  rate: number,
): TargetStatus {
  const price = quote?.close ?? null
  const held = position && position.quantity > 0 ? position : null
  const breakEven = held?.averageCost ? breakEvenPrice(held.averageCost, rate) : null
  const warnings: string[] = []

  if (target.sellAbove !== null) {
    if (!held) {
      warnings.push(target.accountId ? 'Nothing held in this account to sell.' : 'Nothing held to sell.')
    } else if (breakEven !== null && target.sellAbove < breakEven) {
      warnings.push(
        `Selling at ৳${target.sellAbove.toFixed(2)} loses money: after commission, break-even is ৳${breakEven.toFixed(2)}.`,
      )
    }
  }
  if (price === null) warnings.push('No price yet for this stock.')

  return {
    target,
    price,
    priceDate: quote?.tradeDate ?? null,
    buy: side(target.buyBelow, price, 'buy'),
    sell: side(target.sellAbove, price, 'sell'),
    position: held,
    breakEven,
    warnings,
  }
}

/** Reached first, then near, then the rest; each by symbol. */
export function sortByUrgency(statuses: TargetStatus[]): TargetStatus[] {
  const rank = (s: TargetStatus) =>
    s.buy?.reached || s.sell?.reached ? 0 : s.buy?.near || s.sell?.near ? 1 : 2
  return [...statuses].sort((a, b) => rank(a) - rank(b) || a.target.symbol.localeCompare(b.target.symbol))
}
