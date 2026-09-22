import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildHolding,
  buildPortfolio,
  cashFlowOf,
  mergeBySymbol,
  xirr,
  type PortfolioTransaction,
} from './portfolio'

function txn(over: Partial<PortfolioTransaction>): PortfolioTransaction {
  return {
    accountId: 1,
    accountName: 'Personal',
    symbol: 'SQURPHARMA',
    tradeDate: '2025-01-01',
    txnType: 'buy',
    quantity: 100,
    pricePerShare: 200,
    grossAmount: null,
    commission: 0,
    taxWithheld: 0,
    ...over,
  }
}

const AS_OF = new Date('2026-09-21T00:00:00Z')

describe('cost basis', () => {
  it('includes commission in what the shares cost', () => {
    // Brokerage is part of the price of owning the thing, not a side expense.
    const h = buildHolding('X', [txn({ commission: 100 })], null, AS_OF)
    assert.equal(h.costBasis, 20100)
    assert.equal(h.averageCost, 201)
  })

  it('averages across purchases at different prices', () => {
    const h = buildHolding(
      'X',
      [
        txn({ tradeDate: '2025-01-01', quantity: 100, pricePerShare: 200 }),
        txn({ tradeDate: '2025-06-01', quantity: 100, pricePerShare: 240 }),
      ],
      null,
      AS_OF,
    )
    assert.equal(h.quantity, 200)
    assert.equal(h.averageCost, 220)
  })
})

describe('bonus issue', () => {
  it('raises quantity, leaves total cost alone, so average cost falls', () => {
    // The case every generic portfolio tracker gets wrong on DSE.
    const h = buildHolding(
      'X',
      [
        txn({ tradeDate: '2025-01-01', quantity: 100, pricePerShare: 200 }),
        txn({ tradeDate: '2025-10-01', txnType: 'bonus', quantity: 10, pricePerShare: 0 }),
      ],
      null,
      AS_OF,
    )

    assert.equal(h.quantity, 110)
    assert.equal(h.costBasis, 20000)
    assert.ok(Math.abs(h.averageCost! - 181.8181818) < 1e-6)
  })

  it('does not invent a gain out of the free shares', () => {
    const h = buildHolding(
      'X',
      [
        txn({ quantity: 100, pricePerShare: 200 }),
        txn({ tradeDate: '2025-10-01', txnType: 'bonus', quantity: 10, pricePerShare: 0 }),
      ],
      // Price unchanged in nominal terms; in reality it adjusts down.
      181.8181818,
      AS_OF,
    )
    assert.ok(Math.abs(h.unrealisedGain!) < 1e-4)
  })

  it('is applied after a buy dated the same day', () => {
    const h = buildHolding(
      'X',
      [
        txn({ tradeDate: '2025-01-01', txnType: 'bonus', quantity: 10, pricePerShare: 0 }),
        txn({ tradeDate: '2025-01-01', quantity: 100, pricePerShare: 200 }),
      ],
      null,
      AS_OF,
    )
    assert.equal(h.quantity, 110)
    assert.equal(h.costBasis, 20000)
  })
})

describe('rights issue', () => {
  it('adds shares and real cost, unlike a bonus', () => {
    const h = buildHolding(
      'X',
      [
        txn({ quantity: 100, pricePerShare: 200 }),
        txn({ tradeDate: '2025-10-01', txnType: 'rights', quantity: 50, pricePerShare: 120 }),
      ],
      null,
      AS_OF,
    )
    assert.equal(h.quantity, 150)
    assert.equal(h.costBasis, 26000)
    assert.ok(Math.abs(h.averageCost! - 173.3333333) < 1e-6)
  })
})

