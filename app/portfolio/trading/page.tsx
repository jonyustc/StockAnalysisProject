import Link from 'next/link'

import { listBoAccounts, listPortfolioTransactions } from '@/db/queries'
import { tradingStats } from '@/lib/portfolio'
import { formatTradeDate } from '@/lib/trading-calendar'
import { formatBDT, formatPercent } from '@/lib/units'

import { AccountFilter, PortfolioNav, ROW, Stat, TD, TH, THEAD_ROW } from '../ui'

export const dynamic = 'force-dynamic'

const money = (v: number) => formatBDT(v, { decimals: 2 })

export default async function TradingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const accountParam = Number(Array.isArray(params.account) ? params.account[0] : params.account)

  const [transactions, accounts] = await Promise.all([listPortfolioTransactions(), listBoAccounts()])
  const selected = accounts.find((a) => a.id === accountParam) ?? null
  const scoped = selected ? transactions.filter((t) => t.accountId === selected.id) : transactions
  const stats = tradingStats(scoped)

  // Commission against what the trading made: the figure that decides
  // whether frequent buying and selling is paying for itself.
  const grossBeforeCommission = stats.realised + stats.commission
  const commissionShare = grossBeforeCommission > 0 ? stats.commission / grossBeforeCommission : null
  const averageWin = stats.wins > 0 ? stats.sales.filter((s) => s.gain > 0).reduce((s, x) => s + x.gain, 0) / stats.wins : null
  const averageLoss =
    stats.losses > 0 ? stats.sales.filter((s) => s.gain < 0).reduce((s, x) => s + x.gain, 0) / stats.losses : null

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">Trading</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {selected ? `${selected.name}. ` : 'All BO accounts. '}
          Every sale scored against the average cost at the time, with commission counted both
          ways — and what the commission itself has cost.
        </p>
      </header>

      <PortfolioNav current="trading" />
      <AccountFilter basePath="/portfolio/trading" accounts={accounts} selectedId={selected?.id ?? null} />

      {stats.sales.length === 0 ? (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
          No sales recorded yet.{' '}
          <Link href="/portfolio/import" className="text-sky-400 hover:text-sky-300">
            Import your broker&apos;s client ledger
          </Link>{' '}
          to bring in every trade you have made, with its date, price and commission.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 lg:grid-cols-4">
            <Stat
              label="Realised"
              value={money(stats.realised)}
              sub="after commission"
              tone={stats.realised >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Win rate"
              value={formatPercent(stats.winRate, 0)}
              sub={`${stats.wins} of ${stats.sales.length} sales made money`}
            />
            <Stat
              label="Commission paid"
              value={money(stats.commission)}
              sub={commissionShare !== null ? `${formatPercent(commissionShare, 0)} of what trading made` : undefined}
              tone="bad"
            />
            <Stat label="Traded" value={formatBDT(stats.turnover)} sub="bought and sold, at trade value" />
          </section>

          <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-400">
            {averageWin !== null ? <>Average winning sale <strong className="text-emerald-500">{money(averageWin)}</strong>. </> : null}
            {averageLoss !== null ? <>Average losing sale <strong className="text-red-400">{money(averageLoss)}</strong>. </> : null}
            {commissionShare !== null ? (
              <>
                Before commission, trading made {money(grossBeforeCommission)}; commission took{' '}
                {formatPercent(commissionShare, 0)} of it. At about 0.4% each way, a round trip needs
                roughly a 0.8% move just to break even.
              </>
            ) : (
              <>At about 0.4% each way, a round trip needs roughly a 0.8% move just to break even.</>
            )}
          </p>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-300">By stock</h2>
            <div className="overflow-x-auto rounded border border-neutral-800">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className={`${TH} text-left`}>Symbol</th>
                    <th className={`${TH} text-right`}>Buys</th>
                    <th className={`${TH} text-right`}>Sells</th>
                    <th className={`${TH} text-right`}>Commission</th>
                    <th className={`${TH} text-right`}>Realised</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.bySymbol.map((b) => (
                    <tr key={b.symbol} className={ROW}>
                      <td className={TD}>
                        <Link href={`/portfolio/stock/${b.symbol}`} className="font-medium text-sky-400 hover:text-sky-300">
                          {b.symbol}
                        </Link>
                      </td>
                      <td className={`${TD} text-right tabular-nums text-neutral-400`}>{b.buys}</td>
                      <td className={`${TD} text-right tabular-nums text-neutral-400`}>{b.sells}</td>
                      <td className={`${TD} text-right tabular-nums text-neutral-500`}>{money(b.commission)}</td>
                      <td className={`${TD} text-right tabular-nums ${b.realised > 0 ? 'text-emerald-500' : b.realised < 0 ? 'text-red-400' : 'text-neutral-600'}`}>
                        {b.sells === 0 ? '—' : money(b.realised)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-300">Every sale</h2>
            <div className="overflow-x-auto rounded border border-neutral-800">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className={`${TH} text-left`}>Date</th>
                    <th className={`${TH} text-left`}>Symbol</th>
                    <th className={`${TH} text-left`}>Account</th>
                    <th className={`${TH} text-right`}>Shares</th>
                    <th className={`${TH} text-right`}>Proceeds</th>
                    <th className={`${TH} text-right`}>Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sales.map((s, i) => (
                    <tr key={i} className={ROW}>
                      <td className={`${TD} text-xs text-neutral-400`}>{formatTradeDate(s.date)}</td>
                      <td className={`${TD} text-neutral-200`}>{s.symbol}</td>
                      <td className={`${TD} text-xs text-neutral-500`}>{s.accountName}</td>
                      <td className={`${TD} text-right tabular-nums text-neutral-400`}>{s.quantity.toLocaleString()}</td>
                      <td className={`${TD} text-right tabular-nums text-neutral-300`}>{money(s.proceeds)}</td>
                      <td className={`${TD} text-right tabular-nums ${s.gain >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                        {money(s.gain)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
