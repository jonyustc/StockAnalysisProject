import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { computeHistory, computeYearMetrics, summariseHistory, type YearFacts } from './metrics'

const M = 1_000_000

/** Square Pharma FY2024 and FY2025, in base BDT. */
const FY2024: YearFacts = {
  fiscalYear: 2024,
  values: {
    revenue: 70101 * M,
    gross_profit: 32553 * M,
    operating_profit: 17974 * M,
    net_profit: 20926 * M,
    total_assets: 132637 * M,
    current_assets: 71206 * M,
    current_liabilities: 5282 * M,
    total_debt: 1429 * M,
    total_equity: 125922 * M,
    net_operating_cash_flow: 18529 * M,
    capex: -4181 * M,
    eps_basic: 23.61,
    dividend_per_share: 11.0,
  },
}

const FY2025: YearFacts = {
  fiscalYear: 2025,
  values: {
    revenue: 76288 * M,
    gross_profit: 35911 * M,
    operating_profit: 19393 * M,
    net_profit: 23968 * M,
    total_assets: 146815 * M,
    current_assets: 74562 * M,
    current_liabilities: 5823 * M,
    total_debt: 825.5 * M,
    total_equity: 139956 * M,
    net_operating_cash_flow: 17302 * M,
    capex: -6177 * M,
    eps_basic: 27.04,
    dividend_per_share: 12.0,
  },
}

describe('computeYearMetrics', () => {
  const m = computeYearMetrics(FY2025, FY2024)

  it('matches the ROE published for the same year', () => {
    // Independent confirmation that "average equity" is the right denominator:
    // stockanalysis reports 18.03% for FY2025.
    assert.ok(m.roe !== null)
    assert.ok(Math.abs(m.roe! * 100 - 18.03) < 0.01, `got ${(m.roe! * 100).toFixed(2)}%`)
  })

  it('adds capex rather than subtracting it', () => {
    // Capex is stored negative, as printed. FCF = 17,302 - 6,177 = 11,125.
    assert.ok(Math.abs(m.fcf! / M - 11125) < 1)
  })

  it('computes margins from revenue', () => {
    assert.ok(Math.abs(m.grossMargin! - 35911 / 76288) < 1e-9)
    assert.ok(Math.abs(m.netMargin! - 23968 / 76288) < 1e-9)
  })

  it('reads debt/equity as near zero for a debt-free balance sheet', () => {
    assert.ok(m.debtToEquity! < 0.01)
  })

  it('computes payout against declared dividend per share', () => {
    assert.ok(Math.abs(m.payoutRatio! - 12 / 27.04) < 1e-9)
  })

  it('measures cash conversion against reported profit', () => {
    assert.ok(Math.abs(m.cashConversion! - 17302 / 23968) < 1e-9)
  })

  it('has no growth figures without a prior year', () => {
    const first = computeYearMetrics(FY2024)
    assert.equal(first.revenueGrowth, null)
    assert.equal(first.epsGrowth, null)
  })
})

describe('missing inputs', () => {
  it('returns null instead of a number derived from nothing', () => {
    const sparse: YearFacts = { fiscalYear: 2020, values: { revenue: 100 * M } }
    const m = computeYearMetrics(sparse)

    assert.equal(m.grossMargin, null)
    assert.equal(m.roe, null)
    assert.equal(m.fcf, null)
    assert.equal(m.currentRatio, null)
    assert.equal(m.debtToEquity, null)
  })

  it('does not treat a missing denominator as zero', () => {
    const noRevenue: YearFacts = { fiscalYear: 2020, values: { gross_profit: 50 * M } }
    assert.equal(computeYearMetrics(noRevenue).grossMargin, null)
  })

  it('prefers split borrowings but falls back to total debt', () => {
    const split: YearFacts = {
      fiscalYear: 2020,
      values: {
        long_term_borrowings: 30 * M,
        short_term_borrowings: 20 * M,
        total_debt: 999 * M,
        total_equity: 100 * M,
      },
    }
    assert.equal(computeYearMetrics(split).debtToEquity, 0.5)

    const unsplit: YearFacts = {
      fiscalYear: 2020,
      values: { total_debt: 25 * M, total_equity: 100 * M },
    }
    assert.equal(computeYearMetrics(unsplit).debtToEquity, 0.25)
  })

  it('refuses a growth rate across a loss', () => {
    const loss: YearFacts = { fiscalYear: 2020, values: { revenue: 100 * M, eps_basic: -2 } }
    const recovery: YearFacts = { fiscalYear: 2021, values: { revenue: 120 * M, eps_basic: 3 } }
    const m = computeYearMetrics(recovery, loss)

    assert.ok(Math.abs(m.revenueGrowth! - 0.2) < 1e-9)
    assert.equal(m.epsGrowth, null, 'EPS growth from -2 to 3 is not a percentage')
  })
})

describe('summariseHistory', () => {
  const years = [FY2024, FY2025]
  const summary = summariseHistory(years, computeHistory(years))

  it('measures CAGR over the span actually present', () => {
    assert.equal(summary.years, 1)
    assert.ok(Math.abs(summary.revenueCagr! - (76288 / 70101 - 1)) < 1e-9)
  })

  it('counts the years that produced positive free cash flow', () => {
    assert.equal(summary.positiveFcfYears, 2)
    assert.equal(summary.fcfYearsCounted, 2)
  })

  it('reports no CAGR for a single year', () => {
    const single = summariseHistory([FY2025], computeHistory([FY2025]))
    assert.equal(single.revenueCagr, null)
  })
})