describe('selling', () => {
  it('realises gain against average cost and nets off commission', () => {
    const h = buildHolding(
      'X',
      [
        txn({ tradeDate: '2025-01-01', quantity: 100, pricePerShare: 200 }),
        txn({ tradeDate: '2025-06-01', txnType: 'sell', quantity: 40, pricePerShare: 250, commission: 50 }),
      ],
      null,
      AS_OF,
    )

    // Proceeds 10,000 less 50 commission, against 40 x 200 of cost.
    assert.equal(h.realisedGain, 1950)
    assert.equal(h.quantity, 60)
    assert.equal(h.costBasis, 12000)
  })

  it('clears the position exactly on a full exit', () => {
    const h = buildHolding(
      'X',
      [
        txn({ quantity: 100, pricePerShare: 200 }),
        txn({ tradeDate: '2025-06-01', txnType: 'sell', quantity: 100, pricePerShare: 210 }),
      ],
      210,
      AS_OF,
    )
    assert.equal(h.quantity, 0)
    assert.equal(h.costBasis, 0)
    assert.equal(h.realisedGain, 1000)
    assert.equal(h.marketValue, 0)
  })

  it('warns rather than going negative when the ledger is incomplete', () => {
    const h = buildHolding(
      'X',
      [
        txn({ quantity: 100, pricePerShare: 200 }),
        txn({ tradeDate: '2025-06-01', txnType: 'sell', quantity: 150, pricePerShare: 210 }),
      ],
      null,
      AS_OF,
    )
    assert.equal(h.quantity, 0)
    assert.equal(h.warnings.length, 1)
    assert.match(h.warnings[0], /only 100 held/)
  })
})

describe('dividends', () => {
  const held: PortfolioTransaction[] = [
    txn({ tradeDate: '2024-01-01', quantity: 1000, pricePerShare: 200 }),
    txn({
      tradeDate: '2026-03-01',
      txnType: 'dividend',
      quantity: null,
      pricePerShare: null,
      grossAmount: 12000,
      taxWithheld: 1200,
    }),
  ]

  it('keeps gross and net apart', () => {
    const h = buildHolding('X', held, null, AS_OF)
    assert.equal(h.dividendsGross, 12000)
    assert.equal(h.dividendsNet, 10800)
  })

  it('computes yield on cost from the gross figure', () => {
    // Net would understate what the holding actually earns.
    const h = buildHolding('X', held, null, AS_OF)
    assert.ok(Math.abs(h.yieldOnCost! - 12000 / 200000) < 1e-9)
  })

  it('counts only the trailing twelve months', () => {
    const withOld = [
      ...held,
      txn({
        tradeDate: '2020-03-01',
        txnType: 'dividend',
        quantity: null,
        pricePerShare: null,
        grossAmount: 99999,
      }),
    ]
    const h = buildHolding('X', withOld, null, AS_OF)
    assert.equal(h.dividendsGross, 111999)
    assert.ok(Math.abs(h.yieldOnCost! - 12000 / 200000) < 1e-9)
  })

  it('does not move the share count', () => {
    assert.equal(buildHolding('X', held, null, AS_OF).quantity, 1000)
  })
})

describe('cashFlowOf', () => {
  it('signs each kind of event correctly', () => {
    assert.equal(cashFlowOf(txn({ quantity: 100, pricePerShare: 200, commission: 100 })), -20100)
    assert.equal(
      cashFlowOf(txn({ txnType: 'sell', quantity: 100, pricePerShare: 200, commission: 100 })),
      19900,
    )
    assert.equal(cashFlowOf(txn({ txnType: 'bonus', quantity: 10, pricePerShare: 0 })), 0)
    assert.equal(
      cashFlowOf(
        txn({ txnType: 'dividend', quantity: null, grossAmount: 1000, taxWithheld: 100 }),
      ),
      900,
    )
  })
})

