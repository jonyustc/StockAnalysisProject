import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { dividendYield, summariseDividends, type AnnouncedDividend } from './dividend-record'

const dividend = (exDate: string, amount: number | null, restated = false): AnnouncedDividend => ({
  exDate,
  paymentDate: null,
  amount,
  percentOfFace: amount === null ? null : amount * 10,
  restated,
})

describe('summariseDividends', () => {
  it('has nothing to say about a company that has paid nothing', () => {
    const record = summariseDividends([dividend('2025-11-17', 0), dividend('2024-11-24', null)])
    assert.equal(record.latest, null)
    assert.equal(record.paidYears, 0)
    assert.deepEqual(record.years, [])
  })

  it('adds an interim and a final into the year they were declared in', () => {
    const record = summariseDividends([
      dividend('2025-11-17', 8),
      dividend('2025-03-10', 4),
      dividend('2024-11-24', 10),
    ])
    assert.deepEqual(
      record.years.map((y) => [y.year, y.total, y.count]),
      [
        [2025, 12, 2],
        [2024, 10, 1],
      ],
    )
    assert.ok(Math.abs(record.changeOnPriorYear! - 0.2) < 1e-9)
  })

  it('counts the run of paying years and stops at a year passed over', () => {
    const record = summariseDividends([
      dividend('2025-11-17', 12),
      dividend('2024-11-24', 11),
      // Nothing in 2023.
      dividend('2022-11-19', 9),
    ])
    assert.equal(record.streak, 2)
    assert.equal(record.paidYears, 3)
    assert.equal(record.spanYears, 4)
  })

  it('leaves the change unsaid when the prior year is not the year before', () => {
    const record = summariseDividends([dividend('2025-11-17', 12), dividend('2023-11-19', 10)])
    assert.equal(record.changeOnPriorYear, null)
  })

  it('averages the last five years and says when a restated figure is inside', () => {
    const record = summariseDividends([
      dividend('2025-11-17', 12),
      dividend('2024-11-24', 11),
      dividend('2023-11-19', 10),
      dividend('2022-11-20', 9),
      dividend('2021-11-21', 8, true),
      dividend('2020-11-22', 100),
    ])
    assert.equal(record.fiveYearAverage, 10)
    assert.equal(record.restatedInside, true)
    // The sixth year is outside the average but still in the history.
    assert.equal(record.years.length, 6)
  })

  it('takes the newest announcement as the latest, whatever order it arrived in', () => {
    const record = summariseDividends([dividend('2023-11-19', 10), dividend('2025-11-17', 12)])
    assert.equal(record.latest?.exDate, '2025-11-17')
  })
})

describe('dividendYield', () => {
  it('is the dividend over the price', () => {
    assert.equal(dividendYield(12, 240), 0.05)
  })

  it('is nothing without both of them', () => {
    assert.equal(dividendYield(12, null), null)
    assert.equal(dividendYield(null, 240), null)
    assert.equal(dividendYield(12, 0), null)
  })
})
