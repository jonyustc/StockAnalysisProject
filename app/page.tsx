import { ScreenerTable } from '@/app/components/ScreenerTable'
import {
  getAllFactHistories,
  getCorporateActionsBySymbol,
  getLatestQuotes,
  listTrackedCompanies,
} from '@/db/queries'
import { fiscalYearBounds } from '@/lib/fiscal'
import { adjustForCorporateActions } from '@/lib/metrics'
import { buildScreenerRow } from '@/lib/screener'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [companies, histories, quotes, actionsBySymbol] = await Promise.all([
    listTrackedCompanies(),
    getAllFactHistories(),
    getLatestQuotes(),
    getCorporateActionsBySymbol(),
  ])

  const rows = companies.map((company) => {
    const reported = histories.get(company.dseSymbol) ?? []
    const fye = {
      month: company.fiscalYearEndMonth,
      day: company.fiscalYearEndDay,
    }

    // Same restatement the company page applies, so a screen on EPS CAGR is
    // not quietly comparing pre- and post-issue per-share figures.
    const periodEnds = new Map(
      reported.map((year) => [year.fiscalYear, fiscalYearBounds(fye, year.fiscalYear).end]),
    )
    const adjusted = adjustForCorporateActions(
      reported,
      actionsBySymbol.get(company.dseSymbol) ?? [],
      periodEnds,
    )

    return buildScreenerRow(
      {
        symbol: company.dseSymbol,
        name: company.name,
        shortName: company.shortName,
        sector: company.sector,
      },
      adjusted,
      quotes.get(company.dseSymbol),
    )
  })

  const sectors = [...new Set(companies.map((c) => c.sector).filter((s): s is string => !!s))].sort()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Screener</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {companies.length} tracked companies. Valuation is against the latest reported fiscal
          year, which differs per company — each has its own year end.
        </p>
      </div>

      <ScreenerTable rows={rows} sectors={sectors} />
    </div>
  )
}
