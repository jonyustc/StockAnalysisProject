import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PortfolioTransaction } from './portfolio'
import {
  breakEvenPrice,
  commissionRate,
  DEFAULT_COMMISSION_RATE,
  evaluateTarget,
  priceForGain,
  sortByUrgency,
  type Target,
} from './targets'

function trade(over: Partial<PortfolioTransaction>): PortfolioTransaction {
  return {
    accountId: 1,
    symbol: 'AAA',
    tradeDate: '2026-01-01',
    txnType: 'buy',
    quantity: 100,
    pricePerShare: 100,
    grossAmount: null,
    commission: 40,
    taxWithheld: 0,
    ...over,
  }
}

const target = (over: Partial<Target>): Target => ({
  id: 1,
  symbol: 'AAA',
  accountId: null,
  accountName: null,
  buyBelow: null,
  sellAbove: null,
  note: null,
  ...over,
})

describe('commission and break-even', () => {
  it('uses the rate actually paid', () => {
    const rate = commissionRate([trade({}), trade({ txnType: 'sell' }), trade({ commission: 40 })])
    assert.equal(rate, 0.004)
  })

  it('falls back to a typical rate with too few trades', () => {
    assert.equal(commissionRate([trade({})]), DEFAULT_COMMISSION_RATE)
  })

  it('finds the price that gets the cost back after the sale’s commission', () => {
    // 100.40 average cost (buy commission in), 0.4% to sell.
    const be = breakEvenPrice(100.4, 0.004)
    assert.ok(Math.abs(be * (1 - 0.004) - 100.4) < 1e-9)
    assert.ok(priceForGain(100.4, 0.05, 0.004) > be * 1.049)
  })
})

describe('evaluateTarget', () => {
  const held = { quantity: 100, averageCost: 100.4, netCostPerShare: 95 }

  it('reports a buy target reached when the price is at or below it', () => {
    const s = evaluateTarget(target({ buyBelow: 95 }), { close: 94.5, tradeDate: '2026-02-01' }, held, 0.004)
    assert.equal(s.buy?.reached, true)
    assert.equal(s.sell, null)
  })

  it('reports a sell target near when within 2%', () => {
    const s = evaluateTarget(target({ sellAbove: 110 }), { close: 108.5, tradeDate: '2026-02-01' }, held, 0.004)
    assert.equal(s.sell?.reached, false)
    assert.equal(s.sell?.near, true)
    assert.ok(Math.abs(s.sell!.toGo! - (110 - 108.5) / 108.5) < 1e-12)
  })

  it('warns when a sell target is below break-even', () => {
    const s = evaluateTarget(target({ sellAbove: 100.5 }), { close: 99, tradeDate: '2026-02-01' }, held, 0.004)
    assert.match(s.warnings[0], /loses money/)
  })

  it('warns when there is nothing to sell', () => {
    const s = evaluateTarget(target({ sellAbove: 120 }), { close: 99, tradeDate: '2026-02-01' }, null, 0.004)
    assert.match(s.warnings[0], /Nothing held/)
  })

  it('does not call anything reached without a price', () => {
    const s = evaluateTarget(target({ buyBelow: 95 }), null, held, 0.004)
    assert.equal(s.buy?.reached, false)
    assert.match(s.warnings.join(' '), /No price/)
  })

  it('puts reached targets first', () => {
    const quiet = evaluateTarget(target({ id: 1, symbol: 'AAA', buyBelow: 50 }), { close: 100, tradeDate: 'd' }, null, 0.004)
    const hit = evaluateTarget(target({ id: 2, symbol: 'ZZZ', buyBelow: 120 }), { close: 100, tradeDate: 'd' }, null, 0.004)
    assert.deepEqual(sortByUrgency([quiet, hit]).map((s) => s.target.id), [2, 1])
  })
})
