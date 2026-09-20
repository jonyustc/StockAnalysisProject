import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  getCompanyBySymbol,
  getCoreLineItems,
  getPeriodWithFacts,
  listSourceDocuments,
} from '@/db/queries'
import { fiscalYearBounds, fiscalYearRangeLabel } from '@/lib/fiscal'

import { EntryForm } from './EntryForm'

export const dynamic = 'force-dynamic'

export default async function EditPeriodPage({
  params,
}: {
  params: Promise<{ symbol: string; fy: string }>
}) {
  const { symbol, fy } = await params
  const fiscalYear = Number(fy)

  if (!Number.isInteger(fiscalYear)) notFound()

  const company = await getCompanyBySymbol(symbol)
  if (!company) notFound()

  const fye = { month: company.fiscalYearEndMonth, day: company.fiscalYearEndDay }
  const bounds = fiscalYearBounds(fye, fiscalYear)

  const [items, { period, facts }, documents] = await Promise.all([
    getCoreLineItems(),
    getPeriodWithFacts(company.id, fiscalYear, 'consolidated'),
    listSourceDocuments(company.id),
  ])

  // Reuse whatever scale this period was last saved with, so re-editing a year
  // does not silently reinterpret its figures.
  const existingCurrencyFact = [...facts.values()].find((fact) => fact.scale !== 'unit')
  const defaultScale = existingCurrencyFact?.scale ?? 'million'

  return (
    <div className="space-y-6">
      <Link
        href={`/companies/${company.dseSymbol}`}
        className="text-xs text-neutral-500 hover:text-neutral-300"
      >
        ← {company.dseSymbol}
      </Link>

      <EntryForm
        symbol={company.dseSymbol}
        companyName={company.name}
        fiscalYear={fiscalYear}
        periodLabel={fiscalYearRangeLabel(fye, fiscalYear)}
        periodStart={bounds.start}
        periodEnd={bounds.end}
        items={items.map((item) => ({
          id: item.id,
          tag: item.tag,
          label: item.label,
          statement: item.statement,
          unit: item.unit,
        }))}
        facts={Object.fromEntries(facts)}
        existing={
          period
            ? {
                basis: period.basis,
                auditStatus: period.auditStatus,
                isComplete: period.isComplete,
                notes: period.notes,
              }
            : null
        }
        documents={documents.map((doc) => ({ id: doc.id, title: doc.title }))}
        defaultScale={defaultScale}
      />
    </div>
  )
}
