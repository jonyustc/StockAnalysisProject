import Link from 'next/link'

import {
  getLastJobRun,
  getLatestQuotes,
  listBoAccounts,
  listPortfolioTransactions,
} from '@/db/queries'
import { buildPortfolio, MIN_DAYS_TO_ANNUALISE } from '@/lib/portfolio'
import { PRICE_SOURCE_NAME } from '@/lib/prices'
import { assessFreshness, formatTradeDate, type Freshness } from '@/lib/trading-calendar'
import { formatBDT, formatPercent } from '@/lib/units'

export const dynamic = 'force-dynamic'

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const accountParam = Number(Array.isArray(params.account) ? params.account[0] : params.account)

  const [transactions, quotes, accounts, lastPriceJob] = await Promise.all([
    listPortfolioTransactions(),
    getLatestQuotes(),
    listBoAccounts(),
    getLastJobRun('prices'),
  ])

  const selected = accounts.find((a) => a.id === accountParam) ?? null
  const prices = new Map([...quotes].map(([symbol, quote]) => [symbol, quote.close]))
  const priceDates = new Map([...quotes].map(([symbol, quote]) => [symbol, quote.tradeDate]))
  const portfolio = buildPortfolio(transactions, prices, new Date(), selected?.id)
  const everything = selected ? buildPortfolio(transactions, prices) : portfolio

  const open = portfolio.holdings.filter((h) => h.quantity > 0)

  // Freshness of the prices actually valuing these holdings — not of the
  // whole board — measured in trading days rather than calendar days.
  const heldDates = open
    .map((h) => priceDates.get(h.symbol))
    .filter((d): d is string => d !== undefined)
    .sort()
  const newestPrice = heldDates.at(-1) ?? null
  const freshness = assessFreshness(newestPrice)
  const closed = portfolio.holdings.filter((h) => h.quantity === 0)
  const warnings = portfolio.holdings.flatMap((h) => h.warnings)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Portfolio</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {selected ? `${selected.name}. ` : 'All BO accounts combined. '}
            Cost basis is weighted average per account, with commission included and bonus shares
            reducing it. Derived from the ledger, never stored.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/portfolio/import"
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
          >
            Import statement
          </Link>
          <Link
            href="/portfolio/transactions"
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
          >
            Transactions
          </Link>
        </div>
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
          {accounts.length > 1 ? (
            <nav className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-neutral-600">Account:</span>
              <FilterLink href="/portfolio" active={!selected}>
                All
              </FilterLink>
              {accounts.map((account) => (
                <FilterLink
                  key={account.id}
                  href={`/portfolio?account=${account.id}`}
                  active={selected?.id === account.id}
                >
                  {account.name}
                </FilterLink>
              ))}
            </nav>
          ) : null}

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
              sub={
                portfolio.xirr === null && portfolio.historyDays < MIN_DAYS_TO_ANNUALISE
                  ? `needs a year of history (${portfolio.historyDays} day${portfolio.historyDays === 1 ? '' : 's'} so far)`
                  : 'money-weighted, annual'
              }
              tone={portfolio.xirr === null ? undefined : portfolio.xirr >= 0 ? 'good' : 'bad'}
            />
          </section>

          {open.length > 0 ? (
            <PriceFreshness freshness={freshness} lastJob={lastPriceJob} />
          ) : null}

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
            emptyText="No open positions in this account."
            priceDates={priceDates}
            newestPrice={newestPrice}
          />

          {/* Per-account totals, only when looking at everything and there is
              more than one account to compare. */}
          {!selected && everything.byAccount.length > 1 ? (
            <section>
              <h2 className="mb-2 text-sm font-medium text-neutral-300">By account</h2>
              <div className="overflow-x-auto rounded border border-neutral-800">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
                      <th className="px-3 py-2 text-left font-medium">Account</th>
                      <th className="px-3 py-2 text-right font-medium">Positions</th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-right font-medium">Value</th>
                      <th className="px-3 py-2 text-right font-medium">Unrealised</th>
                      <th className="px-3 py-2 text-right font-medium">Realised</th>
                      <th className="px-3 py-2 text-right font-medium">Share of total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {everything.byAccount.map((account) => (
                      <tr key={account.accountId} className="border-b border-neutral-900 last:border-0">
                        <td className="px-3 py-2">
                          <Link
                            href={`/portfolio?account=${account.accountId}`}
                            className="text-sky-400 hover:text-sky-300"
                          >
                            {account.accountName}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                          {account.openPositions}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                          {formatBDT(account.totalCost)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-200">
                          {formatBDT(account.totalMarketValue)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            account.totalUnrealised >= 0 ? 'text-emerald-500' : 'text-red-400'
                          }`}
                        >
                          {formatBDT(account.totalUnrealised)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                          {account.totalRealised === 0 ? '—' : formatBDT(account.totalRealised)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                          {everything.totalMarketValue > 0
                            ? formatPercent(account.totalMarketValue / everything.totalMarketValue, 1)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

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
  priceDates,
  newestPrice = null,
}: {
  title: string
  rows: ReturnType<typeof buildPortfolio>['holdings']
  total: number
  emptyText: string
  closed?: boolean
  priceDates?: Map<string, string>
  newestPrice?: string | null
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
                  {/* Combined across accounts — the average cost shown is the
                      sum of each account's cost over the sum of shares. */}
                  {holding.accountCount > 1 ? (
                    <span
                      className="ml-2 text-xs text-neutral-600"
                      title="Held in more than one BO account; each is costed separately"
                    >
                      {holding.accountCount} accounts
                    </span>
                  ) : null}
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
                      {/* A stock that did not trade, or was halted, keeps its
                          last close — flag it so it is not read as today's. */}
                      {(() => {
                        const date = priceDates?.get(holding.symbol)
                        return date && newestPrice && date < newestPrice ? (
                          <span
                            className="block text-xs text-amber-500/80"
                            title="Older than the rest — it may not have traded since"
                          >
                            price from {formatTradeDate(date)}
                          </span>
                        ) : null
                      })()}
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

function PriceFreshness({
  freshness,
  lastJob,
}: {
  freshness: Freshness
  lastJob: { startedAt: Date; succeeded: boolean | null; message: string | null } | null
}) {
  if (freshness.status === 'none' || freshness.latest === null) {
    return (
      <p className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
        No prices yet, so market value cannot be worked out. Prices arrive once a trading day,
        around 5pm Dhaka.
      </p>
    )
  }

  const asOf = (
    <>
      Prices as of <strong className="font-medium text-neutral-300">{formatTradeDate(freshness.latest)}</strong>{' '}
      · DSE close via {PRICE_SOURCE_NAME}
    </>
  )

  if (freshness.status === 'fresh') {
    return <p className="text-xs text-neutral-500">{asOf}</p>
  }

  if (freshness.status === 'behind') {
    return (
      <p className="text-xs text-neutral-500">
        {asOf} · <span className="text-amber-500/80">the {formatTradeDate(freshness.expected)} close has not arrived yet</span>
      </p>
    )
  }

  // Stale: two or more sessions missed. Say why, if the job left a reason.
  const failed = lastJob && lastJob.succeeded === false
  return (
    <div className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
      <p>
        <strong className="font-medium">
          Prices are {freshness.missedTradingDays} trading days old
        </strong>{' '}
        — last close {formatTradeDate(freshness.latest)}, expected {formatTradeDate(freshness.expected)}.
        Market value and gains below are out of date. If DSE has been shut for a holiday, this is
        expected; otherwise the daily price job is not running.
      </p>
      {lastJob ? (
        <p className="mt-1 text-amber-200/60">
          Last price job: {lastJob.startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC ·{' '}
          {failed ? 'failed' : 'succeeded'}
          {lastJob.message ? ` — ${lastJob.message}` : ''}
        </p>
      ) : (
        <p className="mt-1 text-amber-200/60">The price job has never run.</p>
      )}
    </div>
  )
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-2.5 py-0.5 ${
        active
          ? 'border-sky-700 text-sky-300'
          : 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
      }`}
    >
      {children}
    </Link>
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
