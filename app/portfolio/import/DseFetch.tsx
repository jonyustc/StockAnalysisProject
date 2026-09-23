'use client'

import { useActionState, useState } from 'react'

import { DSE_MAX_YEARS } from '@/lib/dse-fetch'

import { fetchDsePrices, type ImportPreview } from './actions'
import { PricesReview } from './PricesReview'

/**
 * Fetch a stock's day-end history straight from DSE, without downloading a
 * file. The result is the same preview a CSV gives, with the same import
 * button, so both ways of getting prices behave identically.
 */
export function DseFetch({ symbols }: { symbols: string[] }) {
  const [result, action, fetching] = useActionState<ImportPreview | null, FormData>(fetchDsePrices, null)
  const [symbol, setSymbol] = useState(symbols[0] ?? '')
  const preview = result?.ok && result.kind === 'prices' ? result : null

  return (
    <div className="space-y-5">
      <form action={action} className="flex flex-wrap items-end gap-3 rounded border border-neutral-800 bg-neutral-900/40 p-4">
        <label className="block text-xs text-neutral-400">
          Trading code
          <input
            name="symbol"
            list="dse-symbols"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            autoComplete="off"
            className="mt-1 block w-48 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
          />
          <datalist id="dse-symbols">
            {symbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <label className="block text-xs text-neutral-400">
          How far back
          <select
            name="years"
            defaultValue="1"
            className="mt-1 block rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
          >
            {Array.from({ length: DSE_MAX_YEARS }, (_, i) => i + 1).map((y) => (
              <option key={y} value={y}>
                {y} year{y === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={fetching || symbol.trim() === ''}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {fetching ? 'Fetching from DSE…' : 'Fetch from DSE'}
        </button>

        <p className="w-full text-xs text-neutral-600">
          Day-end prices from dsebd.org, the exchange itself. Its archive answers about five hundred rows at a time, so a
          longer range is fetched in several requests — which takes a few seconds. For five years, or for every stock at
          once, the command line does it without a time limit:{' '}
          <code className="text-neutral-500">npm run prices:dse -- --symbol=SQURPHARMA --years=5</code>
        </p>
      </form>

      {result && !result.ok ? (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-sm text-red-300">{result.message}</p>
      ) : null}

      {preview ? <PricesReview key={preview.message} preview={preview} fileName={`dse-${symbol}`} /> : null}
    </div>
  )
}
