'use client'

import { useActionState, useState } from 'react'

import { applyPastedDividends, previewPastedDividends, type ApplyResult, type ImportPreview } from './actions'

const th = 'px-3 py-2 font-medium'
const thead = 'border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500'
const td = 'px-3 py-1.5'

/**
 * A company's dividend history, pasted from wherever it is published.
 *
 * Copying a table out of a page brings its markup along; that is read as
 * well as plain text, so there is nothing to tidy up first.
 */
export function PasteDividends({ symbols }: { symbols: string[] }) {
  const [preview, previewAction, reading] = useActionState<ImportPreview | null, FormData>(previewPastedDividends, null)
  const [saved, applyAction, saving] = useActionState<ApplyResult | null, FormData>(applyPastedDividends, null)
  const [symbol, setSymbol] = useState(symbols[0] ?? '')

  const read = preview?.ok && preview.kind === 'dividend-history' ? preview : null
  const fresh = read?.lines.filter((l) => !l.stored || l.differs !== null) ?? []

  return (
    <div className="space-y-5">
      <form action={previewAction} className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs text-neutral-400">
            Stock
            <select
              name="symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="mt-1 block w-48 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={reading}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {reading ? 'Reading…' : 'Read the table'}
          </button>
        </div>

        <textarea
          name="pasted"
          rows={5}
          placeholder={'Paste the dividend table here — select it on the page, copy, paste.\n\nEx-Dividend Date\tDividend\tType\tPayment Date\nNov 17, 2025\t12.00\t12M\tJan 14, 2026'}
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-200 outline-none focus:border-sky-600"
        />
        <p className="text-xs text-neutral-600">
          Ex-date and amount are what matter; a payment date is kept when the table has one. These are the company&apos;s
          announcements, stored with its bonus and rights issues — what you were actually paid stays in your ledger.
        </p>
      </form>

      {preview && !preview.ok ? (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-sm text-red-300">{preview.message}</p>
      ) : null}

      {read ? (
        <form action={applyAction} className="space-y-4">
          <input type="hidden" name="symbol" value={read.symbol} />
          <input type="hidden" name="lines" value={JSON.stringify(read.lines)} />
          <input type="hidden" name="source" value="a pasted dividend table" />

          <p className="text-sm text-neutral-300">{read.message}</p>

          {read.issues.length > 0 ? (
            <div className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
              {read.issues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className={thead}>
                  <th className="w-10 px-3 py-2" />
                  <th className={`${th} text-left`}>Ex-date</th>
                  <th className={`${th} text-right`}>Dividend</th>
                  <th className={`${th} text-left`}>Paid</th>
                  <th className={`${th} text-left`}>Type</th>
                  <th className={`${th} text-left`}>Status</th>
                </tr>
              </thead>
              <tbody>
                {read.lines.map((line) => (
                  <tr key={line.exDate} className="border-b border-neutral-900 last:border-0">
                    <td className={td}>
                      <input
                        type="checkbox"
                        name="dividend"
                        value={line.exDate}
                        defaultChecked={!line.stored || line.differs !== null}
                        aria-label={`Save ${line.exDate}`}
                        className="rounded border-neutral-700 bg-neutral-950"
                      />
                    </td>
                    <td className={`${td} text-neutral-300`}>{line.exDate}</td>
                    <td className={`${td} text-right tabular-nums text-neutral-100`}>
                      ৳{line.amount.toFixed(line.looksAdjusted ? 4 : 2)}
                    </td>
                    <td className={`${td} text-xs text-neutral-500`}>{line.paymentDate ?? '—'}</td>
                    <td className={`${td} text-xs text-neutral-500`}>{line.kind ?? '—'}</td>
                    <td className={`${td} text-xs`}>
                      {line.differs !== null ? (
                        <span className="text-amber-400">stored as ৳{line.differs.toFixed(2)} — saving replaces it</span>
                      ) : line.stored ? (
                        <span className="text-neutral-600">already stored</span>
                      ) : line.looksAdjusted ? (
                        <span className="text-amber-400/80">restated by that source</span>
                      ) : (
                        <span className="text-emerald-500">new</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-4 border-t border-neutral-800 pt-4">
            <button
              type="submit"
              disabled={saving || saved?.ok}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Save ${fresh.length} dividend${fresh.length === 1 ? '' : 's'}`}
            </button>
            {saved ? (
              <p className={`text-sm ${saved.ok ? 'text-emerald-500' : 'text-red-400'}`}>{saved.message}</p>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}