describe('xirr', () => {
  it('recovers a known rate', () => {
    // 100 out, 110 back a year later.
    const rate = xirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 110 },
    ])
    assert.ok(Math.abs(rate! - 0.1) < 1e-4, `got ${rate}`)
  })

  it('weights by when the money went in', () => {
    // Doubling down before a recovery should beat the simple percentage.
    const rate = xirr([
      { date: '2024-01-01', amount: -1000 },
      { date: '2025-07-01', amount: -1000 },
      { date: '2026-01-01', amount: 2400 },
    ])
    assert.ok(rate !== null && rate > 0.1, `got ${rate}`)
  })

  it('handles a loss', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 80 },
    ])
    assert.ok(rate! < 0)
  })

  it('returns null when there is nothing to measure', () => {
    assert.equal(xirr([]), null)
    assert.equal(xirr([{ date: '2025-01-01', amount: -100 }]), null)
    assert.equal(
      xirr([
        { date: '2025-01-01', amount: -100 },
        { date: '2026-01-01', amount: -50 },
      ]),
      null,
      'all outflows has no return',
    )
  })
})

describe('buildPortfolio', () => {
  const transactions: PortfolioTransaction[] = [
    txn({ symbol: 'SQURPHARMA', tradeDate: '2025-01-02', quantity: 500, pricePerShare: 200, commission: 400 }),
    txn({ symbol: 'LHB', tradeDate: '2025-02-02', quantity: 1500, pricePerShare: 50, commission: 400 }),
    txn({
      symbol: 'SQURPHARMA',
      tradeDate: '2026-03-01',
      txnType: 'dividend',
      quantity: null,
      pricePerShare: null,
      grossAmount: 6000,
      taxWithheld: 600,
    }),
  ]

  const prices = new Map([
    ['SQURPHARMA', 215.9],
    ['LHB', 54],
  ])

  const portfolio = buildPortfolio(transactions, prices, AS_OF)

  it('orders holdings by what they are worth', () => {
    assert.deepEqual(portfolio.holdings.map((h) => h.symbol), ['SQURPHARMA', 'LHB'])
  })

  it('totals cost and market value', () => {
    assert.equal(portfolio.totalCost, 100400 + 75400)
    assert.ok(Math.abs(portfolio.totalMarketValue - (500 * 215.9 + 1500 * 54)) < 1e-6)
  })

  it('reports concentration in the largest position', () => {
    assert.ok(portfolio.largestWeight! > 0.4 && portfolio.largestWeight! < 0.6)
  })

  it('produces a money-weighted return', () => {
    assert.ok(portfolio.xirr !== null)
  })

  it('is empty rather than broken with no transactions', () => {
    const empty = buildPortfolio([], prices, AS_OF)
    assert.deepEqual(empty.holdings, [])
    assert.equal(empty.totalCost, 0)
    assert.equal(empty.xirr, null)
    assert.equal(empty.largestWeight, null)
  })
})

