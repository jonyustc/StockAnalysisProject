/**
 * What the price and the fundamentals together say about buying low and
 * selling high.
 *
 * Three different questions, kept apart because they need different data and
 * fail differently:
 *
 *   - Where is the price in its range? Needs only the 52-week high and low,
 *     which every quote carries.
 *   - Is it cheap against its own past? Needs years of daily prices beside
 *     the earnings of the day, so it appears once that history exists.
 *   - Is it cheap against other companies? Needs today's figures for the
 *     others, which the screener already has.
 *
 * Nothing here decides anything. It reports the comparison and says what it
 * is measured against, because a ratio without its yardstick is just a number.
 */

export interface Candle {
  date: string
  close: number
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length / 2
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The value at a percentile, interpolating between neighbours. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (index - low)
}

/** Where a value sits among others, as a fraction: 0 lowest, 1 highest. */
export function rankOf(values: number[], value: number): number | null {
  if (values.length === 0) return null
  const below = values.filter((v) => v < value).length
  const equal = values.filter((v) => v === value).length
  return (below + equal / 2) / values.length
}

export interface PriceRange {
  high: number
  low: number
  /** When, if the history is there to say. */
  highDate: string | null
  lowDate: string | null
  /** 0 at the low, 1 at the high. */
  position: number | null
  /** Negative: how far under the high. */
  belowHigh: number
  aboveLow: number
  days: number
}

/** High, low and where today sits, over the days on or after `from`. */
export function rangeOver(history: Candle[], from: string, price: number): PriceRange | null {
  const window = history.filter((c) => c.date >= from)
  if (window.length === 0) return null

  let high = window[0]
  let low = window[0]
  for (const candle of window) {
    if (candle.close > high.close) high = candle
    if (candle.close < low.close) low = candle
  }

  return {
    high: high.close,
    low: low.close,
    highDate: high.date,
    lowDate: low.date,
    position: high.close > low.close ? (price - low.close) / (high.close - low.close) : null,
    belowHigh: high.close > 0 ? price / high.close - 1 : 0,
    aboveLow: low.close > 0 ? price / low.close - 1 : 0,
    days: window.length,
  }
}

export interface Drawdown {
  /** The deepest fall from a peak, as a negative fraction. */
  worst: number
  peakDate: string | null
  troughDate: string | null
  /** How far below the highest close so far the price is now. */
  fromPeak: number
}

