import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SeriesChart } from '@/app/components/charts/SeriesChart'
import { getCompanyBySymbol, getFactHistory } from '@/db/queries'
import { fiscalYearRangeLabel } from '@/lib/fiscal'
import { computeHistory, summariseHistory, totalDebt } from '@/lib/metrics'
import { formatBDT, formatPercent, formatPerShare, formatRatio } from '@/lib/units'

export const dynamic = 'force-dynamic'

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ symbol: string }>
}) {
  const { symbol } = await params
  const company = await getCompanyBySymbol(symbol)
  if (!company) notFound()

  const fye = { month: company.fiscalYearEndMonth, day: company.fiscalYearEndDay }
  const { years, factCount, unverifiedCount } = await getFactHistory(company.id)

  const metrics = computeHistory(years)
  const summary = summariseHistory(years, metrics)

  const latest = years[years.length - 1]
  const latestMetrics = metrics[metrics.length - 1]
  const categories = years.map((year) => `FY${year.fiscalYear}`)

  const value = (tag: string, index: number) => years[index]?.values[tag] ?? null
  const seriesFor = (tag: string) => years.map((_, i) => value(tag, i))

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← All companies
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-100">
            {company.name}{' '}
            <span className="font-mono text-sm text-neutral-500">DSE:{company.dseSymbol}</span>
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {years.length > 0
              ? `${years.length} years entered · ${fiscalYearRangeLabel(fye, latest.fiscalYear)}`
              : 'No data entered yet'}
          </p>
        </div>

        <Link
          href={`/companies/${company.dseSymbol}/data`}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
        >
          Enter data
        </Link>
      </header>

      {years.length === 0 ? (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
          Nothing to analyse yet.{' '}
          <Link
            href={`/companies/${company.dseSymbol}/data`}
            className="text-sky-400 hover:text-sky-300"
          >
            Enter a year
          </Link>{' '}
          and the charts and metrics below will build themselves.
        </p>
      ) : (
        <>
          {unverifiedCount > 0 ? (
            <p className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
              <strong className="font-medium">{unverifiedCount} of {factCount} figures are
              unverified.</strong>{' '}
              They have not been checked against a primary source, so treat everything below as
              provisional.
            </p>
          ) : null}

          {/* The headline numbers. A stat tile beats a one-bar chart. */}
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Revenue" value={formatBDT(latest.values.revenue ?? null)} sub={`FY${latest.fiscalYear}`} />
            <Stat label="Net profit" value={formatBDT(latest.values.net_profit ?? null)} sub={`FY${latest.fiscalYear}`} />
            <Stat label="EPS" value={formatPerShare(latest.values.eps_basic ?? null)} sub={`FY${latest.fiscalYear}`} />
            <Stat label="ROE" value={formatPercent(latestMetrics.roe, 1)} sub="on average equity" />
            <Stat label="Debt / equity" value={formatRatio(latestMetrics.debtToEquity)} sub={formatBDT(totalDebt(latest))} />
            <Stat label="Payout" value={formatPercent(latestMetrics.payoutRatio, 0)} sub="of EPS" />
          </section>

          {/* Long-run shape. CAGR is hostage to its endpoints, so it sits next
              to the charts rather than standing in for them. */}
          {summary.years > 0 ? (
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label={`Revenue CAGR`} value={formatPercent(summary.revenueCagr, 1)} sub={`${summary.years}y`} />
              <Stat label="EPS CAGR" value={formatPercent(summary.epsCagr, 1)} sub={`${summary.years}y`} />
              <Stat label="Net profit CAGR" value={formatPercent(summary.netProfitCagr, 1)} sub={`${summary.years}y`} />
              <Stat label="Average ROE" value={formatPercent(summary.averageRoe, 1)} sub="across years held" />
              <Stat
                label="Positive FCF"
                value={`${summary.positiveFcfYears} / ${summary.fcfYearsCounted}`}
                sub="years"
              />
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <SeriesChart
              kind="bar"
              format="bdt"
              title="Revenue and net profit"
              caption="Same axis, same unit — the gap between them is the margin story."
              categories={categories}
              series={[
                { key: 'revenue', label: 'Revenue', values: seriesFor('revenue') },
                { key: 'net_profit', label: 'Net profit', values: seriesFor('net_profit') },
              ]}
            />

            <SeriesChart
              kind="line"
              format="percent"
              title="Margins"
              caption="Whether growth is being bought or earned."
              categories={categories}
              series={[
                { key: 'gross', label: 'Gross', values: metrics.map((m) => m.grossMargin) },
                { key: 'operating', label: 'Operating', values: metrics.map((m) => m.operatingMargin) },
                { key: 'net', label: 'Net', values: metrics.map((m) => m.netMargin) },
              ]}
            />

            <SeriesChart
              kind="line"
              format="percent"
              title="Returns on capital"
              caption="ROE on average equity; ROCE on assets less current liabilities."
              categories={categories}
              series={[
                { key: 'roe', label: 'ROE', values: metrics.map((m) => m.roe) },
                { key: 'roce', label: 'ROCE', values: metrics.map((m) => m.roce) },
              ]}
            />

            <SeriesChart
              kind="bar"
              format="bdt"
              title="Cash against profit"
              caption="Profit you cannot bank is an accounting opinion. Watch for OCF trailing net profit year after year."
              categories={categories}
              series={[
                {
                  key: 'ocf',
                  label: 'Operating cash flow',
                  values: seriesFor('net_operating_cash_flow'),
                },
                { key: 'net_profit', label: 'Net profit', values: seriesFor('net_profit') },
              ]}
            />
          </section>

          {/* The table view every chart above is answerable from. */}
          <section>
            <h2 className="mb-2 text-sm font-medium text-neutral-300">All years</h2>
            <div className="overflow-x-auto rounded border border-neutral-800">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-2 text-left font-medium">Metric</th>
                    {years.map((year) => (
                      <th key={year.fiscalYear} className="px-3 py-2 text-right font-medium tabular-nums">
                        FY{year.fiscalYear}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Revenue" values={seriesFor('revenue')} render={(v) => formatBDT(v)} />
                  <Row label="Gross profit" values={seriesFor('gross_profit')} render={(v) => formatBDT(v)} />
                  <Row label="Operating profit" values={seriesFor('operating_profit')} render={(v) => formatBDT(v)} />
                  <Row label="Net profit" values={seriesFor('net_profit')} render={(v) => formatBDT(v)} />
                  <Row label="Revenue growth" values={metrics.map((m) => m.revenueGrowth)} render={(v) => formatPercent(v, 1, true)} />
                  <Row label="EPS" values={seriesFor('eps_basic')} render={(v) => formatPerShare(v)} />
                  <Row label="EPS growth" values={metrics.map((m) => m.epsGrowth)} render={(v) => formatPercent(v, 1, true)} />
                  <Row label="NAVPS" values={seriesFor('navps')} render={(v) => formatPerShare(v)} />
                  <Row label="Dividend / share" values={seriesFor('dividend_per_share')} render={(v) => formatPerShare(v)} />
                  <Row label="Payout ratio" values={metrics.map((m) => m.payoutRatio)} render={(v) => formatPercent(v, 0)} />
                  <Row label="Net margin" values={metrics.map((m) => m.netMargin)} render={(v) => formatPercent(v, 1)} />
                  <Row label="ROE" values={metrics.map((m) => m.roe)} render={(v) => formatPercent(v, 1)} />
                  <Row label="ROCE" values={metrics.map((m) => m.roce)} render={(v) => formatPercent(v, 1)} />
                  <Row label="Debt / equity" values={metrics.map((m) => m.debtToEquity)} render={(v) => formatRatio(v)} />
                  <Row label="Current ratio" values={metrics.map((m) => m.currentRatio)} render={(v) => formatRatio(v)} />
                  <Row label="Operating cash flow" values={seriesFor('net_operating_cash_flow')} render={(v) => formatBDT(v)} />
                  <Row label="Capex" values={seriesFor('capex')} render={(v) => formatBDT(v)} />
                  <Row label="Free cash flow" values={metrics.map((m) => m.fcf)} render={(v) => formatBDT(v)} />
                  <Row label="Cash conversion" values={metrics.map((m) => m.cashConversion)} render={(v) => formatRatio(v)} />
                  <Row label="Total equity" values={seriesFor('total_equity')} render={(v) => formatBDT(v)} />
                  <Row label="Total assets" values={seriesFor('total_assets')} render={(v) => formatBDT(v)} />
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-neutral-950 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      {/* Proportional figures on standalone numbers; tabular-nums is for columns. */}
      <p className="mt-0.5 text-lg font-medium text-neutral-100">{value}</p>
      {sub ? <p className="text-xs text-neutral-600">{sub}</p> : null}
    </div>
  )
}

function Row({
  label,
  values,
  render,
}: {
  label: string
  values: (number | null)[]
  render: (value: number) => string
}) {
  return (
    <tr className="border-b border-neutral-900 last:border-0 hover:bg-neutral-900/40">
      <td className="px-3 py-1.5 text-neutral-400">{label}</td>
      {values.map((value, index) => (
        <td key={index} className="px-3 py-1.5 text-right tabular-nums text-neutral-200">
          {value === null ? <span className="text-neutral-700">—</span> : render(value)}
        </td>
      ))}
    </tr>
  )
}
