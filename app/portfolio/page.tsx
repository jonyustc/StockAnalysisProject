import Link from 'next/link'

import { getLatestQuotes, listPortfolioTransactions } from '@/db/queries'
import { buildPortfolio } from '@/lib/portfolio'
import { formatBDT, formatPercent } from '@/lib/units'

export const dynamic = 'force-dynamic'

export default async function PortfolioPage() {
  const [transactions, quotes] = await Promise.all([
    listPortfolioTransactions(),
    getLatestQuotes(),
  ])

  const prices = new Map([...quotes].map(([symbol, quote]) => [symbol, quote.close]))
  const portfolio = buildPortfolio(transactions, prices)

  const open = portfolio.holdings.filter((h) => h.quantity > 0)
  const closed = portfolio.holdings.filter((h) => h.quantity === 0)
  const warnings = portfolio.holdings.flatMap((h) => h.warnings)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Portfolio</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Cost basis is weighted average, with commission included and bonus shares reducing
            it. Derived from the ledger, never stored.
          </p>
        </div>
        <Link
          href="/portfolio/transactions"
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
        >
          Transactions
        </Link>
      </header>

      {transactions.length === 0 ? (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
          Nothing recorded yet.{' '}
          <Link href="/portfolio/transactions" className="text-sky-400 hover:text-sky-300">
            Add your first transaction
          </Link>{' '}
          and the holdings build themselves.
        </p>
      ) : (
        <>
          {warnings.length > 0 ? (
            <div className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Cost" value={formatBDT(portfolio.totalCost)} sub="of what you still hold" />
            <Stat label="Market value" value={formatBDT(portfolio.totalMarketValue)} />
            <Stat
              label="Unrealised"
              value={formatBDT(portfolio.totalUnrealised)}
              sub={formatPercent(portfolio.totalUnrealisedPct, 1, true)}
              tone={portfolio.totalUnrealised >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Realised"
              value={formatBDT(portfolio.totalRealised)}
              sub="after commission"
              tone={portfolio.totalRealised >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Dividends"
              value={formatBDT(portfolio.totalDividendsGross)}
              sub={`${formatBDT(portfolio.totalDividendsNet)} after tax`}
            />
            <Stat
              label="XIRR"
              value={formatPercent(portfolio.xirr, 1)}
              sub="money-weighted"
              tone={portfolio.xirr === null ? undefined : portfolio.xirr >= 0 ? 'good' : 'bad'}
            />
          </section>

          {portfolio.largestWeight !== null && portfolio.largestWeight > 0.4 ? (
            <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-400">
              <strong className="font-medium text-neutral-300">
                {formatPercent(portfolio.largestWeight, 0)} of the portfolio
              </strong>{' '}
              sits in one position. Worth knowing, not necessarily worth fixing.
            </p>
          ) : null}

          <Table
            title="Holdings"
            rows={open}
            total={portfolio.totalMarketValue}
            emptyText="No open positions."
          />

          {closed.length > 0 ? (
            <Table
              title="Closed"
              rows={closed}
              total={portfolio.totalMarketValue}
              emptyText=""
              closed
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function Table({
  title,
  rows,
  total,
  emptyText,
  closed = false,
}: {
  title: string
  rows: ReturnType<typeof buildPortfolio>['holdings']
  total: number
  emptyText: string
  closed?: boolean
}) {
  if (rows.length === 0) {
    return emptyText ? <p className="text-sm text-neutral-500">{emptyText}</p> : null
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-neutral-300">{title}</h2>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2 text-left font-medium">Symbol</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Avg cost</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              {!closed ? (
                <>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">Unrealised</th>
                  <th className="px-3 py-2 text-right font-medium">Weight</th>
                  <th className="px-3 py-2 text-right font-medium">Yield on cost</th>
                </>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">Realised</th>
              <th className="px-3 py-2 text-right font-medium">Dividends</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((holding) => (
              <tr key={holding.symbol} className="border-b border-neutral-900 last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/companies/${holding.symbol}`}
                    className="font-medium text-sky-400 hover:text-sky-300"
                  >
                    {holding.symbol}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-200">
                  {holding.quantity.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                  {holding.averageCost === null ? '—' : `৳${holding.averageCost.toFixed(2)}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                  {formatBDT(holding.costBasis)}
                </td>
                {!closed ? (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-200">
                      {holding.marketValue === null ? (
                        <span className="text-neutral-700" title="No price yet">
                          —
                        </span>
                      ) : (
                        formatBDT(holding.marketValue)
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        (holding.unrealisedGain ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'
                      }`}
                    >
                      {holding.unrealisedGain === null
                        ? '—'
                        : `${formatBDT(holding.unrealisedGain)} (${formatPercent(
                            holding.unrealisedPct,
                            1,
                            true,
                          )})`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                      {total > 0 ? formatPercent((holding.marketValue ?? 0) / total, 1) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                      {formatPercent(holding.yieldOnCost, 2)}
                    </td>
                  </>
                ) : null}
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    holding.realisedGain > 0
                      ? 'text-emerald-500'
                      : holding.realisedGain < 0
                        ? 'text-red-400'
                        : 'text-neutral-600'
                  }`}
                >
                  {holding.realisedGain === 0 ? '—' : formatBDT(holding.realisedGain)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                  {holding.dividendsGross === 0 ? '—' : formatBDT(holding.dividendsGross)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad'
}) {
  const colour =
    tone === 'good' ? 'text-emerald-500' : tone === 'bad' ? 'text-red-400' : 'text-neutral-100'

  return (
    <div className="bg-neutral-950 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-0.5 text-lg font-medium ${colour}`}>{value}</p>
      {sub ? <p className="text-xs text-neutral-600">{sub}</p> : null}
    </div>
  )
}
