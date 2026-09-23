'use client'

import { useActionState } from 'react'

import { applyPriceHistory, type ApplyResult } from './actions'
import type { PricesPreview } from './prices'

const th = 'px-3 py-2 font-medium'
const thead = 'border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500'
const td = 'px-3 py-1.5'

/**
 * What a price file would add, stock by stock, before any of it is written.
 * Days already stored are replaced rather than duplicated, so re-importing
 * the same file changes nothing and a longer export simply extends it.
 */
export function PricesReview({ preview, fileName }: { preview: PricesPreview; fileName: string }) {
  const [result, action, pending] = useActionState<ApplyResult | null, FormData>(applyPriceHistory, null)
  const importable = preview.symbols.filter((s) => s.known)
  const rows = preview.rows.filter((r) => importable.some((s) => s.symbol === r.symbol))

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <input type="hidden" name="fileName" value={fileName} />

      <section className="grid gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
        <Fact label="File" value="Price history" />
        <Fact label="Days read" value={preview.totalRows.toLocaleString()} />
        <Fact label="Stocks" value={String(preview.symbols.length)} />
        <Fact
          label="Columns read"
          value={Object.entries(preview.columns).map(([heading, field]) => `${heading}→${field}`).join(', ')}
        />
      </section>

      {preview.issues.length > 0 ? (
        <div className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
          {preview.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={thead}>
              <th className={`${th} text-left`}>Stock</th>
              <th className={`${th} text-left`}>In the file</th>
              <th className={`${th} text-right`}>Days</th>
              <th className={`${th} text-left`}>Stored now</th>
              <th className={`${th} text-left`}>After importing</th>
            </tr>
          </thead>
          <tbody>
            {preview.symbols.map((s) => (
              <tr key={s.symbol} className="border-b border-neutral-900 last:border-0">
                <td className={`${td} font-medium text-neutral-200`}>{s.symbol}</td>
                <td className={`${td} text-xs text-neutral-400`}>
                  {s.from} → {s.to}
                </td>
                <td className={`${td} text-right tabular-nums text-neutral-300`}>{s.rows.toLocaleString()}</td>
                <td className={`${td} text-xs text-neutral-500`}>
                  {s.storedDays > 0 ? `${s.storedDays.toLocaleString()} days · ${s.storedFrom} → ${s.storedTo}` : 'none'}
                </td>
                <td className={`${td} text-xs`}>
                  {!s.known ? (
                    <span className="text-amber-400">not a company here — skipped</span>
                  ) : s.replacing > 0 ? (
                    <span className="text-neutral-400">
                      {(s.rows - s.replacing).toLocaleString()} new days, {s.replacing.toLocaleString()} replaced
                    </span>
                  ) : (
                    <span className="text-emerald-500">{s.rows.toLocaleString()} new days</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-600">
        Closing prices are what the insights use; open, high, low and volume are stored when the file has them. A day
        already stored is replaced, so importing the same file twice changes nothing.
      </p>

      <div className="flex items-center gap-4 border-t border-neutral-800 pt-4">
        <button
          type="submit"
          disabled={pending || importable.length === 0 || result?.ok}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {pending ? 'Importing…' : `Import ${rows.length.toLocaleString()} days`}
        </button>
        {result ? (
          <p className={`text-sm ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>{result.message}</p>
        ) : importable.length === 0 ? (
          <p className="text-xs text-neutral-600">None of these stocks are in the database yet.</p>
        ) : null}
      </div>
    </form>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-950 px-4 py-2.5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-0.5 truncate text-sm text-neutral-200" title={value}>
        {value}
      </p>
    </div>
  )
}
