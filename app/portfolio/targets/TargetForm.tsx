'use client'

import { useActionState, useState } from 'react'

import { saveTarget, type TargetResult } from './actions'

export interface Suggestion {
  price: number | null
  averageCost: number | null
  breakEven: number | null
  gain3: number | null
  gain5: number | null
  existing: { buyBelow: number | null; sellAbove: number | null; note: string | null } | null
}

const field =
  'w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600'

/**
 * Set a stock's buy and sell targets. Picking a stock you hold offers sell
 * prices worked out from your cost — break-even after commission, and a
 * little above — so a target is never set at a loss by accident.
 */
export function TargetForm({
  symbols,
  accounts,
  suggestions,
}: {
  symbols: string[]
  accounts: { id: number; name: string }[]
  /** Keyed `${accountId or 'any'}|${symbol}`. */
  suggestions: Record<string, Suggestion>
}) {
  const [result, action, pending] = useActionState<TargetResult | null, FormData>(saveTarget, null)
  const [symbol, setSymbol] = useState(symbols[0] ?? '')
  const [accountId, setAccountId] = useState('')
  const hint = suggestions[`${accountId || 'any'}|${symbol}`]
  const first = suggestions[`any|${symbols[0] ?? ''}`]?.existing
  const [buy, setBuy] = useState(first?.buyBelow?.toString() ?? '')
  const [sell, setSell] = useState(first?.sellAbove?.toString() ?? '')
  const [note, setNote] = useState(first?.note ?? '')

  // Picking a stock and account that already has targets loads them to edit.
  function load(nextSymbol: string, nextAccount: string) {
    const existing = suggestions[`${nextAccount || 'any'}|${nextSymbol}`]?.existing
    setBuy(existing?.buyBelow?.toString() ?? '')
    setSell(existing?.sellAbove?.toString() ?? '')
    setNote(existing?.note ?? '')
  }

  const chip = (label: string, value: number | null) =>
    value === null ? null : (
      <button
        type="button"
        onClick={() => setSell(value.toFixed(1))}
        className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-sky-600 hover:text-sky-300"
      >
        {label} ৳{value.toFixed(2)}
      </button>
    )

  return (
    <form action={action} className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-xs text-neutral-400">
          Stock
          <select
            name="symbol"
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value)
              load(e.target.value, accountId)
            }}
            className={`${field} mt-1`}
          >
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-neutral-400">
          Account
          <select
            name="accountId"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value)
              load(symbol, e.target.value)
            }}
            className={`${field} mt-1`}
          >
            <option value="">Any account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-neutral-400">
          Buy below ৳
          <input name="buyBelow" inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} className={`${field} mt-1 text-right tabular-nums`} />
        </label>
        <label className="block text-xs text-neutral-400">
          Sell above ৳
          <input name="sellAbove" inputMode="decimal" value={sell} onChange={(e) => setSell(e.target.value)} className={`${field} mt-1 text-right tabular-nums`} />
        </label>
        <label className="block text-xs text-neutral-400">
          Note
          <input name="note" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" className={`${field} mt-1`} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        {hint?.price ? <span>Now ৳{hint.price.toFixed(2)}.</span> : <span>No price yet.</span>}
        {hint?.averageCost ? (
          <>
            <span>Your average cost ৳{hint.averageCost.toFixed(2)} — sell at:</span>
            {chip('break-even', hint.breakEven)}
            {chip('+3%', hint.gain3)}
            {chip('+5%', hint.gain5)}
          </>
        ) : (
          <span>Not held{accountId ? ' in this account' : ''} — a buy target is what matters here.</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {pending ? 'Saving…' : hint?.existing ? 'Update targets' : 'Set targets'}
        </button>
        {result ? <p className={`text-sm ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>{result.message}</p> : null}
        <p className="text-xs text-neutral-600">Clear both prices and save to remove.</p>
      </div>
    </form>
  )
}
