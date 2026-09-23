import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  compareWithPeers,
  drawdown,
  median,
  peBand,
  percentile,
  rangeOver,
  rankOf,
  seasonality,
  type Candle,
} from './insights'

/** A year of daily closes following `shape`, one per weekday. */
function series(year: number, shape: (dayOfYear: number) => number): Candle[] {
  const out: Candle[] = []
  const date = new Date(Date.UTC(year, 0, 1))
  for (let i = 0; date.getUTCFullYear() === year; i += 1) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      out.push({ date: date.toISOString().slice(0, 10), close: shape(i) })
    }
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return out
}

describe('statistics', () => {
  it('finds medians, percentiles and ranks', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(median([]), null)
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
    assert.equal(percentile([10, 20], 0.25), 12.5)
    assert.equal(rankOf([1, 2, 3, 4], 3), 0.625)
  })
})

describe('rangeOver', () => {
  const history: Candle[] = [
    { date: '2026-01-05', close: 100 },
    { date: '2026-03-10', close: 140 },
    { date: '2026-06-20', close: 90 },
    { date: '2026-09-01', close: 120 },
  ]

  it('reports the high and low with their dates, and where the price sits', () => {
    const r = rangeOver(history, '2026-01-01', 120)!
    assert.deepEqual([r.high, r.highDate, r.low, r.lowDate], [140, '2026-03-10', 90, '2026-06-20'])
    assert.ok(Math.abs(r.position! - 0.6) < 1e-9)
    assert.ok(Math.abs(r.belowHigh - (120 / 140 - 1)) < 1e-9)
  })

  it('only looks at the window asked for', () => {
    const r = rangeOver(history, '2026-05-01', 120)!
    assert.equal(r.high, 120)
    assert.equal(r.low, 90)
    assert.equal(r.days, 2)
  })
})

describe('drawdown', () => {
  it('finds the deepest fall from a peak, and the fall from the highest so far', () => {
    const d = drawdown([
      { date: '2026-01-01', close: 100 },
      { date: '2026-02-01', close: 150 },
      { date: '2026-03-01', close: 75 },
      { date: '2026-04-01', close: 120 },
    ])!
    assert.ok(Math.abs(d.worst - -0.5) < 1e-9)
    assert.deepEqual([d.peakDate, d.troughDate], ['2026-02-01', '2026-03-01'])
    assert.ok(Math.abs(d.fromPeak - (120 / 150 - 1)) < 1e-9)
  })
})

describe('seasonality', () => {
  it('reports the months the yearly high and low tended to fall in', () => {
    // Each year peaks around day 60 (March) and bottoms around day 200 (July).
    const shape = (d: number) => 100 + 40 * Math.exp(-((d - 60) ** 2) / 800) - 30 * Math.exp(-((d - 200) ** 2) / 800)
    const s = seasonality([...series(2023, shape), ...series(2024, shape), ...series(2025, shape)])!
    assert.equal(s.years, 3)
    assert.equal(s.highMonths[0].name, 'March')
    assert.equal(s.lowMonths[0].name, 'July')
  })

  it('ignores part years, and says nothing with under two full ones', () => {
    const flat = (d: number) => 100 + d
    const partial = series(2025, flat).slice(0, 50)
    // One full year plus a part year is not a pattern.
    assert.equal(seasonality([...series(2024, flat), ...partial]), null)
    assert.equal(seasonality(partial), null)
    // Two full years are, and the part year is still left out.
    const two = seasonality([...series(2023, flat), ...series(2024, flat), ...partial])!
    assert.equal(two.years, 2)
  })
})

describe('peBand', () => {
  // Two years around EPS 10, with the price wandering between 80 and 160.
  const history = [...series(2024, (d) => 80 + (d % 80)), ...series(2025, (d) => 80 + (d % 80))]
  const earnings = [
    { from: '2023-09-30', eps: 10 },
    { from: '2024-09-30', eps: 10 },
  ]

  it('measures the multiples it has traded at, and prices today’s earnings at them', () => {
    const band = peBand(history, earnings, 130, 10, '2024-01-01')!
    assert.ok(band.samples > 400)
    assert.ok(band.low < band.median && band.median < band.high)
    assert.equal(band.current, 13)
    // Prices implied by those multiples, at EPS 10.
    assert.ok(Math.abs(band.priceAtMedian! - band.median * 10) < 1e-9)
    assert.ok(band.rank! > 0 && band.rank! < 1)
  })

  it('uses the earnings the market knew that day', () => {
    // Published only from mid-2025: the days before it form no ratio, so the
    // band rests on the second half of 2025 alone, not on two years.
    const late = peBand(history, [{ from: '2025-06-30', eps: 10 }], 130, 10, '2024-01-01')!
    const weekdaysAfter = history.filter((c) => c.date >= '2025-06-30').length
    assert.equal(late.samples, weekdaysAfter)
    assert.ok(late.samples < peBand(history, earnings, 130, 10, '2024-01-01')!.samples)
  })

  it('says nothing without enough days', () => {
    assert.equal(peBand(history.slice(0, 30), earnings, 130, 10, '2024-01-01'), null)
  })
})

describe('compareWithPeers', () => {
  it('places a ratio among the others', () => {
    const c = compareWithPeers(8, [12, 15, 20, 9])!
    assert.equal(c.peers, 4)
    assert.equal(c.median, 13.5)
    assert.equal(c.cheaperThan, 4)
    assert.equal(c.rank, 0)
  })

  it('refuses a meaningless comparison', () => {
    assert.equal(compareWithPeers(null, [10, 11, 12]), null)
    assert.equal(compareWithPeers(-3, [10, 11, 12]), null)
    assert.equal(compareWithPeers(10, [11, 12]), null)
  })
})
