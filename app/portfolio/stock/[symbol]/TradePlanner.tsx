'use client'

import { useState } from 'react'

import { simulateTrade } from '@/lib/portfolio'

const field =
  'w-24 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-right text-sm tabular-nums text-neutral-200 outline-none focus:border-sky-600'

function taka(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `৳${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Try a sale and a buy-back before placing them. Nothing is recorded — this
 * only runs the same cost rules forward.
 */
export function TradePlanner({
  quantity,
  costBasis,
  netCost,
  price,
}: {
  quantity: number
  costBasis: number
  netCost: number
  price: number | null
}) {
  const start = price ?? 0
  const [sellQty, setSellQty] = useState(String(Math.floor(quantity / 2)))
  const [sellPrice, setSellPrice] = useState(start ? (start * 1.05).toFixed(1) : '')
  const [buyQty, setBuyQty] = useState(String(Math.floor(quantity / 2)))
  const [buyPrice, setBuyPrice] = useState(start ? (start * 0.95).toFixed(1) : '')
  const [commission, setCommission] = useState('0.5')

  const n = (v: string) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0)

  const outcome = simulateTrade(
    { quantity, costBasis, netCost },
    {
      sellQty: Math.floor(n(sellQty)),
      sellPrice: n(sellPrice),
      buyQty: Math.floor(n(buyQty)),
      buyPrice: n(buyPrice),
      commissionRate: n(commission) / 100,
    },
  )

  const nowAvg = quantity > 0 ? costBasis / quantity : null
  const nowNet = quantity > 0 ? netCost / quantity : null

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-4">
      <div>
        <h2 className="text-sm font-medium text-neutral-300">Plan a trade</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Sell some now, buy back lower: the difference comes off your net cost. Nothing here is
          recorded.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 text-xs text-neutral-500">
        <label className="space-y-1">
          <span className="block">Sell shares</span>
          <input className={field} inputMode="numeric" value={sellQty} onChange={(e) => setSellQty(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="block">at ৳</span>
          <input className={field} inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="block">Buy back shares</span>
          <input className={field} inputMode="numeric" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="block">at ৳</span>
          <input className={field} inputMode="decimal" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="block">Commission %</span>
          <input className={`${field} w-16`} inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
        </label>
      </div>

      {outcome.invalid ? (
        <p className="text-xs text-red-400">{outcome.invalid}</p>
      ) : (
        <div className="grid gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 text-sm sm:grid-cols-4">
          <Cell label="Shares" before={quantity.toLocaleString()} after={outcome.quantity.toLocaleString()} />
          <Cell label="Average cost" before={taka(nowAvg)} after={taka(outcome.averageCost)} />
          <Cell
            label="Net cost / share"
            before={taka(nowNet)}
            after={outcome.netCostPerShare !== null && outcome.netCostPerShare <= 0 ? 'Free' : taka(outcome.netCostPerShare)}
            good={nowNet !== null && outcome.netCostPerShare !== null && outcome.netCostPerShare < nowNet}
          />
          <Cell
            label={outcome.cashNeeded > 0 ? 'Cash needed' : 'Cash freed'}
            before={`gain on sale ${taka(outcome.realisedGain)}`}
            after={taka(Math.abs(outcome.cashNeeded))}
          />
        </div>
      )}
    </section>
  )
}

function Cell({ label, before, after, good }: { label: string; before: string; after: string; good?: boolean }) {
  return (
    <div className="bg-neutral-950 px-4 py-2.5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-0.5 font-medium tabular-nums ${good ? 'text-emerald-400' : 'text-neutral-100'}`}>{after}</p>
      <p className="text-xs text-neutral-600">now {before}</p>
    </div>
  )
}
