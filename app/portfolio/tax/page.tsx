import Link from 'next/link'

import {
  getClosesOnOrBefore,
  listBoAccounts,
  listCashMovements,
  listLedgerImports,
  listPortfolioTransactions,
} from '@/db/queries'
import { ledgerCoverage } from '@/lib/checks'
import { incomeYear, incomeYearOf, incomeYearReport } from '@/lib/tax-year'
import { dhakaNow, formatTradeDate } from '@/lib/trading-calendar'

import { AccountFilter, PortfolioNav, ROW, Stat, TD, TH, THEAD_ROW } from '../ui'
import { PrintButton } from './PrintButton'

export const dynamic = 'force-dynamic'

const money = (v: number | null) =>
  v === null ? '—' : `৳${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function TaxYearPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const [allTransactions, allMovements, accounts, ledgers] = await Promise.all([
    listPortfolioTransactions(),
    listCashMovements(),
    listBoAccounts(),
    listLedgerImports(),
  ])

  const selected = accounts.find((a) => a.id === Number(one(params.account))) ?? null
  const transactions = selected ? allTransactions.filter((t) => t.accountId === selected.id) : allTransactions
  const movements = selected ? allMovements.filter((m) => m.accountId === selected.id) : allMovements

  // The years there is anything in, newest first. The default is the last
  // complete one — the year a return is being filed for.
  const today = dhakaNow().date
  const current = incomeYearOf(today)
  const dates = [...allTransactions.map((t) => t.tradeDate), ...allMovements.map((m) => m.date)].sort()
  const first = dates.length > 0 ? incomeYearOf(dates[0]) : current
  const years = Array.from({ length: current - first + 1 }, (_, i) => current - i)
  const requested = Number(one(params.year))
  const start = years.includes(requested) ? requested : years.includes(current - 1) ? current - 1 : current
  const year = incomeYear(start)
  const inProgress = year.to >= today
  const end = inProgress ? today : year.to

  const names = new Map(accounts.map((a) => [a.id, a.name]))
  const cashKnownFor = new Set(
    accounts
      .filter((a) => ledgerCoverage(ledgers.filter((l) => l.accountId === a.id), end).complete)
      .map((a) => a.id),
  )
  const report = incomeYearReport(start, transactions, movements, cashKnownFor, names)
  const closes = await getClosesOnOrBefore(end)
  const valueAtEnd = report.heldAtEnd.reduce((s, h) => s + h.quantity * (closes.get(h.symbol)?.close ?? 0), 0)
  const priced = report.heldAtEnd.every((h) => closes.has(h.symbol))

  const query = (y: number) => `/portfolio/tax?year=${y}${selected ? `&account=${selected.id}` : ''}`

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Income year {year.label}</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            {selected ? `${selected.name}. ` : 'All BO accounts. '}
            {formatTradeDate(year.from)} to {formatTradeDate(year.to)}
            {inProgress ? ` — in progress, figures to ${formatTradeDate(today)}` : ''}. Dividends and the
            tax already withheld, gains on sales, money in and out, and what you held at the year
            end — the share figures a return and wealth statement ask for.
          </p>
        </div>
        <PrintButton />
      </header>

      <PortfolioNav current="tax" />

      <nav className="flex flex-wrap items-center gap-2 text-xs print:hidden">
        <span className="text-neutral-600">Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={query(y)}
            className={`rounded-full border px-2.5 py-0.5 ${
              y === start ? 'border-sky-700 text-sky-300' : 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
            }`}
          >
            {incomeYear(y).label}
          </Link>
        ))}
      </nav>
      <AccountFilter
        basePath={`/portfolio/tax?year=${start}`}
        accounts={accounts}
        selectedId={selected?.id ?? null}
      />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 lg:grid-cols-4">
        <Stat label="Dividends, gross" value={money(report.dividendTotals.gross)} sub={`${report.dividends.length} payment${report.dividends.length === 1 ? '' : 's'}`} />
        <Stat label="Tax withheld at source" value={money(report.dividendTotals.tax)} sub={`${money(report.dividendTotals.net)} received`} />
        <Stat
          label="Realised gain on sales"
          value={money(report.realised)}
          sub={`${report.sales.length} sale${report.sales.length === 1 ? '' : 's'}, after commission`}
          tone={report.realised >= 0 ? 'good' : 'bad'}
        />
        <Stat label="Deposited · withdrawn" value={money(report.deposited)} sub={`${money(report.withdrawn)} withdrawn`} />
        <Stat
          label={`Shares at cost, ${inProgress ? 'today' : '30 June'}`}
          value={money(report.costAtEnd)}
          sub={`${report.heldAtEnd.length} holding${report.heldAtEnd.length === 1 ? '' : 's'}`}
        />
        <Stat
          label={`Shares at market, ${inProgress ? 'today' : '30 June'}`}
          value={report.heldAtEnd.length === 0 ? money(0) : priced ? money(valueAtEnd) : '—'}
          sub={priced ? 'last close on or before' : 'no price recorded for that date'}
        />
        <Stat
          label={`Cash in the accounts, ${inProgress ? 'today' : '30 June'}`}
          value={report.cashUnknown.length === 0 ? money(report.cashAtEnd) : '—'}
          sub={report.cashUnknown.length === 0 ? 'rebuilt from the broker ledger' : `needs a complete ledger for ${report.cashUnknown.join(', ')}`}
        />
        <Stat label="Commission and fees" value={money(report.commission + report.fees)} sub={`${money(report.commission)} commission · ${money(report.fees)} fees`} />
      </section>

      <Table
        title="Dividends"
        empty="No dividends recorded in this year."
        head={['Paid', 'Stock', 'Account', 'Record date', 'Gross', 'Tax', 'Received']}
        right={[4, 5, 6]}
        rows={report.dividends.map((d) => [
          formatTradeDate(d.date),
          d.symbol,
          d.accountName ?? '',
          d.recordDate ? formatTradeDate(d.recordDate) : '—',
          money(d.gross),
          money(d.tax),
          money(d.net),
        ])}
        total={report.dividends.length > 1 ? ['Total', '', '', '', money(report.dividendTotals.gross), money(report.dividendTotals.tax), money(report.dividendTotals.net)] : null}
      />

      <Table
        title="Sales"
        empty="No sales in this year."
        head={['Date', 'Stock', 'Account', 'Shares', 'Proceeds', 'Gain']}
        right={[3, 4, 5]}
        rows={report.sales.map((s) => [
          formatTradeDate(s.date),
          s.symbol,
          s.accountName ?? '',
          s.quantity.toLocaleString(),
          money(s.proceeds),
          money(s.gain),
        ])}
        total={report.sales.length > 1 ? ['Total', '', '', '', money(report.sales.reduce((t, s) => t + s.proceeds, 0)), money(report.realised)] : null}
      />

      <Table
        title={`Held at ${inProgress ? 'today' : '30 June'}`}
        empty="Nothing held at the year end."
        head={['Stock', 'Account', 'Shares', 'Average cost', 'At cost', 'Close', 'At market']}
        right={[2, 3, 4, 5, 6]}
        rows={report.heldAtEnd.map((h) => {
          const close = closes.get(h.symbol)
          return [
            h.symbol,
            h.accountName ?? '',
            h.quantity.toLocaleString(),
            money(h.averageCost),
            money(h.cost),
            close ? `${money(close.close)} (${formatTradeDate(close.tradeDate)})` : '—',
            close ? money(h.quantity * close.close) : '—',
          ]
        })}
        total={report.heldAtEnd.length > 1 ? ['Total', '', '', '', money(report.costAtEnd), '', priced ? money(valueAtEnd) : '—'] : null}
      />

      <p className="text-xs text-neutral-600">
        A summary of your own records, not tax advice. Realised gain is after commission on both
        sides, with each sale costed at the average cost of the shares held at the time. How
        dividends, withheld tax and gains on listed shares are treated depends on the rules for
        the year — check them, or with whoever prepares your return.
      </p>
    </div>
  )
}

function Table({
  title,
  empty,
  head,
  right,
  rows,
  total,
}: {
  title: string
  empty: string
  head: string[]
  right: number[]
  rows: string[][]
  total: string[] | null
}) {
  return (
    <section className="space-y-2 break-inside-avoid">
      <h2 className="text-sm font-medium text-neutral-300">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                {head.map((h, i) => (
                  <th key={h} className={`${TH} ${right.includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={ROW}>
                  {row.map((cell, i) => (
                    <td key={i} className={`${TD} ${right.includes(i) ? 'text-right tabular-nums text-neutral-200' : 'text-neutral-400'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
              {total ? (
                <tr className="bg-neutral-900/40 font-medium">
                  {total.map((cell, i) => (
                    <td key={i} className={`${TD} ${right.includes(i) ? 'text-right tabular-nums text-neutral-100' : 'text-neutral-300'}`}>{cell}</td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
