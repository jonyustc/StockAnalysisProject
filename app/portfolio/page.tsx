import Link from 'next/link'

import {
  getLastJobRun,
  getLatestQuotes,
  listAccountSnapshots,
  listBoAccounts,
  listPortfolioTransactions,
} from '@/db/queries'
import {
  lifetimeReturn,
  yearlyReturns,
  type AccountSnapshot,
} from '@/lib/account-return'
import { buildPortfolio, freeSharePlan, MIN_DAYS_TO_ANNUALISE } from '@/lib/portfolio'
import { PRICE_SOURCE_NAME } from '@/lib/prices'
import { assessFreshness, formatTradeDate, type Freshness } from '@/lib/trading-calendar'
import { formatBDT, formatPercent } from '@/lib/units'

import { AccountFilter, PortfolioNav, Stat } from './ui'

export const dynamic = 'force-dynamic'

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const accountParam = Number(Array.isArray(params.account) ? params.account[0] : params.account)

  const [transactions, quotes, accounts, lastPriceJob, allSnapshots] = await Promise.all([
    listPortfolioTransactions(),
    getLatestQuotes(),
    listBoAccounts(),
    getLastJobRun('prices'),
    listAccountSnapshots(),
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

  // Cash is not in the ledger — it comes from each account's latest statement.
  const scopedSnapshots = selected
    ? allSnapshots.filter((s) => s.accountId === selected.id)
    : allSnapshots
  const latestSnapshot = new Map<number, (typeof allSnapshots)[number]>()
  for (const s of scopedSnapshots) latestSnapshot.set(s.accountId, s)
  const cash = [...latestSnapshot.values()].reduce((sum, s) => sum + s.cashBalance, 0)
  const cashAsOf = [...latestSnapshot.values()].map((s) => s.asOf).sort()[0] ?? null

  // Sector weights, by market value.
  const sectorOf = new Map(transactions.map((t) => [t.symbol, t.sector ?? 'Unclassified']))
  const bySector = new Map<string, number>()
  for (const h of open) {
    const sector = sectorOf.get(h.symbol) ?? 'Unclassified'
    bySector.set(sector, (bySector.get(sector) ?? 0) + (h.marketValue ?? 0))
  }
  const sectors = [...bySector.entries()].sort((a, b) => b[1] - a[1])

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

      <PortfolioNav current="holdings" />

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
          <AccountFilter basePath="/portfolio" accounts={accounts} selectedId={selected?.id ?? null} />

          {warnings.length > 0 ? (
            <div className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
            <Stat
              label="Total worth"
              value={formatBDT(portfolio.totalMarketValue + cash)}
              sub="holdings plus cash"
            />
            <Stat label="Market value" value={formatBDT(portfolio.totalMarketValue)} />
            <Stat
              label="Cash available"
              value={cashAsOf ? formatBDT(cash) : '—'}
              sub={cashAsOf ? `per statement of ${formatTradeDate(cashAsOf)}` : 'import a statement'}
            />
            <Stat label="Cost" value={formatBDT(portfolio.totalCost)} sub="of what you still hold" />
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
            prices={prices}
          />

          {sectors.length > 1 ? (
            <section>
              <h2 className="mb-2 text-sm font-medium text-neutral-300">By sector</h2>
              <div className="space-y-1.5 rounded border border-neutral-800 bg-neutral-900/40 p-4">
                {sectors.map(([sector, value]) => {
                  const share = portfolio.totalMarketValue > 0 ? value / portfolio.totalMarketValue : 0
                  return (
                    <div key={sector} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-xs">
                      <span className="truncate text-neutral-400">{sector}</span>
                      <span className="h-2 overflow-hidden rounded bg-neutral-800">
                        <span className="block h-full bg-sky-600" style={{ width: `${share * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums text-neutral-300">{formatPercent(share, 1)}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          <AccountReturns
            snapshots={
              selected ? allSnapshots.filter((s) => s.accountId === selected.id) : allSnapshots
            }
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
  prices,
}: {
  title: string
  rows: ReturnType<typeof buildPortfolio>['holdings']
  total: number
  emptyText: string
  closed?: boolean
  priceDates?: Map<string, string>
  newestPrice?: string | null
  prices?: Map<string, number>
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
              {!closed ? (
                <th
                  className="px-3 py-2 text-right font-medium"
                  title="Everything paid in, less sale proceeds and dividends, over the shares still held"
                >
                  Net cost
                </th>
              ) : null}
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
                {!closed ? (
                  <td className="px-3 py-2 text-right tabular-nums">
                    <NetCost holding={holding} price={prices?.get(holding.symbol) ?? null} />
                  </td>
                ) : null}
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

type SnapshotRow = AccountSnapshot & { accountId: number; accountName: string }

function pct(value: number | null): string {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

/**
 * Returns from broker statement snapshots. Separate from the ledger figures
 * above on purpose: these come from the broker's lifetime totals, so they
 * include sales and dividends from before the ledger began, and account
 * charges that no holding shows.
 */
function AccountReturns({ snapshots }: { snapshots: SnapshotRow[] }) {
  if (snapshots.length === 0) {
    return (
      <section className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-xs text-neutral-500">
        <p className="text-sm text-neutral-300">Returns</p>
        <p className="mt-1">
          No account snapshots yet. Import a broker statement and save it — the account totals on
          it give your lifetime return straight away, and yearly returns build up from each import.
        </p>
      </section>
    )
  }

  const byAccount = new Map<number, SnapshotRow[]>()
  for (const s of snapshots) {
    if (!byAccount.has(s.accountId)) byAccount.set(s.accountId, [])
    byAccount.get(s.accountId)!.push(s)
  }

  const accounts = [...byAccount.values()].map((series) => {
    const latest = series[series.length - 1]
    return {
      name: latest.accountName,
      latest,
      life: lifetimeReturn(latest),
      years: yearlyReturns(series),
      count: series.length,
    }
  })

  // Combined lifetime: sum money in and worth across each account's latest.
  const moneyIn = accounts.reduce((t, a) => t + a.life.moneyIn, 0)
  const worth = accounts.reduce((t, a) => t + a.life.worth, 0)
  const unexplained = accounts.reduce((t, a) => t + (a.life.unexplained ?? 0), 0)
  const yearly = accounts.flatMap((a) => a.years.map((y) => ({ ...y, name: a.name })))
  const fewest = Math.min(...accounts.map((a) => a.count))

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-neutral-300">Returns</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          From the broker&apos;s lifetime totals: what you deposited against what the account is
          worth. Includes sales and dividends from before this ledger began, and account charges
          no holding shows. Dividends are counted as return, not as money you put in.
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2 text-left font-medium">Account</th>
              <th className="px-3 py-2 text-left font-medium">As of</th>
              <th className="px-3 py-2 text-right font-medium">Money in</th>
              <th className="px-3 py-2 text-right font-medium">Worth now</th>
              <th className="px-3 py-2 text-right font-medium">Gain</th>
              <th className="px-3 py-2 text-right font-medium">Total return</th>
              <th className="px-3 py-2 text-right font-medium">Realised</th>
              <th className="px-3 py-2 text-right font-medium">Dividends</th>
              <th className="px-3 py-2 text-right font-medium" title="Not explained by any line — usually account charges such as the BO maintenance fee">
                Charges*
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.name} className="border-b border-neutral-900">
                <td className="px-3 py-2 text-neutral-300">{a.name}</td>
                <td className="px-3 py-2 text-xs text-neutral-500">{formatTradeDate(a.latest.asOf)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{formatBDT(a.life.moneyIn)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-200">{formatBDT(a.life.worth)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${a.life.gain >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                  {formatBDT(a.life.gain)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${(a.life.totalReturn ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                  {pct(a.life.totalReturn)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{formatBDT(a.life.realised)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{formatBDT(a.life.dividends)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                  {a.life.unexplained === null ? '—' : formatBDT(a.life.unexplained)}
                </td>
              </tr>
            ))}
            {accounts.length > 1 ? (
              <tr className="bg-neutral-900/40 font-medium">
                <td className="px-3 py-2 text-neutral-200">Combined</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{formatBDT(moneyIn)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-100">{formatBDT(worth)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${worth - moneyIn >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                  {formatBDT(worth - moneyIn)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${worth - moneyIn >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                  {pct(moneyIn > 0 ? (worth - moneyIn) / moneyIn : null)}
                </td>
                <td colSpan={2} />
                <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{formatBDT(unexplained)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-600">
        * What the named lines do not explain. Inferred, not reported by the broker — in practice
        account charges such as the annual BO maintenance fee.
      </p>

      {yearly.length > 0 ? (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-left font-medium">Year</th>
                <th className="px-3 py-2 text-right font-medium">Return</th>
                <th className="px-3 py-2 text-left font-medium">Covers</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => (
                <tr key={`${y.name}-${y.year}`} className="border-b border-neutral-900 last:border-0">
                  <td className="px-3 py-2 text-neutral-300">{y.name}</td>
                  <td className="px-3 py-2 text-neutral-300">{y.year}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${y.return >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    {pct(y.return)}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {formatTradeDate(y.from)} → {formatTradeDate(y.to)}
                    {y.complete ? null : <span className="ml-2 text-amber-500/80">partial year</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-500">
          Yearly returns need at least two snapshots per account — {fewest === 1 ? 'there is one so far' : `there are ${fewest}`}.
          They build up from each statement you import and save; import one around every month-end
          at the least, and deposits made in between are separated from growth automatically.
        </p>
      )}
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

/**
 * Net cost per share: the figure that falls with every profitable sale and
 * every dividend. Zero or below means the shares still held cost nothing.
 */
function NetCost({
  holding,
  price,
}: {
  holding: ReturnType<typeof buildPortfolio>['holdings'][number]
  price: number | null
}) {
  const net = holding.netCostPerShare
  if (net === null) return <span className="text-neutral-600">—</span>

  const avg = holding.averageCost
  const below = avg !== null && avg > 0 ? 1 - net / avg : null
  const plan = freeSharePlan(holding, price)

  return (
    <Link
      href={`/portfolio/stock/${holding.symbol}`}
      className="group block"
      title="How this moved, trade by trade"
    >
      {net <= 0 ? (
        <span className="font-medium text-emerald-400">Free</span>
      ) : (
        <span className="text-neutral-200 group-hover:text-sky-300">৳{net.toFixed(2)}</span>
      )}
      {net <= 0 ? (
        <span className="block text-xs text-emerald-500/80">
          {formatBDT(-holding.netCost)} taken out beyond cost
        </span>
      ) : below !== null && below >= 0.0005 ? (
        <span className="block text-xs text-emerald-500/80">{formatPercent(below, 1)} below avg</span>
      ) : null}
      {plan ? (
        <span className="block text-xs text-neutral-500">
          sell {plan.sell.toLocaleString()} → {plan.keep.toLocaleString()} free
        </span>
      ) : null}
    </Link>
  )
}
