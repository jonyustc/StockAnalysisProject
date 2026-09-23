import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SeriesChart } from '@/app/components/charts/SeriesChart'
import { PriceInsight } from '@/app/components/PriceInsight'
import { getLatestQuotes, listBoAccounts, listPortfolioTransactions } from '@/db/queries'
import { buildPortfolio, costTimeline, freeSharePlan } from '@/lib/portfolio'
import { commissionRate } from '@/lib/targets'
import { formatTradeDate } from '@/lib/trading-calendar'
import { formatBDT, formatPercent } from '@/lib/units'

import { stockInsight } from '../../insight-data'
import { AccountFilter, ROW, Stat, TD, TH, THEAD_ROW } from '../../ui'
import { TradePlanner } from './TradePlanner'

export const dynamic = 'force-dynamic'

const TYPE_STYLE: Record<string, string> = {
  buy: 'text-sky-400',
  sell: 'text-amber-400',
  bonus: 'text-emerald-500',
  rights: 'text-violet-400',
  dividend: 'text-neutral-400',
}

const perShare = (v: number | null) => (v === null ? '—' : `৳${v.toFixed(2)}`)

export default async function StockCostPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { symbol: raw } = await params
  const symbol = raw.toUpperCase()
  const query = await searchParams
  const accountParam = Number(Array.isArray(query.account) ? query.account[0] : query.account)

  const [all, quotes, accounts, insight] = await Promise.all([
    listPortfolioTransactions(),
    getLatestQuotes(),
    listBoAccounts(),
    stockInsight(raw),
  ])
  const ofStock = all.filter((t) => t.symbol === symbol)
  if (ofStock.length === 0) notFound()

  // Only the accounts that have traded this stock are worth offering.
  const traded = accounts.filter((a) => ofStock.some((t) => t.accountId === a.id))
  const selected = traded.find((a) => a.id === accountParam) ?? null
  const transactions = selected ? ofStock.filter((t) => t.accountId === selected.id) : ofStock

  const price = quotes.get(symbol)?.close ?? null
  const holding = buildPortfolio(transactions, new Map(price === null ? [] : [[symbol, price]])).holdings[0]
  const steps = costTimeline(transactions)
  // A sale comes out of one account, so only plan one against one account.
  const oneAccount = selected !== null || traded.length === 1
  const plan = oneAccount ? freeSharePlan(holding, price) : null
  const net = holding.netCostPerShare

  return (
    <div className="space-y-6">
      <header>
        <Link href="/portfolio" className="text-xs text-neutral-500 hover:text-neutral-300">
          ← Portfolio
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-100">
          {symbol} <span className="text-sm font-normal text-neutral-500">cost history</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          {selected ? `${selected.name}. ` : traded.length > 1 ? 'All accounts combined. ' : ''}
          <strong className="font-medium text-neutral-300">Average cost</strong> is what the shares
          you hold cost — a profitable sale does not move it.{' '}
          <strong className="font-medium text-neutral-300">Net cost</strong> is everything you have
          paid in, less everything this stock has paid back (sales and dividends), over the shares
          still held. It falls with every profitable round trip; at zero, what you hold is free.
        </p>
      </header>

      <AccountFilter
        basePath={`/portfolio/stock/${symbol}`}
        accounts={traded}
        selectedId={selected?.id ?? null}
      />
      {selected === null && traded.length > 1 && holding.quantity > 0 ? (
        <p className="text-xs text-neutral-500">
          Shares can only be sold from the account that holds them — pick one to plan a trade
          against that account&apos;s own cost.
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 lg:grid-cols-5">
        <Stat label="Held" value={holding.quantity.toLocaleString()} sub={holding.accountCount > 1 ? `${holding.accountCount} accounts` : undefined} />
        <Stat label="Average cost" value={perShare(holding.averageCost)} />
        <Stat
          label="Net cost / share"
          value={net === null ? '—' : net <= 0 ? 'Free' : perShare(net)}
          sub={
            holding.averageCost && net !== null && net > 0 && 1 - net / holding.averageCost >= 0.0005
              ? `${formatPercent(1 - net / holding.averageCost, 1)} below average`
              : net !== null && net <= 0
                ? `${formatBDT(-holding.netCost)} out beyond cost`
                : undefined
          }
          tone={net !== null && holding.averageCost !== null && net < holding.averageCost ? 'good' : undefined}
        />
        <Stat
          label="Paid back so far"
          value={formatBDT(holding.returned)}
          sub={holding.invested > 0 ? `${formatPercent(holding.returned / holding.invested, 1)} of ${formatBDT(holding.invested)} paid in` : undefined}
        />
        <Stat label="Price" value={perShare(price)} sub={plan ? `sell ${plan.sell} → ${plan.keep} free` : undefined} />
      </section>

      {plan ? (
        <p className="rounded border border-emerald-900/60 bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-200/80">
          At today&apos;s ৳{price!.toFixed(2)}, selling <strong>{plan.sell.toLocaleString()}</strong> shares
          (after about 0.5% commission) takes out every taka you have put in — the other{' '}
          <strong>{plan.keep.toLocaleString()}</strong> would then have cost you nothing.
        </p>
      ) : null}

      {insight ? (
        <PriceInsight
          insight={insight}
          holding={{
            quantity: holding.quantity,
            averageCost: holding.averageCost,
            netCostPerShare: holding.netCostPerShare,
            commissionRate: commissionRate(selected ? transactions : all),
            accountId: selected?.id ?? null,
          }}
        />
      ) : null}

      {steps.length > 1 ? (
        <SeriesChart
          title="Average cost and net cost per share"
          caption="After each event. The gap between the lines is what sales and dividends have already paid back."
          kind="line"
          format="per_share"
          categories={steps.map((s) => formatTradeDate(s.date))}
          series={[
            { key: 'avg', label: 'Average cost', values: steps.map((s) => s.averageCost) },
            { key: 'net', label: 'Net cost', values: steps.map((s) => s.netCostPerShare) },
          ]}
        />
      ) : null}

      {holding.quantity > 0 && oneAccount ? (
        <TradePlanner
          quantity={holding.quantity}
          costBasis={holding.costBasis}
          netCost={holding.netCost}
          price={price}
        />
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-300">Every event</h2>
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={`${TH} text-left`}>Date</th>
                <th className={`${TH} text-left`}>Event</th>
                <th className={`${TH} text-left`}>Account</th>
                <th className={`${TH} text-right`}>Shares</th>
                <th className={`${TH} text-right`}>Price</th>
                <th className={`${TH} text-right`}>Cash</th>
                <th className={`${TH} text-right`}>Held after</th>
                <th className={`${TH} text-right`}>Avg cost</th>
                <th className={`${TH} text-right`}>Net cost</th>
              </tr>
            </thead>
            <tbody>
              {[...steps].reverse().map((s, i) => (
                <tr key={i} className={ROW}>
                  <td className={`${TD} text-xs text-neutral-400`}>{formatTradeDate(s.date)}</td>
                  <td className={`${TD} text-xs ${TYPE_STYLE[s.txnType]}`}>{s.txnType}</td>
                  <td className={`${TD} text-xs text-neutral-500`}>{s.accountName}</td>
                  <td className={`${TD} text-right tabular-nums text-neutral-300`}>{s.quantity?.toLocaleString() ?? '—'}</td>
                  <td className={`${TD} text-right tabular-nums text-neutral-400`}>{s.txnType === 'dividend' || s.txnType === 'bonus' ? '—' : perShare(s.price)}</td>
                  <td className={`${TD} text-right tabular-nums ${s.cash >= 0 ? 'text-emerald-500' : 'text-neutral-400'}`}>
                    {s.cash === 0 ? '—' : formatBDT(s.cash, { decimals: 2 })}
                  </td>
                  <td className={`${TD} text-right tabular-nums text-neutral-300`}>{s.held.toLocaleString()}</td>
                  <td className={`${TD} text-right tabular-nums text-neutral-300`}>{perShare(s.averageCost)}</td>
                  <td className={`${TD} text-right tabular-nums text-neutral-100`}>
                    {s.netCostPerShare !== null && s.netCostPerShare <= 0 ? (
                      <span className="text-emerald-400">Free</span>
                    ) : (
                      perShare(s.netCostPerShare)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-600">
          A position opened from a broker statement starts at the broker&apos;s cost, so profits
          taken before that date are not in the net cost. Record older sales on the transactions
          page to include them.
        </p>
      </section>
    </div>
  )
}
