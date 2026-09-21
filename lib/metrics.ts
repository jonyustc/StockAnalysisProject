/**
 * Derived metrics.
 *
 * Pure functions over reported facts, kept entirely separate from the facts
 * themselves so a formula can change without touching a single figure taken
 * from an annual report.
 *
 * Two rules throughout:
 *
 *   1. Return null rather than a plausible-looking number. A ratio computed
 *      from a missing input, or a growth rate across a sign change, is worse
 *      than a blank — it looks like an answer.
 *   2. Currency inputs are base BDT; per-share inputs are as reported.
 */

import {
  cagr,
  cumulativeAdjustmentFactor,
  type CorporateActionInput,
} from './corporate-actions'

/** Per-share tags that a bonus, rights issue or split makes incomparable. */
const PER_SHARE_TAGS = ['eps_basic', 'eps_diluted', 'navps', 'nocfps', 'dividend_per_share']

/** Reported values for one fiscal year, keyed by line item tag. */
export interface YearFacts {
  fiscalYear: number
  values: Record<string, number | null | undefined>
}

export interface YearMetrics {
  fiscalYear: number
  revenueGrowth: number | null
  epsGrowth: number | null
  grossMargin: number | null
  operatingMargin: number | null
  netMargin: number | null
  roe: number | null
  roce: number | null
  debtToEquity: number | null
  currentRatio: number | null
  fcf: number | null
  /** Operating cash flow against reported profit. Below 1 for years on end is a warning. */
  cashConversion: number | null
  payoutRatio: number | null
}

function get(year: YearFacts, tag: string): number | null {
  const value = year.values[tag]
  return value === null || value === undefined || Number.isNaN(value) ? null : value
}

/** Division that refuses to invent a number. */
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null
  return numerator / denominator
}

function growth(current: number | null, previous: number | null): number | null {
  // A move from a loss to a profit has no meaningful percentage.
  if (current === null || previous === null || previous <= 0) return null
  return current / previous - 1
}

function average(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return (a + b) / 2
}

/** Total interest-bearing debt, however the source chose to report it. */
export function totalDebt(year: YearFacts): number | null {
  const long = get(year, 'long_term_borrowings')
  const short = get(year, 'short_term_borrowings')

  if (long !== null || short !== null) return (long ?? 0) + (short ?? 0)
  return get(year, 'total_debt')
}

/**
 * Capital employed = total assets less current liabilities. One of several
 * defensible definitions of ROCE's denominator; the one recorded in
 * metric_defs.formula_note, which is the point of recording it.
 */
function capitalEmployed(year: YearFacts): number | null {
  const assets = get(year, 'total_assets')
  const currentLiabilities = get(year, 'current_liabilities')
  if (assets === null) return null
  return assets - (currentLiabilities ?? 0)
}

export function computeYearMetrics(year: YearFacts, previous?: YearFacts): YearMetrics {
  const revenue = get(year, 'revenue')
  const netProfit = get(year, 'net_profit')
  const equity = get(year, 'total_equity')
  const ocf = get(year, 'net_operating_cash_flow')
  const capex = get(year, 'capex')
  const eps = get(year, 'eps_basic')

  // Returns are measured against average capital over the year, not the
  // closing balance — a company that raised equity in month eleven has not
  // had that capital working for it all year.
  const avgEquity = previous ? average(get(previous, 'total_equity'), equity) : equity
  const avgCapital = previous
    ? average(capitalEmployed(previous), capitalEmployed(year))
    : capitalEmployed(year)

  return {
    fiscalYear: year.fiscalYear,
    revenueGrowth: previous ? growth(revenue, get(previous, 'revenue')) : null,
    epsGrowth: previous ? growth(eps, get(previous, 'eps_basic')) : null,
    grossMargin: ratio(get(year, 'gross_profit'), revenue),
    operatingMargin: ratio(get(year, 'operating_profit'), revenue),
    netMargin: ratio(netProfit, revenue),
    roe: ratio(netProfit, avgEquity),
    roce: ratio(get(year, 'operating_profit'), avgCapital),
    debtToEquity: ratio(totalDebt(year), equity),
    currentRatio: ratio(get(year, 'current_assets'), get(year, 'current_liabilities')),
    // Capex is stored as printed — negative for an outflow — so this adds.
    fcf: ocf === null ? null : ocf + (capex ?? 0),
    cashConversion: ratio(ocf, netProfit),
    payoutRatio: ratio(get(year, 'dividend_per_share'), eps),
  }
}

