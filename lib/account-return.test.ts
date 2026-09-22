import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  accountMoneyWeightedReturn,
  cashMovements,
  lifetimeReturn,
  netContributions,
  periodReturn,
  sinceFirstSnapshot,
  yearlyReturns,
  type AccountSnapshot,
} from './account-return'

function snap(over: Partial<AccountSnapshot>): AccountSnapshot {
  return {
    asOf: '2026-01-01',
    marketValue: 0,
    cashBalance: 0,
    costOfHoldings: null,
    deposit: 0,
    shareTransferIn: 0,
    withdraw: 0,
    shareTransferOut: 0,
    cashDividend: 0,
    realisedGain: 0,
    ...over,
  }
}

const close = (a: number | null, b: number, eps = 1e-6) => a !== null && Math.abs(a - b) < eps

describe('lifetimeReturn', () => {
  // Synthetic figures shaped like a statement: deposits, a realised gain from
  // past sales, a dividend, holdings slightly up, and a fee that no line names.
  const s = snap({
    marketValue: 100000,
    cashBalance: 50,
    costOfHoldings: 99000,
    deposit: 95000,
    cashDividend: 400,
    realisedGain: 3950,
  })
  const r = lifetimeReturn(s)

  it('measures money in against worth now', () => {
    assert.ok(close(r.moneyIn, 95000))
    assert.ok(close(r.worth, 100050))
    assert.ok(close(r.gain, 5050))
    assert.ok(close(r.totalReturn, 5050 / 95000))
  })

  it('reconciles into realised, dividends, unrealised and what is left over', () => {
    assert.ok(close(r.unrealised, 1000))
    // The ৳300 no line explains — an account charge the gains alone miss.
    assert.ok(close(r.unexplained, -300, 1e-4))
    assert.ok(close(r.realised + r.dividends + r.unrealised! + r.unexplained!, r.gain))
  })

  it('does not count dividends as money put in', () => {
    // If they were, a dividend would LOWER the return.
    assert.equal(netContributions(s), 95000)
  })

  it('counts share transfers and withdrawals', () => {
    assert.equal(
      netContributions(snap({ deposit: 1000, shareTransferIn: 500, withdraw: 200, shareTransferOut: 100 })),
      1200,
    )
  })

  it('has no percentage when nothing net has gone in', () => {
    assert.equal(lifetimeReturn(snap({ deposit: 100, withdraw: 100, cashBalance: 50 })).totalReturn, null)
  })

  it('has no split when the cost of holdings is unknown', () => {
    const unknown = lifetimeReturn(snap({ deposit: 100, marketValue: 110 }))
    assert.equal(unknown.unrealised, null)
    assert.equal(unknown.unexplained, null)
  })
})

describe('periodReturn', () => {
  it('is simple growth when no money moves', () => {
    const r = periodReturn(
      snap({ asOf: '2026-01-01', deposit: 1000, marketValue: 1000 }),
      snap({ asOf: '2026-02-01', deposit: 1000, marketValue: 1100 }),
    )
    assert.ok(close(r.return, 0.1))
    assert.equal(r.flow, 0)
  })

  it('does not mistake a deposit for a gain', () => {
    // Value doubles, but only because the money doubled.
    const r = periodReturn(
      snap({ asOf: '2026-01-01', deposit: 1000, marketValue: 1000 }),
      snap({ asOf: '2026-02-01', deposit: 2000, marketValue: 2000 }),
    )
    assert.ok(close(r.return, 0))
    assert.equal(r.flow, 1000)
  })

  it('assumes the flow arrived mid-period', () => {
    // 1,000 grows to 2,150 with 1,000 added: 150 gain over 1,000 + 500.
    const r = periodReturn(
      snap({ asOf: '2026-01-01', deposit: 1000, marketValue: 1000 }),
      snap({ asOf: '2026-02-01', deposit: 2000, marketValue: 2150 }),
    )
    assert.ok(close(r.return, 150 / 1500))
  })

  it('has no return with nothing to measure against', () => {
    const r = periodReturn(snap({ asOf: '2026-01-01' }), snap({ asOf: '2026-02-01' }))
    assert.equal(r.return, null)
  })
})

