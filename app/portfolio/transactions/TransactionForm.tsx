'use client'

import { useActionState, useState } from 'react'

import { addTransaction, type TransactionResult } from '../actions'

const TYPES = [
  { value: 'buy', label: 'Buy', hint: 'Shares in, cash out' },
  { value: 'sell', label: 'Sell', hint: 'Shares out, cash in' },
  { value: 'bonus', label: 'Bonus', hint: 'Shares in, no cash — average cost falls' },
  { value: 'rights', label: 'Rights', hint: 'Shares in at the subscription price' },
  { value: 'dividend', label: 'Dividend', hint: 'Cash in, no share movement' },
] as const

export function TransactionForm({ symbols }: { symbols: string[] }) {
  const [result, formAction, isPending] = useActionState<TransactionResult | null, FormData>(
    addTransaction,
    null,
  )
  const [txnType, setTxnType] = useState<(typeof TYPES)[number]['value']>('buy')

  const isDividend = txnType === 'dividend'
  const isBonus = txnType === 'bonus'
  const hint = TYPES.find((t) => t.value === txnType)?.hint

  return (
    <form
      action={formAction}
      className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Company">
          <Select name="symbol" defaultValue={symbols[0] ?? ''}>
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Type" hint={hint}>
          <Select
            name="txnType"
            value={txnType}
            onChange={(e) => setTxnType(e.target.value as typeof txnType)}
          >
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Date">
          <Input type="date" name="tradeDate" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>

        {isDividend ? (
          <Field label="Gross amount" hint="Before tax">
            <Input name="grossAmount" inputMode="decimal" placeholder="12,000" />
          </Field>
        ) : (
          <Field label="Quantity">
            <Input name="quantity" inputMode="decimal" placeholder="500" />
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!isDividend && !isBonus ? (
          <Field label="Price per share">
            <Input name="pricePerShare" inputMode="decimal" placeholder="215.90" />
          </Field>
        ) : null}

        {!isDividend ? (
          <Field label="Commission" hint="Brokerage, ~0.4–0.5%">
            <Input name="commission" inputMode="decimal" placeholder="0" />
          </Field>
        ) : (
          <Field label="Tax withheld" hint="Deducted at source">
            <Input name="taxWithheld" inputMode="decimal" placeholder="0" />
          </Field>
        )}

        <Field label="Note">
          <Input name="notes" placeholder="optional" />
        </Field>
      </div>

      <div className="flex items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Record'}
        </button>

        {result ? (
          <p className={`text-sm ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>
            {result.message}
          </p>
        ) : (
          <p className="text-xs text-neutral-600">
            Record what happened in your BO account. Holdings are derived from this, so a missing
            bonus entry shows up as a sale you cannot make.
          </p>
        )}
      </div>
    </form>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-neutral-600">{hint}</span> : null}
    </label>
  )
}

const control =
  'w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-600'

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={control} />
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} autoComplete="off" className={control} />
}
