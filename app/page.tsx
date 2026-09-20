import { ScreenerTable } from '@/app/components/ScreenerTable'
import { getAllFactHistories, getLatestQuotes, listTrackedCompanies } from '@/db/queries'
import { buildScreenerRow } from '@/lib/screener'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [companies, histories, quotes] = await Promise.all([
    listTrackedCompanies(),
    getAllFactHistories(),
    getLatestQuotes(),
  ])

  const rows = companies.map((company) =>
    buildScreenerRow(
      {
        symbol: company.dseSymbol,
        name: company.name,
        shortName: company.shortName,
        sector: company.sector,
      },
      histories.get(company.dseSymbol),
      quotes.get(company.dseSymbol),
    ),
  )

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
