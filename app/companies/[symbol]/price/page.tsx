import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PriceChart, type PriceLine } from '@/app/components/charts/PriceChart'
import { PriceInsight } from '@/app/components/PriceInsight'
import { stockInsight } from '@/app/portfolio/insight-data'
import { ROW, TD, TH, THEAD_ROW } from '@/app/portfolio/ui'
import { getCompanyBySymbol, listPriceHistory, listPriceTargets, listPortfolioTransactions } from '@/db/queries'
import { buildPortfolio } from '@/lib/portfolio'
import { priceStats, scenarios } from '@/lib/price-stats'
import { breakEvenPrice, commissionRate } from '@/lib/targets'
import { formatTradeDate } from '@/lib/trading-calendar'
import { formatBDT, formatPercent } from '@/lib/units'

export const dynamic = 'force-dynamic'

const taka = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `৳${v.toFixed(2)}`)

export default async function PriceHistoryPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await params
  const symbol = raw.toUpperCase()

  const [company, history, insight, transactions, targets] = await Promise.all([
    getCompanyBySymbol(symbol),
    listPriceHistory(symbol),
    stockInsight(symbol),
    listPortfolioTransactions(),
    listPriceTargets(),
  ])
  if (!company) notFound()

  const price = insight?.price ?? history.at(-1)?.close ?? null
  const stats = priceStats(history)

  const own = transactions.filter((t) => t.symbol === symbol)
  const holding = own.length > 0 ? buildPortfolio(own, new Map(price === null ? [] : [[symbol, price]])).holdings[0] : null
  const rate = commissionRate(transactions)
  const target = targets.find((t) => t.symbol === symbol) ?? null

  // Every line is a fact or a level someone chose — never a projection.
  const lines: PriceLine[] = []
  if (holding && holding.quantity > 0 && holding.averageCost !== null) {
    lines.push({ label: 'your average cost', value: holding.averageCost, colour: '#f87171' })
    if (holding.netCostPerShare !== null && holding.netCostPerShare > 0 && holding.netCostPerShare !== holding.averageCost) {
      lines.push({ label: 'your net cost', value: holding.netCostPerShare, colour: '#34d399' })
    }
  }
  if (target?.buyBelow) lines.push({ label: 'buy target', value: target.buyBelow, colour: '#38bdf8' })
  if (target?.sellAbove) lines.push({ label: 'sell target', value: target.sellAbove, colour: '#fbbf24' })

  const band = insight?.band ?? null
  const rows =
    price === null
      ? []
      : scenarios({
          price,
          quantity: holding?.quantity ?? 0,
          costBasis: holding?.costBasis ?? 0,
          levels: [
            { label: '52-week low', basis: 'where it has been', price: insight?.ownYear?.low ?? insight?.yearLow ?? null },
            { label: '52-week high', basis: 'where it has been', price: insight?.ownYear?.high ?? insight?.yearHigh ?? null },
            { label: 'Cheap end of its P/E range', basis: `${band ? band.low.toFixed(1) : '—'}× its earnings`, price: band?.priceAtLow ?? null },
            { label: 'Middle of its P/E range', basis: `${band ? band.median.toFixed(1) : '—'}× its earnings`, price: band?.priceAtMedian ?? null },
            { label: 'Dear end of its P/E range', basis: `${band ? band.high.toFixed(1) : '—'}× its earnings`, price: band?.priceAtHigh ?? null },
            {
              label: 'Your break-even',
              basis: 'cost back after commission',
              price: holding && holding.quantity > 0 && holding.averageCost ? breakEvenPrice(holding.averageCost, rate) : null,
            },
            { label: 'Your buy target', basis: 'you set it', price: target?.buyBelow ?? null },
            { label: 'Your sell target', basis: 'you set it', price: target?.sellAbove ?? null },
          ],
        })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/companies/${symbol}`} className="text-xs text-neutral-500 hover:text-neutral-300">
            ← {company.shortName ?? company.name}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-100">
            {symbol} <span className="text-sm font-normal text-neutral-500">price history</span>
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            {history.length > 0
              ? `${history.length.toLocaleString()} trading days, ${formatTradeDate(history[0].date)} to ${formatTradeDate(history[history.length - 1].date)}.`
              : 'No price history stored yet.'}{' '}
            Day-end closes from DSE, with the averages the price is usually read against.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/portfolio/import"
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
          >
            Fetch more history
          </Link>
          {holding && holding.quantity > 0 ? (
            <Link
              href={`/portfolio/stock/${symbol}`}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
            >
              Your cost history
            </Link>
          ) : null}
        </div>
      </header>

      <PriceChart
        history={history}
        lines={lines}
        caption="Closing prices as they happened, and the 50- and 200-day averages of them. The dashed lines are your own cost and targets — none of these lines says anything about where the price goes next."
      />

      {/* What the price has done ------------------------------------------ */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 lg:grid-cols-4">
        <Stat label="A month" value={formatPercent(stats.changeMonth, 1, true)} tone={stats.changeMonth} />
        <Stat label="Three months" value={formatPercent(stats.changeQuarter, 1, true)} tone={stats.changeQuarter} />
        <Stat label="A year" value={formatPercent(stats.changeYear, 1, true)} tone={stats.changeYear} />
        <Stat
          label="Typical daily move"
          value={formatPercent(stats.typicalDailyMove, 2)}
          sub={stats.volatility !== null ? `${formatPercent(stats.volatility, 0)} a year, annualised` : undefined}
        />
        <Stat
          label="50-day average"
          value={taka(stats.ma50)}
          sub={stats.aboveMa50 !== null ? `price is ${formatPercent(stats.aboveMa50, 1, true)} against it` : 'needs 50 days'}
        />
        <Stat
          label="200-day average"
          value={taka(stats.ma200)}
          sub={stats.aboveMa200 !== null ? `price is ${formatPercent(stats.aboveMa200, 1, true)} against it` : 'needs 200 days'}
        />
        <Stat
          label="Worst fall from a peak"
          value={formatPercent(insight?.fall?.worst ?? null, 0)}
          sub={insight?.fall?.peakDate ? `${formatTradeDate(insight.fall.peakDate)} onwards` : undefined}
        />
        <Stat
          label="Now, against its peak"
          value={formatPercent(insight?.fall?.fromPeak ?? null, 1)}
          sub="below its highest close"
        />
      </section>

      {insight ? (
        <PriceInsight
          insight={insight}
          holding={
            holding && holding.quantity > 0
              ? {
                  quantity: holding.quantity,
                  averageCost: holding.averageCost,
                  netCostPerShare: holding.netCostPerShare,
                  commissionRate: rate,
                  accountId: null,
                }
              : null
          }
        />
      ) : null}

      {/* Levels, not forecasts --------------------------------------------- */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-300">What each level would mean</h2>
        <p className="max-w-3xl text-xs text-neutral-500">
          This app does not predict prices, and nothing here is a forecast — a share price depends on news, earnings and
          the mood of the market, none of which a page of past closes knows. What follows is arithmetic: each level comes
          from somewhere real, and the table says what the move would be and what it would do to your holding.
        </p>

        {rows.length === 0 ? (
          <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-500">
            No levels to compare yet — a price, and either a year of history or entered earnings, gives them.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={`${TH} text-left`}>Level</th>
                  <th className={`${TH} text-left`}>Where it comes from</th>
                  <th className={`${TH} text-right`}>Price</th>
                  <th className={`${TH} text-right`}>Move from today</th>
                  {holding && holding.quantity > 0 ? (
                    <>
                      <th className={`${TH} text-right`}>Your {holding.quantity.toLocaleString()} worth</th>
                      <th className={`${TH} text-right`}>Gain on cost</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className={ROW}>
                    <td className={`${TD} text-neutral-300`}>{row.label}</td>
                    <td className={`${TD} text-xs text-neutral-500`}>{row.basis}</td>
                    <td className={`${TD} text-right tabular-nums text-neutral-100`}>{taka(row.price)}</td>
                    <td className={`${TD} text-right tabular-nums ${row.move >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                      {formatPercent(row.move, 1, true)}
                    </td>
                    {holding && holding.quantity > 0 ? (
                      <>
                        <td className={`${TD} text-right tabular-nums text-neutral-300`}>{formatBDT(row.value)}</td>
                        <td className={`${TD} text-right tabular-nums ${(row.gain ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                          {formatBDT(row.gain)}
                          {row.gainPct !== null ? (
                            <span className="ml-1 text-xs text-neutral-600">{formatPercent(row.gainPct, 1, true)}</span>
                          ) : null}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number | null }) {
  const colour = tone === undefined || tone === null ? 'text-neutral-100' : tone >= 0 ? 'text-emerald-500' : 'text-red-400'
  return (
    <div className="bg-neutral-950 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-0.5 text-lg font-medium ${colour}`}>{value}</p>
      {sub ? <p className="text-xs text-neutral-600">{sub}</p> : null}
    </div>
  )
}
