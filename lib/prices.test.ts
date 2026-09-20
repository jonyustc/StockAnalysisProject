import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { computeValuation, parseInstruments } from './prices'

const SQUARE = {
  code: 'SQURPHARMA',
  open: 214.1,
  high: 216.4,
  low: 213.9,
  close: 215.9,
  ycp: 213.8,
  trades: 1228,
  volume: 253716,
  value: 54.661,
  yearly_high: 236,
  yearly_low: 198,
  updated_at: '2026-09-20 14:05:53',
}

describe('parseInstruments', () => {
  it('reads a well-formed instrument', () => {
    const { quotes, skipped } = parseInstruments({ SQURPHARMA: SQUARE }, ['SQURPHARMA'])

    assert.equal(skipped.length, 0)
    assert.equal(quotes.length, 1)
    assert.deepEqual(quotes[0], {
      symbol: 'SQURPHARMA',
      tradeDate: '2026-09-20',
      open: 214.1,
      high: 216.4,
      low: 213.9,
      close: 215.9,
      ycp: 213.8,
      volume: 253716,
      // The feed reports turnover in millions.
      valueBdt: 54_661_000,
      trades: 1228,
      yearlyHigh: 236,
      yearlyLow: 198,
    })
  })

  it('ignores instruments we do not track', () => {
    const { quotes } = parseInstruments(
      { SQURPHARMA: SQUARE, BEXIMCO: { ...SQUARE, code: 'BEXIMCO' } },
      ['SQURPHARMA'],
    )
    assert.equal(quotes.length, 1)
  })

  it('matches symbols case-insensitively', () => {
    const { quotes } = parseInstruments({ squrpharma: SQUARE }, ['SQURPHARMA'])
    assert.equal(quotes.length, 1)
  })

  it('skips a stock that did not trade rather than storing zero', () => {
    const { quotes, skipped } = parseInstruments({ X: { ...SQUARE, close: 0 } }, ['X'])
    assert.equal(quotes.length, 0)
    assert.match(skipped[0].reason, /no close/)
  })

  it('skips an instrument missing from the feed', () => {
    const { skipped } = parseInstruments({ SQURPHARMA: SQUARE }, ['MARICO'])
    assert.deepEqual(skipped, [{ symbol: 'MARICO', reason: 'not present in feed' }])
  })

  describe('rejects internally contradictory quotes', () => {
    // An unmaintained third-party feed will eventually serve nonsense, and a
    // wrong close silently poisons every PE and yield downstream.
    it('high below low', () => {
      const { quotes } = parseInstruments({ X: { ...SQUARE, high: 100, low: 200 } }, ['X'])
      assert.equal(quotes.length, 0)
    })

    it('close above the day high', () => {
      const { quotes } = parseInstruments({ X: { ...SQUARE, close: 500 } }, ['X'])
      assert.equal(quotes.length, 0)
    })

    it('close below the day low', () => {
      const { quotes } = parseInstruments({ X: { ...SQUARE, close: 10 } }, ['X'])
      assert.equal(quotes.length, 0)
    })
  })

  it('rejects an unusable timestamp', () => {
    const cases = [undefined, '', 'yesterday', '2026-13-01 10:00:00']
    for (const updated_at of cases) {
      const { quotes } = parseInstruments({ X: { ...SQUARE, updated_at } }, ['X'])
      assert.equal(quotes.length, 0, `accepted updated_at=${String(updated_at)}`)
    }
  })

  it('survives a payload that is not what we expect', () => {
    for (const payload of [null, undefined, 'error', 42, []]) {
      assert.doesNotThrow(() => parseInstruments(payload, ['SQURPHARMA']))
    }
    assert.equal(parseInstruments(null, ['SQURPHARMA']).quotes.length, 0)
  })

  it('keeps a quote whose optional fields are missing', () => {
    const { quotes } = parseInstruments(
      { X: { close: 100, updated_at: '2026-09-20 14:00:00' } },
      ['X'],
    )
    assert.equal(quotes.length, 1)
    assert.equal(quotes[0].open, null)
    assert.equal(quotes[0].yearlyHigh, null)
  })
})

describe('computeValuation', () => {
  const quote = { close: 215.9, yearlyHigh: 236, yearlyLow: 198 }

  it('computes PE, PB and yield from per-share figures alone', () => {
    const v = computeValuation(quote, { eps: 27.04, navps: 157.88, dividendPerShare: 12 })

    assert.ok(Math.abs(v.pe! - 215.9 / 27.04) < 1e-9)
    assert.ok(Math.abs(v.pb! - 215.9 / 157.88) < 1e-9)
    assert.ok(Math.abs(v.dividendYield! - 12 / 215.9) < 1e-9)
  })

  it('places the price within its 52-week range', () => {
    const v = computeValuation(quote, {})

    assert.ok(Math.abs(v.rangePosition! - (215.9 - 198) / (236 - 198)) < 1e-9)
    assert.ok(Math.abs(v.aboveLow! - (215.9 / 198 - 1)) < 1e-9)
    assert.ok(v.belowHigh! < 0)
  })

  it('has no PE for a loss-making company', () => {
    // Not "very high" — undefined. Printing a number here is how a screener
    // makes a loss look like an expensive stock.
    assert.equal(computeValuation(quote, { eps: -3 }).pe, null)
    assert.equal(computeValuation(quote, { eps: 0 }).pe, null)
  })

  it('returns nulls rather than guesses when figures are absent', () => {
    const v = computeValuation({ close: 100, yearlyHigh: null, yearlyLow: null }, {})

    assert.equal(v.pe, null)
    assert.equal(v.pb, null)
    assert.equal(v.dividendYield, null)
    assert.equal(v.rangePosition, null)
  })

  it('treats a zero dividend as zero yield, not as unknown', () => {
    assert.equal(computeValuation(quote, { dividendPerShare: 0 }).dividendYield, 0)
  })
})
