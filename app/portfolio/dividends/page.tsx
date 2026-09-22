import Link from 'next/link'

import {
  getLatestQuotes,
  listAccountSnapshots,
  listBoAccounts,
  listPortfolioTransactions,
} from '@/db/queries'
import { alreadyRecorded, incomeByYear, projectIncome } from '@/lib/dividends'
import { buildPortfolio } from '@/lib/portfolio'
import { dhakaNow, formatTradeDate } from '@/lib/trading-calendar'
import { formatBDT, formatPercent } from '@/lib/units'

import { latestDividendPerShare } from '../dividend-data'
import { AccountFilter, PortfolioNav, ROW, Stat, TD, TH, THEAD_ROW } from '../ui'
import { RecordDividendForm } from './RecordDividendForm'

export const dynamic = 'force-dynamic'

export default async function DividendsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const accountParam = Number(Array.isArray(params.account) ? params.account[0] : params.account)

  const [transactions, accounts, snapshots, quotes, dps] = await Promise.all([
    listPortfolioTransactions(),
    listBoAccounts(),
    listAccountSnapshots(),
    getLatestQuotes(),
    latestDividendPerShare(),
  ])

  const selected = accounts.find((a) => a.id === accountParam) ?? null
  const scoped = selected ? transactions.filter((t) => t.accountId === selected.id) : transactions
  const prices = new Map([...quotes].map(([symbol, q]) => [symbol, q.close]))
  const portfolio = buildPortfolio(transactions, prices, new Date(), selected?.id)

  const today = dhakaNow().date
  const thisYear = Number(today.slice(0, 4))
  const years = incomeByYear(scoped)
  const received = scoped.filter((t) => t.txnType === 'dividend')
  const projection = projectIncome(portfolio.holdings, dps)

  // Each account's latest statement: its lifetime dividend total and the
  // dividends it lists as declared but unpaid.
  const latestByAccount = new Map<number, (typeof snapshots)[number]>()
  for (const s of snapshots) {
    if (selected && s.accountId !== selected.id) continue
    latestByAccount.set(s.accountId, s) // oldest first, so the last one wins
  }
  const latest = [...latestByAccount.values()]
  const brokerLifetime = latest.reduce((sum, s) => sum + s.cashDividend, 0)

  const pending = latest.flatMap((s) =>
    s.dividendsReceivable.map((r) => ({
      ...r,
      accountId: s.accountId,
      accountName: s.accountName,
      asOf: s.asOf,
      recorded:
        r.symbol !== null && alreadyRecorded(transactions, s.accountId, r.symbol, r.entitlement, r.recordDate),
    })),
  )
  const awaiting = pending.filter((p) => !p.recorded)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Dividends</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {selected ? `${selected.name}. ` : 'All BO accounts. '}
            What has been paid, what is declared and on its way, and what your holdings would pay
            in a year at their last dividend.
          </p>
        </div>
        <Link
          href="/portfolio/transactions"
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
        >
          Record a dividend
        </Link>
      </header>

      <PortfolioNav current="dividends" />
      <AccountFilter basePath="/portfolio/dividends" accounts={accounts} selectedId={selected?.id ?? null} />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 lg:grid-cols-5">
        <Stat
          label="Received, recorded"
          value={formatBDT(portfolio.totalDividendsNet)}
          sub={`${formatBDT(portfolio.totalDividendsGross)} gross · ${received.length} payment${received.length === 1 ? '' : 's'}`}
        />
        <Stat
          label={`Received in ${thisYear}`}
          value={formatBDT(years.find((y) => y.year === thisYear)?.net ?? 0)}
          sub="after tax"
        />
        <Stat
          label="Lifetime, per broker"
          value={latest.length > 0 ? formatBDT(brokerLifetime) : '—'}
          sub={latest.length > 0 ? 'includes before this ledger began' : 'import a statement'}
        />
        <Stat
          label="Declared, awaiting"
          value={formatBDT(awaiting.reduce((sum, p) => sum + p.entitlement, 0))}
          sub={`${awaiting.length} dividend${awaiting.length === 1 ? '' : 's'} · gross`}
        />
        <Stat
          label="Projected a year"
          value={formatBDT(projection.annualIncome)}
          sub={`${formatPercent(projection.yieldOnValue, 2)} on value · ${formatPercent(projection.yieldOnCost, 2)} on cost`}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-300">Declared, not yet paid</h2>
        {pending.length === 0 ? (
          <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-500">
            {latest.length === 0
              ? 'Nothing known yet — declared dividends come from the "receivable" list on broker statements. Import one.'
              : 'None on the latest statement.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={`${TH} text-left`}>Company</th>
                  <th className={`${TH} text-left`}>Account</th>
                  <th className={`${TH} text-right`}>Shares</th>
                  <th className={`${TH} text-right`}>Per share</th>
                  <th className={`${TH} text-right`}>Gross due</th>
                  <th className={`${TH} text-left`}>Record date</th>
                  <th className={`${TH} text-left`}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={`${p.accountId}-${p.companyName}-${p.recordDate}`} className={ROW}>
                    <td className={TD}>
                      {p.symbol ? (
                        <Link href={`/companies/${p.symbol}`} className="font-medium text-sky-400 hover:text-sky-300">
                          {p.symbol}
                        </Link>
                      ) : (
                        <span className="text-neutral-300">{p.companyName}</span>
                      )}
                    </td>
                    <td className={`${TD} text-xs text-neutral-400`}>{p.accountName}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-300`}>{p.holding.toLocaleString()}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-300`}>৳{p.rate.toFixed(2)}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-100`}>{formatBDT(p.entitlement, { decimals: 2 })}</td>
                    <td className={`${TD} text-xs text-neutral-400`}>
                      {p.recordDate ? formatTradeDate(p.recordDate) : '—'}
                    </td>
                    <td className={TD}>
                      {p.recorded ? (
                        <span className="text-xs text-emerald-500">Received and recorded</span>
                      ) : p.symbol ? (
                        <RecordDividendForm
                          accountId={p.accountId}
                          symbol={p.symbol}
                          gross={p.entitlement}
                          recordDate={p.recordDate}
                          today={today}
                        />
                      ) : (
                        <span className="text-xs text-amber-400/80">Not a tracked company</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-neutral-600">
          From each account&apos;s latest statement. Once paid, either mark it received here or just
          import the next statement — it spots the payment and offers to record it, never twice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-300">Projected income</h2>
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={`${TH} text-left`}>Symbol</th>
                <th className={`${TH} text-right`}>Shares</th>
                <th className={`${TH} text-right`}>Last dividend / share</th>
                <th className={`${TH} text-right`}>A year, gross</th>
                <th className={`${TH} text-right`}>Yield on value</th>
                <th className={`${TH} text-right`}>Yield on cost</th>
              </tr>
            </thead>
            <tbody>
              {projection.rows.map((r) => (
                <tr key={r.symbol} className={ROW}>
                  <td className={TD}>
                    <Link href={`/companies/${r.symbol}`} className="font-medium text-sky-400 hover:text-sky-300">
                      {r.symbol}
                    </Link>
                  </td>
                  <td className={`${TD} text-right tabular-nums text-neutral-300`}>{r.quantity.toLocaleString()}</td>
                  <td className={`${TD} text-right tabular-nums text-neutral-300`}>
                    {r.dividendPerShare === null ? '—' : `৳${r.dividendPerShare.toFixed(2)}`}
                    {r.fiscalYear ? <span className="ml-1 text-xs text-neutral-600">FY{r.fiscalYear}</span> : null}
                  </td>
                  <td className={`${TD} text-right tabular-nums text-neutral-100`}>
                    {r.annualIncome === null ? '—' : formatBDT(r.annualIncome, { decimals: 2 })}
                  </td>
                  <td className={`${TD} text-right tabular-nums text-neutral-400`}>{formatPercent(r.yieldOnValue, 2)}</td>
                  <td className={`${TD} text-right tabular-nums text-neutral-400`}>{formatPercent(r.yieldOnCost, 2)}</td>
                </tr>
              ))}
              {projection.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className={`${TD} text-xs text-neutral-500`}>No open positions.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-600">
          If each company repeats its last reported full-year dividend, restated for any bonus or
          rights issue since. A projection, not a promise — before tax, which is usually 10%.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-300">By year</h2>
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={`${TH} text-left`}>Year</th>
                  <th className={`${TH} text-right`}>Gross</th>
                  <th className={`${TH} text-right`}>Tax</th>
                  <th className={`${TH} text-right`}>Received</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.year} className={ROW}>
                    <td className={`${TD} text-neutral-300`}>{y.year}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-400`}>{formatBDT(y.gross, { decimals: 2 })}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-500`}>{formatBDT(y.tax, { decimals: 2 })}</td>
                    <td className={`${TD} text-right tabular-nums text-emerald-500`}>{formatBDT(y.net, { decimals: 2 })}</td>
                  </tr>
                ))}
                {years.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={`${TD} text-xs text-neutral-500`}>None recorded yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-300">Payments</h2>
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={`${TH} text-left`}>Date</th>
                  <th className={`${TH} text-left`}>Symbol</th>
                  <th className={`${TH} text-left`}>Account</th>
                  <th className={`${TH} text-right`}>Gross</th>
                  <th className={`${TH} text-right`}>Tax</th>
                  <th className={`${TH} text-right`}>Received</th>
                </tr>
              </thead>
              <tbody>
                {received.map((t) => (
                  <tr key={t.id} className={ROW}>
                    <td className={`${TD} text-xs text-neutral-400`}>{formatTradeDate(t.tradeDate)}</td>
                    <td className={TD}>
                      <Link href={`/companies/${t.symbol}`} className="text-sky-400 hover:text-sky-300">
                        {t.symbol}
                      </Link>
                    </td>
                    <td className={`${TD} text-xs text-neutral-500`}>{t.accountName}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-400`}>{formatBDT(t.grossAmount, { decimals: 2 })}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-500`}>{formatBDT(t.taxWithheld, { decimals: 2 })}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-200`}>
                      {formatBDT((t.grossAmount ?? 0) - t.taxWithheld, { decimals: 2 })}
                    </td>
                  </tr>
                ))}
                {received.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={`${TD} text-xs text-neutral-500`}>
                      None recorded yet. The broker&apos;s lifetime total above includes dividends from
                      before this ledger began, which is why it can be higher.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
