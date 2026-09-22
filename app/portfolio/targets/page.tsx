import Link from 'next/link'

import { listBoAccounts, listCompanyNames } from '@/db/queries'
import { breakEvenPrice, priceForGain, type SideStatus } from '@/lib/targets'
import { formatTradeDate } from '@/lib/trading-calendar'
import { formatPercent } from '@/lib/units'

import { targetStatuses } from '../target-data'
import { PortfolioNav, ROW, TD, TH, THEAD_ROW } from '../ui'
import { deleteTarget } from './actions'
import { TargetForm, type Suggestion } from './TargetForm'

export const dynamic = 'force-dynamic'

const taka = (v: number | null) => (v === null ? '—' : `৳${v.toFixed(2)}`)

export default async function TargetsPage() {
  const [{ statuses, transactions, quotes, positionOf, rateOf }, accounts, companies] = await Promise.all([
    targetStatuses(),
    listBoAccounts(),
    listCompanyNames(),
  ])

  const reached = statuses.filter((s) => s.buy?.reached || s.sell?.reached)
  const near = statuses.filter((s) => !(s.buy?.reached || s.sell?.reached) && (s.buy?.near || s.sell?.near))

  // Stocks with a price or a position: those are the ones a target can mean anything for.
  const held = new Set(transactions.map((t) => t.symbol))
  const symbols = companies
    .map((c) => c.symbol)
    .filter((s) => quotes.has(s) || held.has(s))
    .sort((a, b) => Number(held.has(b)) - Number(held.has(a)) || a.localeCompare(b))

  const suggestions: Record<string, Suggestion> = {}
  for (const symbol of symbols) {
    for (const account of [null, ...accounts.map((a) => a.id)]) {
      const position = positionOf(symbol, account)
      const avg = position && position.quantity > 0 ? position.averageCost : null
      const rate = rateOf(account)
      const existing = statuses.find((s) => s.target.symbol === symbol && s.target.accountId === account)?.target
      suggestions[`${account ?? 'any'}|${symbol}`] = {
        price: quotes.get(symbol)?.close ?? null,
        averageCost: avg,
        breakEven: avg ? breakEvenPrice(avg, rate) : null,
        gain3: avg ? priceForGain(avg, 0.03, rate) : null,
        gain5: avg ? priceForGain(avg, 0.05, rate) : null,
        existing: existing ? { buyBelow: existing.buyBelow, sellAbove: existing.sellAbove, note: existing.note } : null,
      }
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">Targets</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          A price to buy below and a price to sell above, for any stock. Checked against each day&apos;s
          DSE close. Sell targets are measured against what your shares cost after commission, so
          a target that would sell at a loss says so.
        </p>
      </header>

      <PortfolioNav current="targets" />

      {statuses.length > 0 ? (
        <p
          className={`rounded border px-4 py-3 text-sm ${
            reached.length > 0
              ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-200/90'
              : 'border-neutral-800 bg-neutral-900/40 text-neutral-400'
          }`}
        >
          {reached.length > 0
            ? `${reached.length} target${reached.length === 1 ? '' : 's'} reached: ${reached.map((s) => `${s.target.symbol} ${s.buy?.reached ? 'buy' : 'sell'}`).join(', ')}.`
            : 'No target reached at the latest close.'}
          {near.length > 0 ? ` Within ${formatPercent(0.02, 0)}: ${near.map((s) => s.target.symbol).join(', ')}.` : ''}
        </p>
      ) : null}

      <TargetForm symbols={symbols} accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} suggestions={suggestions} />

      {statuses.length === 0 ? (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
          No targets yet. Set one above — for a stock you hold, the sell prices offered start at
          break-even after commission.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={`${TH} text-left`}>Stock</th>
                <th className={`${TH} text-left`}>Account</th>
                <th className={`${TH} text-right`}>Price</th>
                <th className={`${TH} text-right`}>Buy below</th>
                <th className={`${TH} text-right`}>Sell above</th>
                <th className={`${TH} text-right`} title="The lowest sale price that gets back what the shares cost, after commission">
                  Break-even
                </th>
                <th className={`${TH} text-left`}>Note</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.target.id} className={`${ROW} align-top`}>
                  <td className={TD}>
                    <Link
                      href={`/portfolio/stock/${s.target.symbol}${s.target.accountId ? `?account=${s.target.accountId}` : ''}`}
                      className="font-medium text-sky-400 hover:text-sky-300"
                    >
                      {s.target.symbol}
                    </Link>
                    {s.warnings.map((w) => (
                      <span key={w} className="block max-w-xs text-xs text-amber-400/80">{w}</span>
                    ))}
                  </td>
                  <td className={`${TD} text-xs text-neutral-400`}>{s.target.accountName ?? 'Any account'}</td>
                  <td className={`${TD} text-right tabular-nums text-neutral-200`}>
                    {taka(s.price)}
                    {s.priceDate ? <span className="block text-xs text-neutral-600">{formatTradeDate(s.priceDate)}</span> : null}
                  </td>
                  <td className={`${TD} text-right`}><Level side={s.buy} kind="buy" /></td>
                  <td className={`${TD} text-right`}><Level side={s.sell} kind="sell" /></td>
                  <td className={`${TD} text-right tabular-nums text-neutral-400`}>
                    {taka(s.breakEven)}
                    {s.position ? (
                      <span className="block text-xs text-neutral-600">{s.position.quantity.toLocaleString()} held</span>
                    ) : null}
                  </td>
                  <td className={`${TD} max-w-xs text-xs text-neutral-500`}>{s.target.note}</td>
                  <td className={TD}>
                    <form action={deleteTarget}>
                      <input type="hidden" name="id" value={s.target.id} />
                      <button type="submit" className="text-xs text-neutral-600 hover:text-red-400">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-600">
        Prices update once a trading day, around 5pm Dhaka. &ldquo;Near&rdquo; means within 2%.
        To change a target, pick the same stock and account above — it loads what is set.
      </p>
    </div>
  )
}

function Level({ side, kind }: { side: SideStatus | null; kind: 'buy' | 'sell' }) {
  if (!side) return <span className="text-neutral-700">—</span>
  return (
    <span className="tabular-nums">
      <span className={side.reached ? 'font-medium text-emerald-400' : 'text-neutral-200'}>৳{side.level.toFixed(2)}</span>
      <span
        className={`block text-xs ${side.reached ? 'text-emerald-500' : side.near ? 'text-amber-400' : 'text-neutral-600'}`}
      >
        {side.reached
          ? kind === 'buy' ? 'reached — at or below' : 'reached — at or above'
          : side.toGo === null
            ? 'no price'
            : `${formatPercent(side.toGo, 1, true)} to go${side.near ? ' · near' : ''}`}
      </span>
    </span>
  )
}
