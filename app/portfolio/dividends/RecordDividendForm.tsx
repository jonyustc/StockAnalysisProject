'use client'

import { useActionState } from 'react'

import { addTransaction, type TransactionResult } from '../actions'

/**
 * Record a declared dividend as received, from the row that announced it.
 * Posts to the same action as the transactions page, so the same checks
 * apply. Tax defaults to 10% — the rate for an individual with a TIN.
 */
export function RecordDividendForm({
  accountId,
  symbol,
  gross,
  recordDate,
  today,
}: {
  accountId: number
  symbol: string
  gross: number
  recordDate: string | null
  today: string
}) {
  const [result, action, pending] = useActionState<TransactionResult | null, FormData>(
    addTransaction,
    null,
  )

  if (result?.ok) return <span className="text-xs text-emerald-500">Recorded.</span>

  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="boAccountId" value={accountId} />
      <input type="hidden" name="symbol" value={symbol} />
      <input type="hidden" name="txnType" value="dividend" />
      <input type="hidden" name="grossAmount" value={gross} />
      {recordDate ? <input type="hidden" name="recordDate" value={recordDate} /> : null}
      <input
        type="hidden"
        name="notes"
        value={`Declared dividend, record date ${recordDate ?? 'unknown'}; recorded as received from the dividends page.`}
      />
      <label className="flex items-center gap-1 text-neutral-500">
        paid on
        <input
          type="date"
          name="tradeDate"
          defaultValue={today}
          min={recordDate ?? undefined}
          className="rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-neutral-200"
        />
      </label>
      <label className="flex items-center gap-1 text-neutral-500">
        tax ৳
        <input
          name="taxWithheld"
          inputMode="decimal"
          defaultValue={(Math.round(gross * 10) / 100).toFixed(2)}
          className="w-20 rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-right tabular-nums text-neutral-200"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-emerald-800 px-2 py-0.5 text-emerald-400 hover:border-emerald-600 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Mark received'}
      </button>
      {result && !result.ok ? <span className="text-red-400">{result.message}</span> : null}
    </form>
  )
}
