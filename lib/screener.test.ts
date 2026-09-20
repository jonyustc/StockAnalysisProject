import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { applyFilters, EMPTY_FILTERS, sortRows, type ScreenerRow } from './screener'

function row(overrides: Partial<ScreenerRow>): ScreenerRow {
  return {
    symbol: 'TEST',
    name: 'Test Company',
    shortName: null,
    sector: 'Engineering',
    price: 100,
    changePct: 0,
    tradeDate: '2026-09-20',
    latestFiscalYear: 2025,
    yearsEntered: 5,
    pe: 10,
    pb: 1,
    dividendYield: 0.05,
    rangePosition: 0.5,
    aboveLow: 0.2,
    roe: 0.18,
    roce: 0.14,
    netMargin: 0.3,
    debtToEquity: 0.1,
    cashConversion: 1.1,
    revenueCagr: 0.12,
    epsCagr: 0.11,
    ...overrides,
  }
}

describe('applyFilters', () => {
  const rows = [
    row({ symbol: 'SQURPHARMA', name: 'Square Pharmaceuticals PLC', roe: 0.18, pe: 8 }),
    row({ symbol: 'LHB', name: 'LafargeHolcim Bangladesh PLC', sector: 'Cement', roe: 0.09, pe: 20 }),
    row({ symbol: 'MARICO', name: 'Marico Bangladesh Limited', roe: 1.13, pe: 13 }),
  ]

  it('matches on symbol or name, case-insensitively', () => {
    assert.equal(applyFilters(rows, { ...EMPTY_FILTERS, search: 'squr' }).length, 1)
    assert.equal(applyFilters(rows, { ...EMPTY_FILTERS, search: 'bangladesh' }).length, 2)
    assert.equal(applyFilters(rows, { ...EMPTY_FILTERS, search: 'nothing' }).length, 0)
  })

  it('filters by sector', () => {
    assert.equal(applyFilters(rows, { ...EMPTY_FILTERS, sector: 'Cement' }).length, 1)
  })

  it('applies numeric thresholds', () => {
    const highRoe = applyFilters(rows, { ...EMPTY_FILTERS, ranges: { roe: { min: 0.15 } } })
    assert.deepEqual(highRoe.map((r) => r.symbol), ['SQURPHARMA', 'MARICO'])

    const cheap = applyFilters(rows, { ...EMPTY_FILTERS, ranges: { pe: { max: 10 } } })
    assert.deepEqual(cheap.map((r) => r.symbol), ['SQURPHARMA'])
  })

  it('combines thresholds', () => {
    const both = applyFilters(rows, {
      ...EMPTY_FILTERS,
      ranges: { roe: { min: 0.15 }, pe: { max: 10 } },
    })
    assert.deepEqual(both.map((r) => r.symbol), ['SQURPHARMA'])
  })

  it('excludes a company with no value for a filtered metric', () => {
    // Otherwise every screen silently fills up with companies whose data you
    // have not entered yet, which looks like a result rather than a gap.
    const withMissing = [...rows, row({ symbol: 'RENATA', roe: null })]
    const result = applyFilters(withMissing, { ...EMPTY_FILTERS, ranges: { roe: { min: 0 } } })

    assert.ok(!result.some((r) => r.symbol === 'RENATA'))
  })

  it('leaves rows untouched when nothing is set', () => {
    assert.equal(applyFilters(rows, EMPTY_FILTERS).length, 3)
  })

  it('can hide companies with nothing entered', () => {
    const withEmpty = [...rows, row({ symbol: 'OLYMPIC', yearsEntered: 0 })]
    assert.equal(applyFilters(withEmpty, EMPTY_FILTERS).length, 4)
    assert.equal(
      applyFilters(withEmpty, { ...EMPTY_FILTERS, withDataOnly: true }).length,
      3,
    )
  })
})

describe('sortRows', () => {
  const rows = [
    row({ symbol: 'A', pe: 20 }),
    row({ symbol: 'B', pe: 5 }),
    row({ symbol: 'C', pe: null }),
  ]

  it('sorts ascending and descending', () => {
    assert.deepEqual(sortRows(rows, 'pe', 'asc').map((r) => r.symbol), ['B', 'A', 'C'])
    assert.deepEqual(sortRows(rows, 'pe', 'desc').map((r) => r.symbol), ['A', 'B', 'C'])
  })

  it('keeps missing values last in both directions', () => {
    // A blank is unknown, not worst. Sorting it to the top of a "cheapest PE"
    // list would be actively misleading.
    assert.equal(sortRows(rows, 'pe', 'asc').at(-1)!.symbol, 'C')
    assert.equal(sortRows(rows, 'pe', 'desc').at(-1)!.symbol, 'C')
  })

  it('sorts text fields alphabetically', () => {
    assert.deepEqual(sortRows(rows, 'symbol', 'desc').map((r) => r.symbol), ['C', 'B', 'A'])
  })

  it('does not mutate the input', () => {
    const original = rows.map((r) => r.symbol)
    sortRows(rows, 'pe', 'asc')
    assert.deepEqual(rows.map((r) => r.symbol), original)
  })
})
