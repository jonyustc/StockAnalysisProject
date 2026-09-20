'use client'

import { useActionState } from 'react'

import { login, type LoginState } from './actions'

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(login, {
    error: null,
  })

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />

      <input
        type="password"
        name="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-sky-600"
      />

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {isPending ? 'Checking…' : 'Sign in'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
