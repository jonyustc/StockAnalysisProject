import 'server-only'

import {
  getAllFactHistories,
  getCompanyBySymbol,
  getCorporateActionsBySymbol,
  getFactHistory,
  getLatestQuotes,
  listPriceHistory,
  listTrackedCompanies,
} from '@/db/queries'
import { fiscalYearBounds } from '@/lib/fiscal'
import { coverageOf, earningsTimeline, yearsAgo, type Coverage } from '@/lib/insight-inputs'
import {
  compareWithPeers,
  drawdown,
  peBand,
  rangeOver,
  seasonality,
  type Drawdown,
  type PeBand,
  type PeerComparison,
  type PriceRange,
  type Seasonality,
} from '@/lib/insights'
import { adjustForCorporateActions } from '@/lib/metrics'
import { computeValuation, type Valuation } from '@/lib/prices'
import { buildScreenerRow } from '@/lib/screener'
import { dhakaNow } from '@/lib/trading-calendar'

export interface StockInsight {
  symbol: string
  name: string | null
  price: number | null
  tradeDate: string | null
  changePct: number | null
  /** The broker feed's 52-week high and low, and where the price sits. */
  valuation: Valuation | null
  yearHigh: number | null
  yearLow: number | null
  /** The same, from the prices stored here — with the dates they happened. */
  ownYear: PriceRange | null
  band: PeBand | null
  seasons: Seasonality | null
  fall: Drawdown | null
  coverage: Coverage
  latestFiscalYear: number | null
  eps: number | null
  navps: number | null
  dividendPerShare: number | null
  peers: { pe: PeerComparison | null; pb: PeerComparison | null; dividendYield: PeerComparison | null; total: number }
}

/**
 * Everything the insight panel shows for one stock: where the price sits in
 * its range, what it costs against its earnings, how that compares with its
 * own past and with the other tracked companies.
 */
export async function stockInsight(symbol: string): Promise<StockInsight | null> {
  const company = await getCompanyBySymbol(symbol)
  if (!company) return null

  const [facts, quotes, actionsBySymbol, history, companies, histories] = await Promise.all([
    getFactHistory(company.id),
    getLatestQuotes(),
    getCorporateActionsBySymbol(),
    listPriceHistory(symbol),
    listTrackedCompanies(),
    getAllFactHistories(),
  ])

  const fye = { month: company.fiscalYearEndMonth, day: company.fiscalYearEndDay }
  const periodEnd = (fiscalYear: number) => fiscalYearBounds(fye, fiscalYear).end
  const years = adjustForCorporateActions(
    facts.years,
    actionsBySymbol.get(company.dseSymbol) ?? [],
    new Map(facts.years.map((y) => [y.fiscalYear, periodEnd(y.fiscalYear)])),
  )
  const latest = years[years.length - 1] ?? null

  const quote = quotes.get(company.dseSymbol) ?? null
  const price = quote?.close ?? null
  const valuation = quote
    ? computeValuation(quote, {
        eps: latest?.values.eps_basic ?? null,
        navps: latest?.values.navps ?? null,
        dividendPerShare: latest?.values.dividend_per_share ?? null,
      })
    : null

  const today = dhakaNow().date
  const coverage = coverageOf(history)

  // The other tracked companies, valued the same way, to compare against.
  const peerRows = companies
    .filter((c) => c.dseSymbol !== company.dseSymbol)
    .map((c) => {
      const reported = histories.get(c.dseSymbol) ?? []
      const ends = new Map(
        reported.map((y) => [y.fiscalYear, fiscalYearBounds({ month: c.fiscalYearEndMonth, day: c.fiscalYearEndDay }, y.fiscalYear).end]),
      )
      return buildScreenerRow(
        { symbol: c.dseSymbol, name: c.name, shortName: c.shortName, sector: c.sector },
        adjustForCorporateActions(reported, actionsBySymbol.get(c.dseSymbol) ?? [], ends),
        quotes.get(c.dseSymbol),
      )
    })
  const peerValues = (pick: (r: (typeof peerRows)[number]) => number | null) =>
    peerRows.map(pick).filter((v): v is number => v !== null)

  return {
    symbol: company.dseSymbol,
    name: company.shortName ?? company.name,
    price,
    tradeDate: quote?.tradeDate ?? null,
    changePct: quote && quote.ycp !== null && quote.ycp > 0 ? quote.close / quote.ycp - 1 : null,
    valuation,
    yearHigh: quote?.yearlyHigh ?? null,
    yearLow: quote?.yearlyLow ?? null,
    ownYear: price !== null && coverage.hasYear ? rangeOver(history, yearsAgo(today, 1), price) : null,
    band:
      price !== null && coverage.hasBand
        ? peBand(
            history,
            // Earnings as reported at the time, not restated onto today's
            // share base: the stored prices are the prices as traded, so a
            // P/E from an old day must use the earnings per share of that
            // day. Restating one side and not the other would make every
            // year before a bonus issue look wrongly cheap.
            earningsTimeline(facts.years, periodEnd),
            price,
            latest?.values.eps_basic ?? null,
            yearsAgo(today, 5),
          )
        : null,
    seasons: coverage.hasSeasons ? seasonality(history) : null,
    fall: coverage.hasYear ? drawdown(history) : null,
    coverage,
    latestFiscalYear: latest?.fiscalYear ?? null,
    eps: latest?.values.eps_basic ?? null,
    navps: latest?.values.navps ?? null,
    dividendPerShare: latest?.values.dividend_per_share ?? null,
    peers: {
      pe: compareWithPeers(valuation?.pe ?? null, peerValues((r) => r.pe)),
      pb: compareWithPeers(valuation?.pb ?? null, peerValues((r) => r.pb)),
      dividendYield: compareWithPeers(valuation?.dividendYield ?? null, peerValues((r) => r.dividendYield)),
      total: peerRows.length,
    },
  }
}
