import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  getCompanyBySymbol,
  getCoreLineItems,
  getPeriodWithFacts,
  listSourceDocuments,
} from '@/db/queries'
import { fiscalYearRangeLabel } from '@/lib/fiscal'
import { SCALE_FACTORS, type ValueScale } from '@/lib/units'

import { VerifyForm } from './VerifyForm'

export const dynamic = 'force-dynamic'

/** Mirrors the rule in the save action: only amounts take the period's scale. */
function scaleForUnit(unit: string, periodScale: ValueScale): ValueScale {
  return unit === 'currency' || unit === 'count' ? periodScale : 'unit'
}

/** Trim the trailing zeros a numeric column adds, so 20712.000000 reads as 20712. */
function tidy(value: number): string {
  return String(Number(value.toFixed(6)))
}

export default async function VerifyPeriodPage({
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

  const [items, { facts }, documents] = await Promise.all([
    getCoreLineItems(),
    getPeriodWithFacts(company.id, fiscalYear, 'consolidated'),
    listSourceDocuments(company.id),
  ])

  // Read the year back in whatever scale it was stored in, so the figures on
  // screen match the statement rather than a converted version of it.
  const storedCurrencyScale =
    [...facts.values()].find((fact) => fact.scale !== 'unit')?.scale ?? 'million'

  const rows = items.map((item) => {
    const fact = facts.get(item.id)
    const rowScale = scaleForUnit(item.unit, storedCurrencyScale)

    const stored =
      fact === undefined
        ? null
        : tidy((Number(fact.valueReported) * SCALE_FACTORS[fact.scale]) / SCALE_FACTORS[rowScale])

    return {
      id: item.id,
      tag: item.tag,
      label: item.label,
      statement: item.statement,
      unscaled: rowScale === 'unit' && item.unit !== 'currency' && item.unit !== 'count',
      stored,
      page: fact?.sourcePage ?? null,
      verification: fact?.verification ?? ('unverified' as const),
    }
  })

  return (
    <div className="space-y-6">
      <Link
        href={`/companies/${company.dseSymbol}/data`}
        className="text-xs text-neutral-500 hover:text-neutral-300"
      >
        ← {company.dseSymbol} data
      </Link>

      <VerifyForm
        symbol={company.dseSymbol}
        companyName={company.name}
        fiscalYear={fiscalYear}
        periodLabel={fiscalYearRangeLabel(fye, fiscalYear)}
        rows={rows}
        documents={documents.map((doc) => ({ id: doc.id, title: doc.title }))}
        defaultScale={storedCurrencyScale}
        basis="consolidated"
      />
    </div>
  )
}
