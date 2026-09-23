import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Candle } from './insights'
import { dailyReturns, movingAverage, priceStats, scenarios } from './price-stats'

const days = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), close }))

describe('movingAverage', () => {
  it('waits until it has enough days, then averages them', () => {
    assert.deepEqual(movingAverage(days([10, 20, 30, 40]), 3), [null, null, 20, 30])
  })

  it('has nothing to say about a series shorter than its window', () => {
    assert.deepEqual(movingAverage(days([10, 20]), 3), [null, null])
  })
})

describe('dailyReturns', () => {
  it('measures each day against the one before', () => {
    const returns = dailyReturns(days([100, 110, 99]))
    assert.ok(Math.abs(returns[0] - 0.1) < 1e-12)
    assert.ok(Math.abs(returns[1] - -0.1) < 1e-12)
  })
})

describe('priceStats', () => {
  it('reports the moves and where the price sits against its averages', () => {
    // 300 days climbing steadily: the price leads both averages, and the
    // shorter one — being nearer the recent, higher prices — leads the longer.
    const stats = priceStats(days(Array.from({ length: 300 }, (_, i) => 100 + i)))
    assert.ok(stats.ma50! > stats.ma200!)
    assert.ok(stats.aboveMa50! > 0 && stats.aboveMa200! > 0)
    assert.ok(stats.changeMonth! > 0)
    assert.ok(stats.volatility! > 0)
  })

  it('leaves out what a short history cannot support', () => {
    const stats = priceStats(days([100, 101, 102]))
    assert.equal(stats.ma50, null)
    assert.equal(stats.ma200, null)
    assert.equal(stats.changeYear, null)
    assert.ok(stats.typicalDailyMove! > 0)
  })

  it('says nothing at all about an empty history', () => {
    const stats = priceStats([])
    assert.deepEqual(
      [stats.volatility, stats.ma50, stats.changeMonth, stats.typicalDailyMove],
      [null, null, null, null],
    )
  })
})

describe('scenarios', () => {
  const input = {
    price: 200,
    quantity: 100,
    costBasis: 21_000,
    levels: [
      { label: 'Cheap end', basis: 'its own P/E range', price: 180 },
      { label: 'Dear end', basis: 'its own P/E range', price: 260 },
      { label: 'Unknown', basis: 'no figure', price: null },
    ],
  }

  it('works out the move and what the holding would be worth there', () => {
    const [cheap, dear] = scenarios(input)
    assert.equal(cheap.price, 180)
    assert.ok(Math.abs(cheap.move - -0.1) < 1e-12)
    assert.equal(cheap.value, 18_000)
    assert.equal(cheap.gain, -3_000)
    assert.ok(Math.abs(dear.gainPct! - (26_000 - 21_000) / 21_000) < 1e-12)
  })

  it('leaves out a level there is no figure for, and sorts by price', () => {
    assert.deepEqual(scenarios(input).map((s) => s.label), ['Cheap end', 'Dear end'])
  })

  it('gives no holding value when nothing is held', () => {
    const [only] = scenarios({ ...input, quantity: 0, costBasis: 0 })
    assert.equal(only.value, null)
    assert.equal(only.gain, null)
  })
})
