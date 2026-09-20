import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  adjustPerShareValue,
  adjustmentFactorFor,
  cagr,
  cumulativeAdjustmentFactor,
  rightsIssueFactor,
  splitFactor,
  stockDividendFactor,
  type CorporateActionInput,
} from './corporate-actions'

const CLOSE_ENOUGH = 1e-9

describe('stockDividendFactor', () => {
  it('shrinks per-share figures by the bonus ratio', () => {
    // 100 shares become 110; EPS of 11.00 becomes 10.00.
    assert.ok(Math.abs(stockDividendFactor(10) - 1 / 1.1) < CLOSE_ENOUGH)
    assert.ok(Math.abs(11 * stockDividendFactor(10) - 10) < CLOSE_ENOUGH)
  })

  it('is neutral at zero', () => {
    assert.equal(stockDividendFactor(0), 1)
  })

  it('refuses a dividend that would wipe out the share base', () => {
    assert.throws(() => stockDividendFactor(-100), RangeError)
  })
})

describe('splitFactor', () => {
  it('halves per-share figures on a one-for-two split', () => {
    assert.equal(splitFactor(1, 2), 0.5)
  })

  it('doubles them on a reverse split', () => {
    assert.equal(splitFactor(2, 1), 2)
  })

  it('rejects a non-positive ratio', () => {
    assert.throws(() => splitFactor(0, 2), RangeError)
  })
})

describe('rightsIssueFactor', () => {
  it('uses the theoretical ex-rights price when one is available', () => {
    // 1 new share per 2 held at ৳100, market ৳200.
    // TERP = (2*200 + 1*100) / 3 = 166.67 ; factor = 166.67 / 200
    const factor = rightsIssueFactor({
      newShares: 1,
      perExisting: 2,
      rightsPrice: 100,
      cumRightsPrice: 200,
    })
    assert.ok(Math.abs(factor - 5 / 6) < CLOSE_ENOUGH)
  })

  it('falls back to share count alone when the cum price is unknown', () => {
    const factor = rightsIssueFactor({ newShares: 1, perExisting: 2 })
    assert.ok(Math.abs(factor - 2 / 3) < CLOSE_ENOUGH)
  })

  it('is neutral when rights are priced at market', () => {
    // No transfer of value, so nothing to adjust for.
    const factor = rightsIssueFactor({
      newShares: 1,
      perExisting: 1,
      rightsPrice: 150,
      cumRightsPrice: 150,
    })
    assert.ok(Math.abs(factor - 1) < CLOSE_ENOUGH)
  })
})

describe('adjustmentFactorFor', () => {
  it('leaves a cash dividend alone — it does not change the share count', () => {
    assert.equal(
      adjustmentFactorFor({ actionType: 'cash_dividend', cashPerShare: 20 } as CorporateActionInput),
      1,
    )
  })

  it('is neutral when the defining fields are missing', () => {
    assert.equal(adjustmentFactorFor({ actionType: 'stock_dividend' }), 1)
    assert.equal(adjustmentFactorFor({ actionType: 'rights_issue' }), 1)
    assert.equal(adjustmentFactorFor({ actionType: 'split' }), 1)
  })
})

describe('cumulativeAdjustmentFactor', () => {
  const actions: CorporateActionInput[] = [
    { actionType: 'stock_dividend', stockDividendPct: 10, exDate: '2019-10-01' },
    { actionType: 'stock_dividend', stockDividendPct: 20, exDate: '2022-11-15' },
    { actionType: 'cash_dividend', exDate: '2024-10-01' },
  ]

  it('compounds every action after the figure being adjusted', () => {
    const expected = (1 / 1.1) * (1 / 1.2)
    assert.ok(Math.abs(cumulativeAdjustmentFactor(actions, '2018-06-30') - expected) < CLOSE_ENOUGH)
  })

  it('ignores actions already baked into the reported figure', () => {
    const expected = 1 / 1.2
    assert.ok(Math.abs(cumulativeAdjustmentFactor(actions, '2020-06-30') - expected) < CLOSE_ENOUGH)
  })

  it('leaves the most recent year untouched', () => {
    assert.equal(cumulativeAdjustmentFactor(actions, '2025-06-30'), 1)
  })

  it('skips actions with no ex-date rather than guessing', () => {
    const undated: CorporateActionInput[] = [
      { actionType: 'stock_dividend', stockDividendPct: 50, exDate: null },
    ]
    assert.equal(cumulativeAdjustmentFactor(undated, '2018-06-30'), 1)
  })

  it('restates an old EPS onto the current share base', () => {
    // Reported EPS 13.20 in FY2018, then 10% and 20% bonuses.
    const adjusted = adjustPerShareValue(13.2, actions, '2018-06-30')
    assert.ok(Math.abs(adjusted - 10) < 1e-9)
  })
})

describe('cagr', () => {
  it('computes compound growth', () => {
    assert.ok(Math.abs(cagr(100, 200, 10)! - (Math.pow(2, 0.1) - 1)) < CLOSE_ENOUGH)
  })

  it('returns null rather than a misleading number for a loss-making base', () => {
    // A sign change cannot be expressed as a growth rate. Common in a
    // ten-year DSE history and a classic source of nonsense figures.
    assert.equal(cagr(-50, 200, 5), null)
    assert.equal(cagr(100, -20, 5), null)
    assert.equal(cagr(0, 100, 5), null)
  })

  it('returns null for a non-positive period', () => {
    assert.equal(cagr(100, 200, 0), null)
  })
})