describe('multiple BO accounts', () => {
  const PERSONAL = { accountId: 1, accountName: 'Personal' }
  const JOINT = { accountId: 2, accountName: 'Joint' }

  it('never matches a sale against another account’s cheaper shares', () => {
    // Bought cheap in Personal, dear in Joint, then sold from Joint. Pooling
    // the two would cost the sale at the blended ৳150 and report a ৳5,000 gain
    // that did not happen. Per account, Joint sold at exactly its cost.
    const portfolio = buildPortfolio(
      [
        txn({ ...PERSONAL, tradeDate: '2025-01-01', quantity: 100, pricePerShare: 100 }),
        txn({ ...JOINT, tradeDate: '2025-02-01', quantity: 100, pricePerShare: 200 }),
        txn({ ...JOINT, tradeDate: '2025-06-01', txnType: 'sell', quantity: 100, pricePerShare: 200 }),
      ],
      new Map([['SQURPHARMA', 200]]),
      AS_OF,
    )

    assert.equal(portfolio.totalRealised, 0)

    const joint = portfolio.positions.find((p) => p.accountId === 2)!
    assert.equal(joint.quantity, 0)
    assert.equal(joint.realisedGain, 0)

    const personal = portfolio.positions.find((p) => p.accountId === 1)!
    assert.equal(personal.quantity, 100)
    assert.equal(personal.averageCost, 100)
  })

  it('warns per account, naming the account', () => {
    // 100 held in Personal does not cover a 50-share sale from Joint.
    const portfolio = buildPortfolio(
      [
        txn({ ...PERSONAL, quantity: 100, pricePerShare: 100 }),
        txn({ ...JOINT, tradeDate: '2025-06-01', txnType: 'sell', quantity: 50, pricePerShare: 120 }),
      ],
      new Map(),
      AS_OF,
    )
    const warnings = portfolio.holdings.flatMap((h) => h.warnings)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /^Joint · SQURPHARMA/)
  })

  it('combines the same stock across accounts by summing positions', () => {
    const portfolio = buildPortfolio(
      [
        txn({ ...PERSONAL, quantity: 100, pricePerShare: 100 }),
        txn({ ...JOINT, tradeDate: '2025-02-01', quantity: 300, pricePerShare: 200 }),
      ],
      new Map([['SQURPHARMA', 210]]),
      AS_OF,
    )

    assert.equal(portfolio.holdings.length, 1)
    const combined = portfolio.holdings[0]
    assert.equal(combined.quantity, 400)
    assert.equal(combined.costBasis, 70000)
    assert.equal(combined.averageCost, 175)
    assert.equal(combined.accountCount, 2)
    assert.equal(combined.accountId, null)
    assert.equal(combined.marketValue, 84000)
  })

  it('scopes to one account when asked', () => {
    const all = [
      txn({ ...PERSONAL, quantity: 100, pricePerShare: 100 }),
      txn({ ...JOINT, symbol: 'LHB', quantity: 1000, pricePerShare: 50 }),
    ]
    const prices = new Map([
      ['SQURPHARMA', 110],
      ['LHB', 55],
    ])

    const joint = buildPortfolio(all, prices, AS_OF, 2)
    assert.deepEqual(joint.holdings.map((h) => h.symbol), ['LHB'])
    assert.equal(joint.totalCost, 50000)
    assert.equal(joint.byAccount.length, 1)
  })

  it('reports totals for each account', () => {
    const portfolio = buildPortfolio(
      [
        txn({ ...PERSONAL, quantity: 100, pricePerShare: 100 }),
        txn({ ...JOINT, symbol: 'LHB', quantity: 1000, pricePerShare: 50 }),
      ],
      new Map([
        ['SQURPHARMA', 110],
        ['LHB', 55],
      ]),
      AS_OF,
    )

    const byName = Object.fromEntries(portfolio.byAccount.map((a) => [a.accountName, a]))
    assert.equal(byName.Personal.totalCost, 10000)
    assert.equal(byName.Personal.totalUnrealised, 1000)
    assert.equal(byName.Joint.totalCost, 50000)
    assert.equal(byName.Joint.totalUnrealised, 5000)
  })

  it('leaves a single-account stock exactly as it was', () => {
    const one = buildHolding('X', [txn({ quantity: 100, pricePerShare: 100 })], 110, AS_OF, {
      id: 1,
      name: 'Personal',
    })
    assert.deepEqual(mergeBySymbol([one])[0], one)
  })
})

describe('annualising', () => {
  const opening = (date: string) => [
    txn({ tradeDate: date, quantity: 850, pricePerShare: 183424.5 / 850 }),
  ]

  it('refuses to annualise a day of history', () => {
    // The bug this guards against: a 0.5% move over one day reported as an
    // "annual return" of 524%.
    const p = buildPortfolio(opening('2026-09-22'), new Map([['SQURPHARMA', 215.8 * 1.005]]), new Date('2026-09-23T12:00:00Z'))
    assert.equal(p.xirr, null)
    assert.equal(p.historyDays, 1)
  })

  it('still refuses at eleven months', () => {
    const p = buildPortfolio(opening('2025-10-22'), new Map([['SQURPHARMA', 230]]), new Date('2026-09-22T12:00:00Z'))
    assert.equal(p.xirr, null)
  })

  it('annualises once there is a full year', () => {
    const p = buildPortfolio(opening('2025-09-22'), new Map([['SQURPHARMA', 230]]), new Date('2026-09-22T12:00:00Z'))
    assert.ok(p.xirr !== null)
    assert.ok(p.historyDays >= 365)
  })
})
