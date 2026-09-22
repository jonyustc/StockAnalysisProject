import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checkAccount, ledgerCoverage, type CheckInput } from './checks'
import type { PortfolioTransaction } from './portfolio'

function txn(over: Partial<PortfolioTransaction>): PortfolioTransaction {
  return {
    accountId: 1,
    symbol: 'AAA',
    tradeDate: '2026-01-02',
    txnType: 'buy',
    quantity: 10,
    pricePerShare: 100,
    grossAmount: null,
    commission: 4,
    taxWithheld: 0,
    ...over,
  }
}

// Deposit 2,000; buy 10 at 100 (+4); sell 4 at 120 (−1.92); fee 150; dividend 45 net.
const base: CheckInput = {
  snapshot: {
    asOf: '2026-01-31',
    cashBalance: 2000 - 1004 + 478.08 - 150 + 45,
    deposit: 2000,
    withdraw: 0,
    cashDividend: 45,
    realisedGain: 478.08 - 4 * 100.4,
    marketValue: 660,
    costOfHoldings: 602.4,
    holdings: [{ symbol: 'AAA', quantity: 6, costAmount: 602.4 }],
  },
  transactions: [
    txn({}),
    txn({ tradeDate: '2026-01-05', txnType: 'sell', quantity: 4, pricePerShare: 120, commission: 1.92 }),
    txn({ tradeDate: '2026-01-20', txnType: 'dividend', quantity: null, pricePerShare: null, grossAmount: 50, commission: 0, taxWithheld: 5 }),
  ],
  movements: [
    { date: '2026-01-01', kind: 'deposit', amount: 2000 },
    { date: '2026-01-10', kind: 'fee', amount: -150 },
    { date: '2026-01-20', kind: 'dividend', amount: 45 },
  ],
  ledgers: [{ from: '2025-07-01', to: '2026-01-31', openingBalance: 0 }],
}

describe('checkAccount', () => {
  it('passes every check when the history is complete and right', () => {
    const r = checkAccount(base)
    assert.equal(r.complete, true)
    for (const c of [...r.holdings, ...r.account]) assert.equal(c.ok, true, `${c.label}: ${c.ours} vs ${c.broker}`)
  })

  it('pinpoints a missing trade', () => {
    const r = checkAccount({ ...base, transactions: base.transactions.filter((t) => t.txnType !== 'sell') })
    const failed = [...r.holdings, ...r.account].filter((c) => c.ok === false).map((c) => c.label)
    assert.deepEqual(failed, ['AAA shares', 'Cash balance', 'Realised gain'])
  })

  it('pinpoints a missing deposit', () => {
    const r = checkAccount({ ...base, movements: base.movements.slice(1) })
    const failed = r.account.filter((c) => c.ok === false).map((c) => c.label)
    assert.deepEqual(failed, ['Cash balance', 'Deposited'])
  })

  it('flags a dividend the broker credited but no stock has', () => {
    const r = checkAccount({ ...base, transactions: base.transactions.filter((t) => t.txnType !== 'dividend') })
    assert.equal(r.account.find((c) => c.label === 'Dividends recorded against stocks')!.ok, false)
  })

  it('does not judge lifetime totals without a complete ledger', () => {
    const r = checkAccount({ ...base, ledgers: [] })
    assert.equal(r.complete, false)
    assert.ok(r.account.every((c) => c.ok === null))
    // Holdings can still be checked.
    assert.ok(r.holdings.every((c) => c.ok === true))
  })

  it('ignores trades after the statement date', () => {
    const later = txn({ tradeDate: '2026-02-05', quantity: 100 })
    const r = checkAccount({ ...base, transactions: [...base.transactions, later] })
    assert.ok([...r.holdings, ...r.account].every((c) => c.ok === true))
  })
})

describe('ledgerCoverage', () => {
  it('needs a zero opening balance and no gaps', () => {
    assert.equal(ledgerCoverage([{ from: '2026-01-01', to: '2026-03-31', openingBalance: 50 }], '2026-03-31').complete, false)
    const gap = [
      { from: '2026-01-01', to: '2026-01-31', openingBalance: 0 },
      { from: '2026-03-01', to: '2026-03-31', openingBalance: 10 },
    ]
    assert.equal(ledgerCoverage(gap, '2026-03-31').complete, false)
    const joined = [gap[0], { from: '2026-02-01', to: '2026-03-31', openingBalance: 10 }]
    assert.equal(ledgerCoverage(joined, '2026-03-31').complete, true)
  })
})
