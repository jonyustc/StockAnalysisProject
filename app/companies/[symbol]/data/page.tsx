import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getCompanyBySymbol, getPeriodSummaries } from '@/db/queries'
import { fiscalYearBounds, fiscalYearRange, latestReportedFiscalYear } from '@/lib/fiscal'

export const dynamic = 'force-dynamic'

const YEARS_TO_SHOW = 10

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ symbol: string }>
}) {
  const { symbol } = await params
  const company = await getCompanyBySymbol(symbol)

  if (!company) notFound()

  const fye = { month: company.fiscalYearEndMonth, day: company.fiscalYearEndDay }
  const latest = latestReportedFiscalYear(fye)
  const years = fiscalYearRange(latest, YEARS_TO_SHOW)

  const summaries = await getPeriodSummaries(company.id)
  const byYear = new Map(summaries.map((row) => [row.fiscalYear, row]))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/companies/${company.dseSymbol}`}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          ← {company.dseSymbol}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-100">
          Data entry{' '}
          <span className="font-mono text-sm text-neutral-500">DSE:{company.dseSymbol}</span>
        </h1>
        {company.notes ? (
          <p className="mt-1 text-sm text-neutral-500">{company.notes}</p>
        ) : null}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-4 font-medium">Fiscal year</th>
            <th className="py-2 pr-4 font-medium">Period</th>
            <th className="py-2 pr-4 text-right font-medium">Values</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 text-right font-medium" />
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const bounds = fiscalYearBounds(fye, year)
            const summary = byYear.get(year)

            return (
              <tr key={year} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                <td className="py-2.5 pr-4 font-medium text-neutral-200">FY{year}</td>
                <td className="py-2.5 pr-4 font-mono text-xs text-neutral-500">
                  {bounds.start} → {bounds.end}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-neutral-300">
                  {summary?.factCount ?? 0}
                </td>
                <td className="py-2.5 pr-4 text-xs">
                  {!summary ? (
                    <span className="text-neutral-600">Not started</span>
                  ) : summary.isComplete ? (
                    <span className="text-emerald-500">Complete</span>
                  ) : (
                    <span className="text-amber-500">In progress</span>
                  )}
                  {summary && summary.unverifiedCount > 0 ? (
                    <span className="ml-2 text-neutral-600">
                      {summary.unverifiedCount} unverified
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4 text-right">
                  <Link
                    href={`/companies/${company.dseSymbol}/${year}/edit`}
                    className="text-sky-400 hover:text-sky-300"
                  >
                    {summary ? 'Edit' : 'Enter'}
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="text-xs text-neutral-600">
        FY{latest} is the most recent year whose audited results should exist, allowing four
        months for filing. Years are labelled by the calendar year the fiscal year ends in.
      </p>
    </div>
  )
}
