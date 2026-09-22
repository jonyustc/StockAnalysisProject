import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PortfolioTransaction } from './portfolio'
import { incomeYear, incomeYearOf, incomeYearReport } from './tax-year'

function t(over: Partial<PortfolioTransaction>): PortfolioTransaction {
  return {
    accountId: 1,
    symbol: 'AAA',
    tradeDate: '2025-08-01',
    txnType: 'buy',
    quantity: 100,
    pricePerShare: 100,
    grossAmount: null,
    commission: 40,
    taxWithheld: 0,
    ...over,
  }
}

describe('income year', () => {
  it('runs 1 July to 30 June', () => {
    assert.equal(incomeYearOf('2025-07-01'), 2025)
    assert.equal(incomeYearOf('2026-06-30'), 2025)
    assert.equal(incomeYearOf('2026-07-01'), 2026)
    assert.deepEqual(incomeYear(2025), { start: 2025, label: '2025–26', from: '2025-07-01', to: '2026-06-30' })
  })
})

describe('incomeYearReport', () => {
  const names = new Map([[1, 'Personal']])
  const ledger = [
    t({ tradeDate: '2025-06-15', quantity: 50, pricePerShare: 80, commission: 16 }), // before the year
    t({}),
    t({ tradeDate: '2026-03-01', txnType: 'sell', quantity: 60, pricePerShare: 120, commission: 28.8 }),
    t({ tradeDate: '2026-04-10', txnType: 'dividend', quantity: null, pricePerShare: null, grossAmount: 900, taxWithheld: 90, recordDate: '2026-03-20' }),
    t({ tradeDate: '2026-07-05', txnType: 'sell', quantity: 10, pricePerShare: 150, commission: 6 }), // after
  ]
  const moves = [
    { accountId: 1, date: '2025-06-10', kind: 'deposit', amount: 4016 },
    { accountId: 1, date: '2025-07-20', kind: 'deposit', amount: 10040 },
    { accountId: 1, date: '2026-01-05', kind: 'fee', amount: -150 },
    { accountId: 1, date: '2026-04-10', kind: 'dividend', amount: 810 },
  ]
  const r = incomeYearReport(2025, ledger, moves, new Set([1]), names)

  it('lists the dividends paid in the year, gross and tax', () => {
    assert.deepEqual(r.dividendTotals, { gross: 900, tax: 90, net: 810 })
    assert.equal(r.dividends[0].recordDate, '2026-03-20')
  })

  it('counts only sales in the year, costed with the history before it', () => {
    // 150 held at (4,016 + 10,040) / 150 = 93.7067; 60 sold for 7,200 − 28.80.
    assert.equal(r.sales.length, 1)
    assert.ok(Math.abs(r.realised - (7200 - 28.8 - 60 * (14056 / 150))) < 1e-6)
    assert.equal(r.commission, 40 + 28.8)
  })

  it('reports holdings at cost on 30 June', () => {
    assert.equal(r.heldAtEnd.length, 1)
    assert.equal(r.heldAtEnd[0].quantity, 90)
    assert.ok(Math.abs(r.costAtEnd - 90 * (14056 / 150)) < 1e-6)
  })

  it('reports money in and out, and rebuilds cash at the year end', () => {
    assert.equal(r.deposited, 10040)
    assert.equal(r.fees, 150)
    // All deposits, less both buys, plus the sale, less the fee, plus the dividend.
    assert.ok(Math.abs(r.cashAtEnd - (4016 + 10040 - 4016 - 10040 + 7171.2 - 150 + 810)) < 1e-6)
    assert.deepEqual(r.cashUnknown, [])
  })

  it('leaves cash out for an account without a complete ledger', () => {
    const partial = incomeYearReport(2025, ledger, moves, new Set(), names)
    assert.equal(partial.cashAtEnd, 0)
    assert.deepEqual(partial.cashUnknown, ['Personal'])
  })
})