export function drawdown(history: Candle[]): Drawdown | null {
  if (history.length < 2) return null
  const ordered = [...history].sort((a, b) => (a.date < b.date ? -1 : 1))

  let peak = ordered[0]
  let worst = 0
  let peakDate: string | null = null
  let troughDate: string | null = null
  let highest = ordered[0].close

  for (const candle of ordered) {
    if (candle.close > peak.close) peak = candle
    if (candle.close > highest) highest = candle.close
    const fall = candle.close / peak.close - 1
    if (fall < worst) {
      worst = fall
      peakDate = peak.date
      troughDate = candle.date
    }
  }

  const last = ordered[ordered.length - 1].close
  return { worst, peakDate, troughDate, fromPeak: highest > 0 ? last / highest - 1 : 0 }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export interface Seasonality {
  /** Calendar years with enough days to judge. */
  years: number
  /** Months where the year's high fell, most often first. */
  highMonths: { month: number; name: string; count: number }[]
  lowMonths: { month: number; name: string; count: number }[]
}

/**
 * In which month each year's high and low tended to fall.
 *
 * Only counts calendar years with most of their trading days present — a
 * part year would say its high was in the month the data starts. With a few
 * years this is a pattern to notice, not a rule to trade on, and the caller
 * is told how many years it rests on.
 */
export function seasonality(history: Candle[], minDaysPerYear = 180): Seasonality | null {
  const byYear = new Map<number, Candle[]>()
  for (const candle of history) {
    const year = Number(candle.date.slice(0, 4))
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push(candle)
  }

  const highs = new Map<number, number>()
  const lows = new Map<number, number>()
  let years = 0

  for (const candles of byYear.values()) {
    if (candles.length < minDaysPerYear) continue
    years += 1
    let high = candles[0]
    let low = candles[0]
    for (const candle of candles) {
      if (candle.close > high.close) high = candle
      if (candle.close < low.close) low = candle
    }
    const month = (c: Candle) => Number(c.date.slice(5, 7))
    highs.set(month(high), (highs.get(month(high)) ?? 0) + 1)
    lows.set(month(low), (lows.get(month(low)) ?? 0) + 1)
  }

  if (years < 2) return null

  const rank = (counts: Map<number, number>) =>
    [...counts.entries()]
      .map(([month, count]) => ({ month, name: MONTHS[month - 1], count }))
      .sort((a, b) => b.count - a.count || a.month - b.month)

  return { years, highMonths: rank(highs), lowMonths: rank(lows) }
}

export interface Earnings {
  /** From when the market could know this figure. */
  from: string
  eps: number
}

export interface PeBand {
  samples: number
  /** The first and last day a ratio could be formed for. */
  from: string
  to: string
  low: number
  median: number
  high: number
  current: number | null
  /** Where today's P/E sits in that history: 0 cheapest, 1 dearest. */
  rank: number | null
  /** What today's earnings would be worth at those multiples. */
  priceAtLow: number | null
  priceAtMedian: number | null
  priceAtHigh: number | null
}

/**
 * The P/E this company has actually traded at, and what today's earnings
 * would be worth at the cheap, middle and dear end of that range.
 *
 * Each day is valued on the earnings the market knew that day — a figure is
 * only used from the day it could have been published, not from the year end
 * it describes. Quarters are not used, so this is the last full year's
 * earnings throughout.
 */
export function peBand(
  history: Candle[],
  earnings: Earnings[],
  price: number,
  epsNow: number | null,
  from: string,
): PeBand | null {
  const known = [...earnings].sort((a, b) => (a.from < b.from ? -1 : 1))
  const ratios: number[] = []
  const days: string[] = []

  for (const candle of history) {
    if (candle.date < from) continue
    let eps: number | null = null
    for (const e of known) {
      if (e.from <= candle.date) eps = e.eps
      else break
    }
    if (eps !== null && eps > 0) {
      ratios.push(candle.close / eps)
      days.push(candle.date)
    }
  }

  if (ratios.length < 60) return null

  const low = percentile(ratios, 0.25)!
  const mid = median(ratios)!
  const high = percentile(ratios, 0.75)!
  const current = epsNow !== null && epsNow > 0 ? price / epsNow : null

  const covered = [...days].sort()
  return {
    samples: ratios.length,
    from: covered[0],
    to: covered[covered.length - 1],
    low,
    median: mid,
    high,
    current,
    rank: current === null ? null : rankOf(ratios, current),
    priceAtLow: epsNow !== null && epsNow > 0 ? low * epsNow : null,
    priceAtMedian: epsNow !== null && epsNow > 0 ? mid * epsNow : null,
    priceAtHigh: epsNow !== null && epsNow > 0 ? high * epsNow : null,
  }
}

export interface PeerComparison {
  /** How many other companies had a figure to compare. */
  peers: number
  median: number
  /** 0 = cheapest of the group, 1 = dearest. */
  rank: number
  cheaperThan: number
}

/** Today's ratio against the same ratio for other companies. */
export function compareWithPeers(value: number | null, others: number[]): PeerComparison | null {
  const usable = others.filter((v) => Number.isFinite(v) && v > 0)
  if (value === null || !Number.isFinite(value) || value <= 0 || usable.length < 3) return null

  const rank = rankOf(usable, value)!
  return {
    peers: usable.length,
    median: median(usable)!,
    rank,
    cheaperThan: usable.filter((v) => v > value).length,
  }
}
