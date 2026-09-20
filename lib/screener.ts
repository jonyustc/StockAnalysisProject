/**
 * Screener row assembly and filtering.
 *
 * Kept pure so the filter logic is testable without a database or a browser —
 * the rules about what a missing value means are the fiddly part, not the UI.
 */

import { computeHistory, summariseHistory, type YearFacts } from './metrics'
import { computeValuation } from './prices'

export interface ScreenerRow {
  symbol: string
  name: string
  shortName: string | null
  sector: string | null

  price: number | null
  changePct: number | null
  tradeDate: string | null

  latestFiscalYear: number | null
  yearsEntered: number

  pe: number | null
  pb: number | null
  dividendYield: number | null
  rangePosition: number | null
  aboveLow: number | null

  roe: number | null
  roce: number | null
  netMargin: number | null
  debtToEquity: number | null
  cashConversion: number | null
  revenueCagr: number | null
  epsCagr: number | null
}

export interface CompanyInput {
  symbol: string
  name: string
  shortName: string | null
  sector: string | null
}

export interface QuoteInput {
  tradeDate: string
  close: number
  ycp: number | null
  yearlyHigh: number | null
  yearlyLow: number | null
}

export function buildScreenerRow(
  company: CompanyInput,
  history: YearFacts[] | undefined,
  quote: QuoteInput | undefined,
): ScreenerRow {
  const years = history ?? []
  const metrics = years.length > 0 ? computeHistory(years) : []
  const latest = years[years.length - 1]
  const latestMetrics = metrics[metrics.length - 1]
  const summary = years.length > 0 ? summariseHistory(years, metrics) : null

  const valuation = quote
    ? computeValuation(quote, {
        eps: latest?.values.eps_basic ?? null,
        navps: latest?.values.navps ?? null,
        dividendPerShare: latest?.values.dividend_per_share ?? null,
      })
    : null

  return {
    symbol: company.symbol,
    name: company.name,
    shortName: company.shortName,
    sector: company.sector,

    price: quote?.close ?? null,
    // Against the previous close the exchange reports, not the day's open.
    changePct:
      quote && quote.ycp !== null && quote.ycp > 0 ? quote.close / quote.ycp - 1 : null,
    tradeDate: quote?.tradeDate ?? null,

    latestFiscalYear: latest?.fiscalYear ?? null,
    yearsEntered: years.length,

    pe: valuation?.pe ?? null,
    pb: valuation?.pb ?? null,
    dividendYield: valuation?.dividendYield ?? null,
    rangePosition: valuation?.rangePosition ?? null,
    aboveLow: valuation?.aboveLow ?? null,

    roe: latestMetrics?.roe ?? null,
    roce: latestMetrics?.roce ?? null,
    netMargin: latestMetrics?.netMargin ?? null,
    debtToEquity: latestMetrics?.debtToEquity ?? null,
    cashConversion: latestMetrics?.cashConversion ?? null,
    revenueCagr: summary?.revenueCagr ?? null,
    epsCagr: summary?.epsCagr ?? null,
  }
}

export type NumericField =
  | 'price'
  | 'changePct'
  | 'pe'
  | 'pb'
  | 'dividendYield'
  | 'rangePosition'
  | 'aboveLow'
  | 'roe'
  | 'roce'
  | 'netMargin'
  | 'debtToEquity'
  | 'cashConversion'
  | 'revenueCagr'
  | 'epsCagr'
  | 'yearsEntered'

export type SortField = NumericField | 'symbol' | 'sector'

export interface Filters {
  search: string
  sector: string | null
  /** field -> [min, max], either end optional. */
  ranges: Partial<Record<NumericField, { min?: number; max?: number }>>
  /** Hide companies with no fundamentals entered. */
  withDataOnly: boolean
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  sector: null,
  ranges: {},
  withDataOnly: false,
}

export function applyFilters(rows: ScreenerRow[], filters: Filters): ScreenerRow[] {
  const needle = filters.search.trim().toUpperCase()

  return rows.filter((row) => {
    if (
      needle &&
      !row.symbol.includes(needle) &&
      !row.name.toUpperCase().includes(needle)
    ) {
      return false
    }

    if (filters.sector && row.sector !== filters.sector) return false
    if (filters.withDataOnly && row.yearsEntered === 0) return false

    for (const [field, range] of Object.entries(filters.ranges)) {
      if (!range) continue
      const value = row[field as NumericField]

      // A company with no figure for a metric cannot satisfy a threshold on
      // it. Letting nulls through would quietly pad every screen with
      // companies you have not entered yet.
      if (value === null) return false
      if (range.min !== undefined && value < range.min) return false
      if (range.max !== undefined && value > range.max) return false
    }

    return true
  })
}

export function sortRows(
  rows: ScreenerRow[],
  field: SortField,
  direction: 'asc' | 'desc',
): ScreenerRow[] {
  const sign = direction === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    if (field === 'symbol' || field === 'sector') {
      return sign * String(a[field] ?? '').localeCompare(String(b[field] ?? ''))
    }

    const left = a[field]
    const right = b[field]

    // Missing values sort last in both directions — a blank is not "worst",
    // it is unknown, and burying it keeps the top of the list meaningful.
    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1

    return sign * (left - right)
  })
}
