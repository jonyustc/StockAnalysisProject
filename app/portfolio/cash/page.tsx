import Link from 'next/link'

import {
  listAccountSnapshots,
  listBoAccounts,
  listCashMovements,
  listPortfolioTransactions,
} from '@/db/queries'
import { accountMoneyWeightedReturn, cashMovements, netContributions } from '@/lib/account-return'
import { formatTradeDate } from '@/lib/trading-calendar'
import { formatBDT, formatPercent } from '@/lib/units'

import { AccountFilter, PortfolioNav, ROW, Stat, TD, TH, THEAD_ROW } from '../ui'

export const dynamic = 'force-dynamic'

const money = (v: number) => formatBDT(v, { decimals: 2 })

const KIND_LABEL: Record<string, { label: string; className: string }> = {
  deposit: { label: 'Deposit', className: 'text-sky-400' },
  withdrawal: { label: 'Withdrawal', className: 'text-amber-400' },
  fee: { label: 'Fee', className: 'text-red-400' },
  dividend: { label: 'Dividend', className: 'text-emerald-500' },
  ipo: { label: 'IPO', className: 'text-violet-400' },
  other: { label: 'Other', className: 'text-neutral-400' },
}

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const accountParam = Number(Array.isArray(params.account) ? params.account[0] : params.account)

  const [snapshots, accounts, transactions, allMovements] = await Promise.all([
    listAccountSnapshots(),
    listBoAccounts(),
    listPortfolioTransactions(),
    listCashMovements(),
  ])

  const selected = accounts.find((a) => a.id === accountParam) ?? null
  const inScope = (id: number) => !selected || id === selected.id
  const scoped = snapshots.filter((s) => inScope(s.accountId))
  const movements = allMovements.filter((m) => inScope(m.accountId))
  const trades = transactions.filter((t) => inScope(t.accountId))

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
    const own = movements.filter((m) => m.accountId === s.accountId)
    return {
      accountId: s.accountId,
      name: s.accountName,
      asOf: s.asOf,
      cash: s.cashBalance,
      worth: s.marketValue + s.cashBalance,
      deposited: s.deposit + s.shareTransferIn,
      withdrawn: s.withdraw + s.shareTransferOut,
      netInvested: netContributions(s),
      dividends: s.cashDividend,
      ipoPending: Math.max(0, s.ipoPayment - s.ipoRefund),
      laterTrades,
      mwr: accountMoneyWeightedReturn(own, s.marketValue + s.cashBalance, s.asOf),
      dated: own.length > 0,
    }
  })

  const total = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((sum, r) => sum + pick(r), 0)

  // What investing has cost: brokerage on every trade, account fees, and the
  // tax withheld from dividends.
  const commission = trades.reduce((s, t) => s + t.commission, 0)
  const fees = -movements.filter((m) => m.kind === 'fee').reduce((s, m) => s + m.amount, 0)
  const dividendTax = trades.filter((t) => t.txnType === 'dividend').reduce((s, t) => s + t.taxWithheld, 0)

  // Accounts with no ledger imported fall back to what moved between statements.
  const undated = [...series.values()]
    .filter((list) => !movements.some((m) => m.accountId === list[0].accountId))
    .flatMap((list) => cashMovements(list).map((m) => ({ ...m, name: list[0].accountName })))
    .sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Cash &amp; withdrawals</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {selected ? `${selected.name}. ` : 'All BO accounts. '}
            Cash in the account, what you have put in and taken out, and what investing has cost.
          </p>
        </div>
        <Link
          href="/portfolio/import"
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Import statement or ledger
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
            <Stat label="Net invested" value={money(total((r) => r.netInvested))} sub="deposited less withdrawn" />
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
                  <th className={`${TH} text-right`}>Worth now</th>
                  <th className={`${TH} text-right`} title="Money-weighted, from the real date of every deposit and withdrawal">
                    Annual return
                  </th>
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
                    <td className={`${TD} text-right tabular-nums text-neutral-200`}>{money(r.worth)}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {r.mwr.rate !== null ? (
                        <span className={r.mwr.rate >= 0 ? 'text-emerald-500' : 'text-red-400'}>
                          {formatPercent(r.mwr.rate, 1, true)}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-600">
                          {r.dated && r.mwr.firstDate
                            ? `from ${formatTradeDate(addYear(r.mwr.firstDate))}`
                            : 'import the ledger'}
                        </span>
                      )}
                    </td>
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
            <h2 className="text-sm font-medium text-neutral-300">What investing has cost</h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 lg:grid-cols-4">
              <Stat label="Brokerage commission" value={money(commission)} sub="on every buy and sell" />
              <Stat label="Account fees" value={money(fees)} sub="BO opening, maintenance, CDBL" />
              <Stat label="Tax on dividends" value={money(dividendTax)} sub="withheld at source" />
              <Stat label="Total" value={money(commission + fees + dividendTax)} tone="bad" />
            </div>
            <p className="text-xs text-neutral-600">
              Commission and tax come from the transaction ledger, fees from imported broker ledgers.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-300">Money in and out</h2>
            {movements.length > 0 ? (
              <div className="overflow-x-auto rounded border border-neutral-800">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={`${TH} text-left`}>Date</th>
                      <th className={`${TH} text-left`}>Type</th>
                      <th className={`${TH} text-left`}>Account</th>
                      <th className={`${TH} text-left`}>Details</th>
                      <th className={`${TH} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...movements].reverse().map((m) => {
                      const kind = KIND_LABEL[m.kind] ?? KIND_LABEL.other
                      return (
                        <tr key={m.id} className={ROW}>
                          <td className={`${TD} text-xs text-neutral-400`}>{formatTradeDate(m.date)}</td>
                          <td className={`${TD} text-xs ${kind.className}`}>{kind.label}</td>
                          <td className={`${TD} text-xs text-neutral-500`}>{m.accountName}</td>
                          <td className={`${TD} text-xs text-neutral-500`}>{m.description}</td>
                          <td className={`${TD} text-right tabular-nums ${m.amount >= 0 ? 'text-neutral-200' : 'text-red-400'}`}>
                            {money(m.amount)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {undated.length > 0 ? (
              <div className="overflow-x-auto rounded border border-neutral-800">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={`${TH} text-left`}>Between statements</th>
                      <th className={`${TH} text-left`}>Account</th>
                      <th className={`${TH} text-right`}>Deposited</th>
                      <th className={`${TH} text-right`}>Withdrawn</th>
                      <th className={`${TH} text-right`}>Dividends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {undated.map((m) => (
                      <tr key={`${m.name}-${m.to}`} className={ROW}>
                        <td className={`${TD} text-xs text-neutral-400`}>
                          {formatTradeDate(m.from)} → {formatTradeDate(m.to)}
                        </td>
                        <td className={`${TD} text-xs text-neutral-500`}>{m.name}</td>
                        <td className={`${TD} text-right tabular-nums text-sky-400`}>{m.deposited ? money(m.deposited) : '—'}</td>
                        <td className={`${TD} text-right tabular-nums text-amber-400`}>{m.withdrawn ? money(m.withdrawn) : '—'}</td>
                        <td className={`${TD} text-right tabular-nums text-emerald-500`}>{m.dividends ? money(m.dividends) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {movements.length === 0 && undated.length === 0 ? (
              <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-500">
                Nothing yet. Import the broker&apos;s client ledger to see every deposit, withdrawal and
                fee with its date — or keep importing daily statements, and whatever moved between
                two of them appears here.
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}

function addYear(date: string): string {
  return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`
}
