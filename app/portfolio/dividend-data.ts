import 'server-only'

import {
  getAllFactHistories,
  getCorporateActionsBySymbol,
  listTrackedCompanies,
} from '@/db/queries'
import { fiscalYearBounds } from '@/lib/fiscal'
import { adjustForCorporateActions } from '@/lib/metrics'

/**
 * Each company's latest reported dividend per share, restated onto today's
 * share base — the same adjustment the company page and screener apply, so a
 * bonus issue since that year does not inflate the income it projects.
 */
export async function latestDividendPerShare(): Promise<
  Map<string, { dividendPerShare: number; fiscalYear: number }>
> {
  const [companies, histories, actions] = await Promise.all([
    listTrackedCompanies(),
    getAllFactHistories(),
    getCorporateActionsBySymbol(),
  ])

  const result = new Map<string, { dividendPerShare: number; fiscalYear: number }>()

  for (const company of companies) {
    const reported = histories.get(company.dseSymbol) ?? []
    const fye = { month: company.fiscalYearEndMonth, day: company.fiscalYearEndDay }
    const periodEnds = new Map(
      reported.map((year) => [year.fiscalYear, fiscalYearBounds(fye, year.fiscalYear).end]),
    )
    const adjusted = adjustForCorporateActions(reported, actions.get(company.dseSymbol) ?? [], periodEnds)

    const latest = [...adjusted].reverse().find((y) => typeof y.values.dividend_per_share === 'number')
    if (latest) {
      result.set(company.dseSymbol, {
        dividendPerShare: latest.values.dividend_per_share as number,
        fiscalYear: latest.fiscalYear,
      })
    }
  }

  return result
}
