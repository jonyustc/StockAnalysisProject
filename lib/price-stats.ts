/**
 * What a run of daily closes says about a stock — and what it would take to
 * reach a given price from here.
 *
 * Nothing here forecasts anything. A moving average is where the price has
 * been; a scenario is arithmetic on a level someone else chose. Both are
 * labelled as such wherever they are shown, because a line on a chart is
 * very easily read as a promise.
 */

import type { Candle } from './insights'

/** The mean of the last `window` closes, at each day it can be worked out. */
export function movingAverage(history: Candle[], window: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0

  for (let i = 0; i < history.length; i += 1) {
    sum += history[i].close
    if (i >= window) sum -= history[i - window].close
    out.push(i >= window - 1 ? sum / window : null)
  }
  return out
}

/** Day-to-day returns, as fractions. */
export function dailyReturns(history: Candle[]): number[] {
  const out: number[] = []
  for (let i = 1; i < history.length; i += 1) {
    const previous = history[i - 1].close
    if (previous > 0) out.push(history[i].close / previous - 1)
  }
  return out
}

/** Roughly 250 trading days in a DSE year. */
export const TRADING_DAYS_A_YEAR = 250

export interface PriceStats {
  /** How much it typically moves in a day, as a fraction. */
  typicalDailyMove: number | null
  /** Yearly volatility, from the spread of daily moves. */
  volatility: number | null
  changeMonth: number | null
  changeQuarter: number | null
  changeYear: number | null
  ma50: number | null
  ma200: number | null
  /** Where the price is against each average, as a fraction. */
  aboveMa50: number | null
  aboveMa200: number | null
}

function changeOver(history: Candle[], days: number): number | null {
  if (history.length <= days) return null
  const then = history[history.length - 1 - days].close
  const now = history[history.length - 1].close
  return then > 0 ? now / then - 1 : null
}

export function priceStats(history: Candle[]): PriceStats {
  const ordered = [...history].sort((a, b) => (a.date < b.date ? -1 : 1))
  const last = ordered[ordered.length - 1]?.close ?? null

  const returns = dailyReturns(ordered).slice(-TRADING_DAYS_A_YEAR)
  const mean = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : null
  const variance =
    returns.length > 1 && mean !== null
      ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
      : null

  const ma = (window: number) => (ordered.length >= window ? movingAverage(ordered, window).at(-1) ?? null : null)
  const ma50 = ma(50)
  const ma200 = ma(200)

  return {
    typicalDailyMove: returns.length > 0 ? returns.reduce((s, r) => s + Math.abs(r), 0) / returns.length : null,
    volatility: variance === null ? null : Math.sqrt(variance * TRADING_DAYS_A_YEAR),
    changeMonth: changeOver(ordered, 21),
    changeQuarter: changeOver(ordered, 63),
    changeYear: changeOver(ordered, TRADING_DAYS_A_YEAR),
    ma50,
    ma200,
    aboveMa50: ma50 !== null && last !== null && ma50 > 0 ? last / ma50 - 1 : null,
    aboveMa200: ma200 !== null && last !== null && ma200 > 0 ? last / ma200 - 1 : null,
  }
}

export interface Scenario {
  label: string
  /** Where the level comes from, in a few words. */
  basis: string
  price: number
  /** The move from today's price, as a fraction. */
  move: number
  /** What the holding would be worth there, and the gain against its cost. */
  value: number | null
  gain: number | null
  gainPct: number | null
}

export interface ScenarioInput {
  price: number
  quantity: number
  /** Cost of the shares held, commission included. */
  costBasis: number
  levels: { label: string; basis: string; price: number | null }[]
}

/**
 * What each level would mean: the move needed, and what the holding would be
 * worth there. Arithmetic on levels the caller supplies — no view is taken
 * on whether any of them will happen.
 */
export function scenarios({ price, quantity, costBasis, levels }: ScenarioInput): Scenario[] {
  return levels
    .filter((level): level is { label: string; basis: string; price: number } => level.price !== null && level.price > 0)
    .map((level) => {
      const value = quantity > 0 ? quantity * level.price : null
      const gain = value === null ? null : value - costBasis
      return {
        label: level.label,
        basis: level.basis,
        price: level.price,
        move: price > 0 ? level.price / price - 1 : 0,
        value,
        gain,
        gainPct: gain === null || costBasis <= 0 ? null : gain / costBasis,
      }
    })
    .sort((a, b) => a.price - b.price)
}