describe('yearlyReturns', () => {
  const series = [
    snap({ asOf: '2025-01-02', deposit: 1000, marketValue: 1000 }),
    snap({ asOf: '2025-07-01', deposit: 1000, marketValue: 1100 }),
    snap({ asOf: '2025-12-30', deposit: 1000, marketValue: 1210 }),
    snap({ asOf: '2026-03-01', deposit: 2000, marketValue: 2210 }),
  ]

  it('chains the periods within each year', () => {
    const [y2025] = yearlyReturns(series)
    assert.equal(y2025.year, 2025)
    assert.ok(close(y2025.return, 0.21)) // 10% then 10%
    assert.equal(y2025.complete, true)
  })

  it('says when a year is only partly covered', () => {
    const y2026 = yearlyReturns(series).find((y) => y.year === 2026)!
    assert.equal(y2026.complete, false)
    assert.equal(y2026.from, '2025-12-30')
    assert.equal(y2026.to, '2026-03-01')
    // The 1,000 added in 2026 is not counted as return.
    assert.ok(close(y2026.return, 0))
  })

  it('needs two snapshots to say anything', () => {
    assert.deepEqual(yearlyReturns([series[0]]), [])
  })
})

describe('cashMovements', () => {
  it('reads deposits, withdrawals and dividends from the change in totals', () => {
    const moves = cashMovements([
      snap({ asOf: '2026-01-01', deposit: 1000, withdraw: 0, cashDividend: 0 }),
      snap({ asOf: '2026-01-02', deposit: 1000, withdraw: 0, cashDividend: 0 }),
      snap({ asOf: '2026-01-03', deposit: 1500, withdraw: 200, cashDividend: 45 }),
    ])
    // The quiet day is left out; newest first.
    assert.equal(moves.length, 1)
    assert.deepEqual(
      [moves[0].from, moves[0].to, moves[0].deposited, moves[0].withdrawn, moves[0].dividends],
      ['2026-01-02', '2026-01-03', 500, 200, 45],
    )
  })

  it('nets IPO money moving out and back', () => {
    const [move] = cashMovements([
      { ...snap({ asOf: '2026-01-01' }), ipoPayment: 0, ipoRefund: 0 },
      { ...snap({ asOf: '2026-01-05' }), ipoPayment: 5000, ipoRefund: 4000 },
    ])
    assert.equal(move.ipoNet, -1000)
  })
})

describe('sinceFirstSnapshot', () => {
  it('chains every period since tracking began', () => {
    const r = sinceFirstSnapshot([
      snap({ asOf: '2026-01-01', deposit: 1000, marketValue: 1000 }),
      snap({ asOf: '2026-02-01', deposit: 1000, marketValue: 1100 }),
      snap({ asOf: '2026-03-01', deposit: 1000, marketValue: 1210 }),
    ])
    assert.ok(close(r.return, 0.21))
    assert.equal(r.days, 59)
  })

  it('reports nothing from a single snapshot', () => {
    const r = sinceFirstSnapshot([snap({ asOf: '2026-09-22', deposit: 1, marketValue: 1 })])
    assert.equal(r.return, null)
    assert.equal(r.days, 0)
  })
})

describe('accountMoneyWeightedReturn', () => {
  it('uses the real dates of deposits, and ignores fees and dividends', () => {
    const r = accountMoneyWeightedReturn(
      [
        { date: '2025-01-01', kind: 'deposit', amount: 1000 },
        { date: '2025-06-01', kind: 'fee', amount: -10 },
        { date: '2025-07-01', kind: 'dividend', amount: 20 },
      ],
      1100,
      '2026-01-01',
    )
    assert.ok(close(r.rate, 0.1, 1e-4))
    assert.equal(r.days, 365)
  })

  it('waits for a year of history', () => {
    const r = accountMoneyWeightedReturn([{ date: '2025-10-06', kind: 'deposit', amount: 1000 }], 1040, '2026-09-22')
    assert.equal(r.rate, null)
    assert.equal(r.firstDate, '2025-10-06')
  })
})
