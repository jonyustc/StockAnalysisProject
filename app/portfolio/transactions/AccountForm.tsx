'use client'

import { useActionState } from 'react'

import { addBoAccount, type TransactionResult } from '../actions'

const control =
  'w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-600'

export function AccountForm() {
  const [result, formAction, isPending] = useActionState<TransactionResult | null, FormData>(
    addBoAccount,
    null,
  )

  return (
    <form action={formAction} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <input name="name" placeholder="Name, e.g. Personal — LankaBangla" aria-label="Account name" autoComplete="off" className={`${control} sm:col-span-2`} />
        <input name="broker" placeholder="Broker (optional)" aria-label="Broker" autoComplete="off" className={control} />
        <input
          name="boNumber"
          placeholder="16-digit BO ID (optional)"
          aria-label="BO ID"
          inputMode="numeric"
          autoComplete="off"
          className={control}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-sky-700 hover:text-sky-300 disabled:opacity-50"
        >
          {isPending ? 'Adding…' : 'Add account'}
        </button>
        {result ? (
          <p className={`text-xs ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>
            {result.message}
          </p>
        ) : (
          <p className="text-xs text-neutral-600">
            The BO ID is only for reconciling against CDBL statements. If you store it, it is
            included in the nightly backup on your private repo.
          </p>
        )}
      </div>
    </form>
  )
}
