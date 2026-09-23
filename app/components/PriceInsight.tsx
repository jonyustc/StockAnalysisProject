import Link from 'next/link'

import type { StockInsight } from '@/app/portfolio/insight-data'
import { breakEvenPrice, priceForGain } from '@/lib/targets'
import { formatTradeDate } from '@/lib/trading-calendar'
import { formatPercent } from '@/lib/units'

const taka = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `৳${v.toFixed(2)}`)
const ratio = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))

/** Your own position in the stock, when the page knows it. */
export interface HoldingContext {
  quantity: number
  averageCost: number | null
  netCostPerShare: number | null
  commissionRate: number
  accountId: number | null
}

/**
 * Where the price sits, what it costs against what the company earns, and
 * how both compare with its own past and with the other tracked companies.
 */
export function PriceInsight({ insight, holding }: { insight: StockInsight; holding?: HoldingContext | null }) {
  const { valuation: v, band, seasons, ownYear, fall, coverage } = insight
  const price = insight.price

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-300">Buying low, selling high</h2>
        <p className="text-xs text-neutral-600">
          {insight.tradeDate ? `Close of ${formatTradeDate(insight.tradeDate)}` : 'No price yet'}
          {insight.latestFiscalYear ? ` · earnings of FY${insight.latestFiscalYear}` : ''}
        </p>
      </div>

      {/* Where in the 52-week range -------------------------------------- */}
      {v && v.rangePosition !== null && price !== null ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <p className="text-neutral-300">
              <strong className="font-medium text-neutral-100">{formatPercent(v.rangePosition, 0)}</strong> of the way up its
              52-week range
            </p>
            <p className="text-xs text-neutral-500">
              {formatPercent(v.belowHigh, 1)} from the high · {formatPercent(v.aboveLow, 1, true)} above the low
            </p>
          </div>

          <div className="mt-3">
            <div className="relative h-2 rounded bg-neutral-800">
              <div
                className="absolute -top-1 h-4 w-0.5 bg-sky-400"
                style={{ left: `${Math.min(100, Math.max(0, v.rangePosition * 100))}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-neutral-500">
              <span>low {taka(insight.yearLow)}</span>
              <span className="text-neutral-300">now {taka(price)}</span>
              <span>high {taka(insight.yearHigh)}</span>
            </div>
          </div>

          {ownYear?.highDate && ownYear.lowDate ? (
            <p className="mt-3 text-xs text-neutral-500">
              In the prices stored here, the year&apos;s high was {taka(ownYear.high)} on {formatTradeDate(ownYear.highDate)} and
              the low {taka(ownYear.low)} on {formatTradeDate(ownYear.lowDate)}.
              {fall ? ` Worst fall from a peak: ${formatPercent(fall.worst, 0)}.` : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Value, against peers -------------------------------------------- */}
      <div className="grid gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-2 lg:grid-cols-4">
        <Measure
          label="P/E"
          value={ratio(v?.pe)}
          sub={insight.eps !== null ? `${taka(insight.eps)} earned per share` : 'no EPS entered'}
          peers={insight.peers.pe}
          format={ratio}
          cheapIsLow
        />
        <Measure
          label="P/B"
          value={ratio(v?.pb)}
          sub={insight.navps !== null ? `${taka(insight.navps)} book value` : 'no book value entered'}
          peers={insight.peers.pb}
          format={ratio}
          cheapIsLow
        />
        <Measure
          label="Dividend yield"
          value={formatPercent(v?.dividendYield ?? null, 2)}
          sub={insight.dividendPerShare !== null ? `${taka(insight.dividendPerShare)} a share` : 'no dividend entered'}
          peers={insight.peers.dividendYield}
          format={(x) => formatPercent(x, 2)}
        />
        <Measure
          label="Earnings yield"
          value={v?.pe ? formatPercent(1 / v.pe, 2) : '—'}
          sub="what the earnings return at this price"
          peers={null}
          format={ratio}
        />
      </div>

      {/* Against its own past -------------------------------------------- */}
      {band ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
          <p className="text-neutral-300">
            Against its own past: it has traded between{' '}
            <strong className="font-medium text-neutral-100">{ratio(band.low)}</strong> and{' '}
            <strong className="font-medium text-neutral-100">{ratio(band.high)}</strong> times earnings, middling{' '}
            {ratio(band.median)}. Today&apos;s {ratio(band.current)} is{' '}
            <strong className={band.rank !== null && band.rank < 0.4 ? 'text-emerald-400' : band.rank !== null && band.rank > 0.6 ? 'text-amber-400' : 'text-neutral-200'}>
              {band.rank === null ? '—' : `cheaper than ${formatPercent(1 - band.rank, 0)} of those days`}
            </strong>
            .
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            At today&apos;s earnings, those multiples put the cheap end at{' '}
            <span className="text-emerald-400">{taka(band.priceAtLow)}</span>, the middle at {taka(band.priceAtMedian)} and the
            dear end at <span className="text-amber-400">{taka(band.priceAtHigh)}</span>. From {band.samples} trading days since{' '}
            {band.from}, each valued on the earnings published by then.
          </p>
        </div>
      ) : null}

      {/* When highs and lows have fallen --------------------------------- */}
      {seasons ? (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-sm text-neutral-300">
          Across {seasons.years} years, the yearly high fell most often in{' '}
          <strong className="font-medium text-neutral-100">{seasons.highMonths[0].name}</strong>
          {seasons.highMonths[1] ? ` (then ${seasons.highMonths[1].name})` : ''} and the low in{' '}
          <strong className="font-medium text-neutral-100">{seasons.lowMonths[0].name}</strong>
          {seasons.lowMonths[1] ? ` (then ${seasons.lowMonths[1].name})` : ''}.{' '}
          <span className="text-xs text-neutral-500">A pattern in few years, not a rule.</span>
        </p>
      ) : null}

      {/* Your own position ----------------------------------------------- */}
      {holding && holding.quantity > 0 && holding.averageCost !== null ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
          <p className="text-neutral-300">
            You hold {holding.quantity.toLocaleString()} at {taka(holding.averageCost)} average
            {holding.netCostPerShare !== null ? `, ${taka(holding.netCostPerShare)} net of what it has paid back` : ''}.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            After {formatPercent(holding.commissionRate, 2)} commission, a sale gets your cost back at{' '}
            <span className="text-neutral-300">{taka(breakEvenPrice(holding.averageCost, holding.commissionRate))}</span>, makes
            3% at {taka(priceForGain(holding.averageCost, 0.03, holding.commissionRate))} and 5% at{' '}
            {taka(priceForGain(holding.averageCost, 0.05, holding.commissionRate))}.{' '}
            <Link href="/portfolio/targets" className="text-sky-400 hover:text-sky-300">
              Set a target
            </Link>{' '}
            and the app alerts you when the price gets there.
          </p>
        </div>
      ) : null}

      {coverage.note ? (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-500">
          {coverage.note} Until then, the range above comes from the broker feed&apos;s own 52-week figures, which do not say
          when the high or low happened.
        </p>
      ) : null}
    </section>
  )
}

function Measure({
  label,
  value,
  sub,
  peers,
  format,
  cheapIsLow = false,
}: {
  label: string
  value: string
  sub: string
  peers: StockInsight['peers']['pe']
  format: (v: number) => string
  cheapIsLow?: boolean
}) {
  // "Cheaper than 6 of 8" reads plainly; for yield, higher is the good end.
  const good = peers ? (cheapIsLow ? peers.rank <= 0.4 : peers.rank >= 0.6) : false

  return (
    <div className="bg-neutral-950 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-0.5 text-lg font-medium text-neutral-100">{value}</p>
      <p className="text-xs text-neutral-600">{sub}</p>
      {peers ? (
        <p className={`mt-1 text-xs ${good ? 'text-emerald-500/90' : 'text-neutral-500'}`}>
          {cheapIsLow
            ? `cheaper than ${peers.cheaperThan} of ${peers.peers} tracked`
            : `higher than ${peers.peers - peers.cheaperThan} of ${peers.peers} tracked`}
          , median {format(peers.median)}
        </p>
      ) : null}
    </div>
  )
}
