import Link from 'next/link'

import { listTrackedCompanies } from '@/db/queries'
import { fiscalYearRangeLabel, latestReportedFiscalYear } from '@/lib/fiscal'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const companies = await listTrackedCompanies()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Tracked companies</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {companies.length} companies. Fiscal years differ, so each is shown with its own
          reporting period.
        </p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-4 font-medium">Symbol</th>
            <th className="py-2 pr-4 font-medium">Company</th>
            <th className="py-2 pr-4 font-medium">Sector</th>
            <th className="py-2 pr-4 font-medium">Latest reported</th>
            <th className="py-2 pr-4 text-right font-medium">Years entered</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => {
            const fye = {
              month: company.fiscalYearEndMonth,
              day: company.fiscalYearEndDay,
            }
            const latest = latestReportedFiscalYear(fye)

            return (
              <tr key={company.id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                <td className="py-2.5 pr-4">
                  <Link
                    href={`/companies/${company.dseSymbol}`}
                    className="font-medium text-sky-400 hover:text-sky-300"
                  >
                    {company.dseSymbol}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 text-neutral-300">{company.name}</td>
                <td className="py-2.5 pr-4 text-neutral-500">{company.sector ?? '—'}</td>
                <td className="py-2.5 pr-4 text-neutral-400">
                  {fiscalYearRangeLabel(fye, latest)}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-neutral-400">
                  {company.periodCount > 0 ? company.periodCount : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
