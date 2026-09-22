import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  alreadyRecorded,
  detectPaidDividends,
  incomeByYear,
  matchCompany,
  projectIncome,
  type StoredReceivable,
} from './dividends'
import type { PortfolioTransaction } from './portfolio'

const COMPANIES = [
  { symbol: 'MARICO', name: 'Marico Bangladesh Limited', shortName: 'Marico' },
  { symbol: 'BSRMSTEEL', name: 'BSRM Steels Limited', shortName: 'BSRM Steels' },
  { symbol: 'BSRMLTD', name: 'Bangladesh Steel Re-Rolling Mills Limited', shortName: 'BSRM Ltd' },
  { symbol: 'SQURPHARMA', name: 'Square Pharmaceuticals PLC', shortName: 'Square Pharma' },
]

describe('matchCompany', () => {
  it('matches an abbreviated name', () => {
    assert.equal(matchCompany('Marico Bangladesh', COMPANIES), 'MARICO')
    assert.equal(matchCompany('SQUARE PHARMACEUTICALS PLC.', COMPANIES), 'SQURPHARMA')
  })

  it('prefers the more specific of two similar names', () => {
    // "BSRM Ltd" is just "BSRM" once "Ltd" is dropped.
    assert.equal(matchCompany('BSRM Steels Ltd', COMPANIES), 'BSRMSTEEL')
    assert.equal(matchCompany('Bangladesh Steel Re-Rolling Mills', COMPANIES), 'BSRMLTD')
  })

  it('refuses to guess', () => {
    assert.equal(matchCompany('BSRM', COMPANIES), null)
    assert.equal(matchCompany('Grameenphone', COMPANIES), null)
    assert.equal(matchCompany('', COMPANIES), null)
  })
})

function receivable(over: Partial<StoredReceivable>): StoredReceivable {
  return {
    companyName: 'Marico Bangladesh',
    symbol: 'MARICO',
    holding: 10,
    rate: 50,
    entitlement: 500,
    recordDate: '2026-08-27',
    ...over,
  }
}

describe('detectPaidDividends', () => {
  it('splits a paid dividend into gross and the tax withheld', () => {
    const r = detectPaidDividends([receivable({})], [], 450)
    assert.equal(r.paid.length, 1)
    assert.equal(r.paid[0].gross, 500)
    assert.equal(r.paid[0].taxWithheld, 50)
    assert.equal(r.paid[0].caveat, null)
    assert.equal(r.unexplained, 0)
  })

  it('does nothing while it is still on the list', () => {
    const r = detectPaidDividends([receivable({})], [receivable({})], 0)
    assert.deepEqual(r.paid, [])
  })

  it('shares the credit in proportion when two are paid together', () => {
    const r = detectPaidDividends(
      [receivable({}), receivable({ companyName: 'Square', symbol: 'SQURPHARMA', entitlement: 1500 })],
      [],
      1800,
    )
    assert.deepEqual(r.paid.map((p) => p.taxWithheld), [50, 150])
  })

  it('does not call a vanished dividend paid if no cash arrived', () => {
    const r = detectPaidDividends([receivable({})], [], 0)
    assert.deepEqual(r.paid, [])
  })

  it('flags a split that is not plausible tax', () => {
    const r = detectPaidDividends([receivable({})], [], 200)
    assert.match(r.paid[0].caveat ?? '', /40%/)
  })

  it('reports dividend cash no receivable explains', () => {
    assert.equal(detectPaidDividends([], [], 90).unexplained, 90)
    // More arrived than was due: the excess is unexplained, not tax.
    const r = detectPaidDividends([receivable({})], [], 600)
    assert.equal(r.paid[0].taxWithheld, 0)
    assert.equal(r.unexplained, 100)
  })
})

function txn(over: Partial<PortfolioTransaction>): PortfolioTransaction {
  return {
    accountId: 1,
    symbol: 'MARICO',
    tradeDate: '2026-09-01',
    txnType: 'dividend',
    quantity: null,
    pricePerShare: null,
    grossAmount: 500,
    commission: 0,
    taxWithheld: 50,
    ...over,
  }
}

describe('alreadyRecorded', () => {
  const ledger = [txn({})]
  it('finds a matching dividend', () => {
    assert.equal(alreadyRecorded(ledger, 1, 'MARICO', 500, '2026-08-27'), true)
  })
  it('does not match another account, amount or an earlier payment', () => {
    assert.equal(alreadyRecorded(ledger, 2, 'MARICO', 500, '2026-08-27'), false)
    assert.equal(alreadyRecorded(ledger, 1, 'MARICO', 400, '2026-08-27'), false)
    assert.equal(alreadyRecorded(ledger, 1, 'MARICO', 500, '2026-09-15'), false)
  })
})

describe('incomeByYear', () => {
  it('sums dividends per calendar year, newest first', () => {
    const years = incomeByYear([
      txn({ tradeDate: '2025-05-01', grossAmount: 100, taxWithheld: 10 }),
      txn({ tradeDate: '2026-05-01', grossAmount: 200, taxWithheld: 20 }),
      txn({ tradeDate: '2026-09-01', grossAmount: 300, taxWithheld: 30 }),
      txn({ txnType: 'buy', quantity: 1, pricePerShare: 1, grossAmount: null }),
    ])
    assert.deepEqual(
      years.map((y) => [y.year, y.gross, y.net, y.payments]),
      [
        [2026, 500, 450, 2],
        [2025, 100, 90, 1],
      ],
    )
  })
})

describe('projectIncome', () => {
  it('projects from the last dividend and yields on value and cost', () => {
    const p = projectIncome(
      [
        { symbol: 'A', quantity: 100, costBasis: 1000, marketValue: 2000 },
        { symbol: 'B', quantity: 10, costBasis: 500, marketValue: 400 },
      ],
      new Map([['A', { dividendPerShare: 1, fiscalYear: 2025 }]]),
    )
    assert.equal(p.annualIncome, 100)
    // B has no known dividend and is left out of the yields, not counted as 0.
    assert.equal(p.yieldOnValue, 0.05)
    assert.equal(p.yieldOnCost, 0.1)
    assert.equal(p.rows.find((r) => r.symbol === 'B')!.annualIncome, null)
  })
})
