import Link from 'next/link'

import { listAccountSnapshots, listBoAccounts, listPortfolioTransactions } from '@/db/queries'
import { cashMovements, netContributions } from '@/lib/account-return'
import { formatTradeDate } from '@/lib/trading-calendar'
import { formatBDT } from '@/lib/units'

import { AccountFilter, PortfolioNav, ROW, Stat, TD, TH, THEAD_ROW } from '../ui'

export const dynamic = 'force-dynamic'

const money = (v: number) => formatBDT(v, { decimals: 2 })

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const accountParam = Number(Array.isArray(params.account) ? params.account[0] : params.account)

  const [snapshots, accounts, transactions] = await Promise.all([
    listAccountSnapshots(),
    listBoAccounts(),
    listPortfolioTransactions(),
  ])

  const selected = accounts.find((a) => a.id === accountParam) ?? null
  const scoped = selected ? snapshots.filter((s) => s.accountId === selected.id) : snapshots

  const series = new Map<number, typeof scoped>()
  for (const s of scoped) {
    if (!series.has(s.accountId)) series.set(s.accountId, [])
    series.get(s.accountId)!.push(s)
  }

  const rows = [...series.values()].map((list) => {
    const s = list[list.length - 1]
    // Trades recorded after the statement move cash the statement cannot show.
    const laterTrades = transactions.filter(
      (t) => t.accountId === s.accountId && t.tradeDate > s.asOf && t.txnType !== 'bonus',
    ).length
    return {
      accountId: s.accountId,
      name: s.accountName,
      asOf: s.asOf,
      cash: s.cashBalance,
      deposited: s.deposit + s.shareTransferIn,
      withdrawn: s.withdraw + s.shareTransferOut,
      netInvested: netContributions(s),
      dividends: s.cashDividend,
      ipoPending: Math.max(0, s.ipoPayment - s.ipoRefund),
      laterTrades,
    }
  })

  const total = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((sum, r) => sum + pick(r), 0)

  const movements = [...series.values()]
    .flatMap((list) => cashMovements(list).map((m) => ({ ...m, name: list[0].accountName })))
    .sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Cash &amp; withdrawals</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {selected ? `${selected.name}. ` : 'All BO accounts. '}
            Cash in the account, what you have put in and taken out — from the broker&apos;s own
            totals on each imported statement.
          </p>
        </div>
        <Link
          href="/portfolio/import"
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Import statement
        </Link>
      </header>

      <PortfolioNav current="cash" />
      <AccountFilter basePath="/portfolio/cash" accounts={accounts} selectedId={selected?.id ?? null} />

      {rows.length === 0 ? (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
          No statements imported yet.{' '}
          <Link href="/portfolio/import" className="text-sky-400 hover:text-sky-300">
            Import one
          </Link>{' '}
          — its account section carries the cash balance and every deposit and withdrawal to date.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 lg:grid-cols-4">
            <Stat label="Cash available" value={money(total((r) => r.cash))} sub="ready to buy with" />
            <Stat label="Deposited" value={money(total((r) => r.deposited))} sub="lifetime" />
            <Stat label="Withdrawn" value={money(total((r) => r.withdrawn))} sub="lifetime" />
            <Stat
              label="Net invested"
              value={money(total((r) => r.netInvested))}
              sub="deposited less withdrawn"
            />
          </section>

          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={`${TH} text-left`}>Account</th>
                  <th className={`${TH} text-left`}>As of</th>
                  <th className={`${TH} text-right`}>Cash</th>
                  <th className={`${TH} text-right`}>Deposited</th>
                  <th className={`${TH} text-right`}>Withdrawn</th>
                  <th className={`${TH} text-right`}>Net invested</th>
                  <th className={`${TH} text-right`}>Dividends credited</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.accountId} className={ROW}>
                    <td className={`${TD} text-neutral-300`}>{r.name}</td>
                    <td className={`${TD} text-xs text-neutral-500`}>
                      {formatTradeDate(r.asOf)}
                      {r.laterTrades > 0 ? (
                        <span className="block text-amber-500/80">
                          {r.laterTrades} trade{r.laterTrades === 1 ? '' : 's'} since — cash has moved
                        </span>
                      ) : null}
                    </td>
                    <td className={`${TD} text-right tabular-nums font-medium text-neutral-100`}>{money(r.cash)}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-400`}>{money(r.deposited)}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-400`}>{money(r.withdrawn)}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-300`}>{money(r.netInvested)}</td>
                    <td className={`${TD} text-right tabular-nums text-emerald-500`}>{money(r.dividends)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.some((r) => r.ipoPending > 0) ? (
            <p className="text-xs text-neutral-500">
              IPO applications pending refund:{' '}
              {rows.filter((r) => r.ipoPending > 0).map((r) => `${r.name} ${money(r.ipoPending)}`).join('; ')}.
            </p>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-300">Money in and out</h2>
            {movements.length === 0 ? (
              <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-500">
                Nothing yet. Each import is compared with the one before, and any deposit,
                withdrawal or dividend in between appears here — import daily and each row is a
                day.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-neutral-800">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={`${TH} text-left`}>Between</th>
                      <th className={`${TH} text-left`}>Account</th>
                      <th className={`${TH} text-right`}>Deposited</th>
                      <th className={`${TH} text-right`}>Withdrawn</th>
                      <th className={`${TH} text-right`}>Dividends</th>
                      <th className={`${TH} text-right`}>Other</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => {
                      const other = m.transferredIn - m.transferredOut + m.ipoNet
                      return (
                        <tr key={`${m.name}-${m.to}`} className={ROW}>
                          <td className={`${TD} text-xs text-neutral-400`}>
                            {formatTradeDate(m.from)} → {formatTradeDate(m.to)}
                          </td>
                          <td className={`${TD} text-xs text-neutral-500`}>{m.name}</td>
                          <td className={`${TD} text-right tabular-nums text-sky-400`}>{m.deposited ? money(m.deposited) : '—'}</td>
                          <td className={`${TD} text-right tabular-nums text-amber-400`}>{m.withdrawn ? money(m.withdrawn) : '—'}</td>
                          <td className={`${TD} text-right tabular-nums text-emerald-500`}>{m.dividends ? money(m.dividends) : '—'}</td>
                          <td
                            className={`${TD} text-right tabular-nums text-neutral-400`}
                            title="Share transfers and IPO money: applications out, refunds back"
                          >
                            {Math.abs(other) >= 0.005 ? money(other) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