/** Metrics for a full history, oldest first. */
export function computeHistory(years: YearFacts[]): YearMetrics[] {
  const ordered = [...years].sort((a, b) => a.fiscalYear - b.fiscalYear)
  return ordered.map((year, index) => computeYearMetrics(year, ordered[index - 1]))
}

/**
 * Restates per-share figures onto the current share base.
 *
 * A bonus or rights issue increases the share count without changing the
 * business, so an EPS reported before it is not comparable with one reported
 * after. Growth rates and CAGRs computed across that break are wrong — and
 * wrong in the flattering direction, since the share count almost always
 * grows.
 *
 * Each year is adjusted by the product of the factors for every action that
 * went ex AFTER that year ended; an action already reflected in a reported
 * figure must not be applied twice. Amounts are untouched — only per-share
 * lines move.
 */
export function adjustForCorporateActions(
  years: YearFacts[],
  actions: (CorporateActionInput & { periodEndByYear?: never })[],
  periodEndByYear: Map<number, string>,
): YearFacts[] {
  if (actions.length === 0) return years

  return years.map((year) => {
    const asOf = periodEndByYear.get(year.fiscalYear)
    if (!asOf) return year

    const factor = cumulativeAdjustmentFactor(actions, asOf)
    if (factor === 1) return year

    const values = { ...year.values }
    for (const tag of PER_SHARE_TAGS) {
      const value = values[tag]
      if (value !== null && value !== undefined) values[tag] = value * factor
    }

    return { fiscalYear: year.fiscalYear, values }
  })
}

export interface HistorySummary {
  years: number
  revenueCagr: number | null
  epsCagr: number | null
  netProfitCagr: number | null
  /** Mean ROE across years where it could be computed. */
  averageRoe: number | null
  averageRoce: number | null
  latestDebtToEquity: number | null
  /** How many of the years produced positive free cash flow. */
  positiveFcfYears: number
  fcfYearsCounted: number
}

/**
 * Compound growth over the span actually available, measured endpoint to
 * endpoint. Note that any CAGR is hostage to its endpoints — one unusual
 * first or last year distorts the whole figure, which is why the trend chart
 * matters more than this number.
 *
 * EPS values must already be adjusted for bonus and rights issues; comparing
 * unadjusted per-share figures across a share-count change is meaningless.
 */
export function summariseHistory(
  years: YearFacts[],
  metrics: YearMetrics[],
): HistorySummary {
  const ordered = [...years].sort((a, b) => a.fiscalYear - b.fiscalYear)
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const span = ordered.length > 1 ? last.fiscalYear - first.fiscalYear : 0

  const defined = (values: (number | null)[]) => values.filter((v): v is number => v !== null)

  const roeValues = defined(metrics.map((m) => m.roe))
  const roceValues = defined(metrics.map((m) => m.roce))
  const fcfValues = defined(metrics.map((m) => m.fcf))

  const mean = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null

  return {
    years: span,
    revenueCagr: span > 0 ? cagr(get(first, 'revenue') ?? 0, get(last, 'revenue') ?? 0, span) : null,
    epsCagr: span > 0 ? cagr(get(first, 'eps_basic') ?? 0, get(last, 'eps_basic') ?? 0, span) : null,
    netProfitCagr:
      span > 0 ? cagr(get(first, 'net_profit') ?? 0, get(last, 'net_profit') ?? 0, span) : null,
    averageRoe: mean(roeValues),
    averageRoce: mean(roceValues),
    latestDebtToEquity: metrics[metrics.length - 1]?.debtToEquity ?? null,
    positiveFcfYears: fcfValues.filter((v) => v > 0).length,
    fcfYearsCounted: fcfValues.length,
  }
}
