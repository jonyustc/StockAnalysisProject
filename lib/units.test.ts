import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  formatBDT,
  formatPercent,
  formatPerShare,
  naturalScale,
  parseReportedNumber,
  toBaseValue,
} from './units'

describe('toBaseValue', () => {
  it('converts each printed scale to base taka', () => {
    // "Taka in '000" showing 1,234 means ৳1,234,000.
    assert.equal(toBaseValue(1234, 'thousand'), 1_234_000)
    assert.equal(toBaseValue(20_920, 'million'), 20_920_000_000)
    assert.equal(toBaseValue(1, 'crore'), 10_000_000)
    assert.equal(toBaseValue(1, 'lakh'), 100_000)
    assert.equal(toBaseValue(19.02, 'unit'), 19.02)
  })

  it('matches the generated column in the migration', () => {
    // If this ever diverges, the app and the database disagree about what a
    // stored figure means — the worst kind of bug here.
    const scales = ['unit', 'thousand', 'lakh', 'million', 'crore', 'billion'] as const
    const expected = [1, 1e3, 1e5, 1e6, 1e7, 1e9]
    scales.forEach((scale, index) => {
      assert.equal(toBaseValue(1, scale), expected[index])
    })
  })
})

describe('naturalScale', () => {
  it('uses the Bangladeshi convention rather than millions', () => {
    assert.equal(naturalScale(20_920_000_000), 'crore')
    assert.equal(naturalScale(500_000), 'lakh')
    assert.equal(naturalScale(4_200), 'unit')
  })

  it('handles negatives by magnitude', () => {
    assert.equal(naturalScale(-20_920_000_000), 'crore')
  })
})

describe('formatBDT', () => {
  it('formats Marico-scale revenue in crore', () => {
    assert.equal(formatBDT(20_920_000_000), '৳2,092.00 cr')
  })

  it('respects an explicit scale', () => {
    assert.equal(formatBDT(20_920_000_000, { scale: 'million' }), '৳20,920.00M')
  })

  it('renders absent values as a dash, not zero', () => {
    assert.equal(formatBDT(null), '—')
    assert.equal(formatBDT(undefined), '—')
    assert.equal(formatBDT(Number.NaN), '—')
  })
})

describe('formatPercent / formatPerShare', () => {
  it('turns a fraction into a percentage', () => {
    assert.equal(formatPercent(0.2263), '22.63%')
    assert.equal(formatPercent(0.2263, 1, true), '+22.6%')
    assert.equal(formatPercent(-0.048), '-4.80%')
  })

  it('never scales per-share figures', () => {
    assert.equal(formatPerShare(198.44), '৳198.44')
  })
})

describe('parseReportedNumber', () => {
  it('reads figures as typed from a report', () => {
    assert.equal(parseReportedNumber('1,234.56'), 1234.56)
    assert.equal(parseReportedNumber(' 20,920 '), 20920)
    assert.equal(parseReportedNumber('৳19.02'), 19.02)
  })

  it("reads accountants' parentheses as negative", () => {
    assert.equal(parseReportedNumber('(1,234)'), -1234)
    assert.equal(parseReportedNumber('(35.90)'), -35.9)
  })

  it('distinguishes absent from zero', () => {
    // A blank cell is not the same claim as a reported zero.
    assert.equal(parseReportedNumber(''), null)
    assert.equal(parseReportedNumber('-'), null)
    assert.equal(parseReportedNumber('N/A'), null)
    assert.equal(parseReportedNumber('0'), 0)
  })

  it('rejects anything that is not a number', () => {
    assert.equal(parseReportedNumber('see note 14'), null)
    assert.equal(parseReportedNumber('12.3.4'), null)
  })
})
