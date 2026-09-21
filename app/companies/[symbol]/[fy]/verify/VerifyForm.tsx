'use client'

import { useActionState } from 'react'

import { verifyAnnualEntry, type VerifyResult } from '@/app/actions'
import type { VerifyOutcome } from '@/lib/verification'

interface Row {
  id: number
  tag: string
  label: string
  statement: 'income' | 'balance' | 'cashflow' | 'per_share' | 'other'
  unscaled: boolean
  /** What is stored, expressed in the form's scale. Null when nothing is. */
  stored: string | null
  page: string | null
  verification: 'unverified' | 'verified' | 'disputed'
}

interface Props {
  symbol: string
  companyName: string
  fiscalYear: number
  periodLabel: string
  rows: Row[]
  documents: { id: number; title: string }[]
  defaultScale: string
  basis: 'consolidated' | 'standalone'
}

const HEADINGS: Record<Row['statement'], string> = {
  income: 'Income statement',
  balance: 'Balance sheet',
  cashflow: 'Cash flow',
  per_share: 'Per share',
  other: 'Other',
}

const ORDER: Row['statement'][] = ['income', 'balance', 'cashflow', 'per_share', 'other']

const OUTCOME_STYLE: Record<VerifyOutcome, { label: string; className: string }> = {
  confirmed: { label: 'matches', className: 'text-emerald-500' },
  corrected: { label: 'corrected', className: 'text-amber-400' },
  added: { label: 'added', className: 'text-sky-400' },
  skipped: { label: '', className: '' },
  error: { label: 'unreadable', className: 'text-red-400' },
}

export function VerifyForm({
  symbol,
  companyName,
  fiscalYear,
  periodLabel,
  rows,
  documents,
  defaultScale,
  basis,
}: Props) {
  const [result, formAction, isPending] = useActionState<VerifyResult | null, FormData>(
    verifyAnnualEntry,
    null,
  )

  const grouped = ORDER.map((statement) => ({
    statement,
    rows: rows.filter((row) => row.statement === statement),
  })).filter((group) => group.rows.length > 0)

  const alreadyVerified = rows.filter((row) => row.verification === 'verified').length

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="symbol" value={symbol} />
      <input type="hidden" name="fiscalYear" value={fiscalYear} />
      <input type="hidden" name="basis" value={basis} />

      <header>
        <h1 className="text-xl font-semibold text-neutral-100">
          Verify · {companyName} · {periodLabel}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Open the annual report and type what it says. Leave a row blank if you have not
          checked it — blank means unchecked, never agreement.
        </p>
        <p className="mt-1 text-xs text-neutral-600">
          {alreadyVerified} of {rows.length} already verified.
        </p>
      </header>

      <section className="grid gap-4 rounded border border-neutral-800 bg-neutral-900/40 p-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-400">
            Report you are checking against
          </span>
          <select
            name="sourceDocumentId"
            defaultValue=""
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
          >
            <option value="">— keep the existing source —</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-400">
            Scale you are reading
          </span>
          <select
            name="scale"
            defaultValue={defaultScale}
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
          >
            <option value="unit">Taka (as-is)</option>
            <option value="thousand">Taka in &apos;000</option>
            <option value="lakh">Taka in lakh</option>
            <option value="million">Taka in million</option>
            <option value="crore">Taka in crore</option>
            <option value="billion">Taka in billion</option>
          </select>
          <span className="mt-1 block text-xs text-neutral-600">
            Stored figures are shown converted to this scale.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-400">
            Default page
          </span>
          <input
            name="reportPage"
            placeholder="used where a row has none"
            autoComplete="off"
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-600"
          />
        </label>
      </section>

      <div className="space-y-6">
        {grouped.map((group) => (
          <section key={group.statement}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {HEADINGS[group.statement]}
            </h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-600">
                  <th className="w-2/5 py-1 text-left font-medium">Line</th>
                  <th className="py-1 text-right font-medium">Stored</th>
                  <th className="py-1 text-right font-medium">Report says</th>
                  <th className="w-20 py-1 text-center font-medium">Page</th>
                  <th className="w-24 py-1 text-left font-medium" />
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const error = result?.fieldErrors?.[row.tag]
                  const outcome = result?.outcomes?.[row.tag]
                  const badge = outcome ? OUTCOME_STYLE[outcome] : null

                  return (
                    <tr key={row.id} className="border-b border-neutral-900">
                      <td className="py-1.5 pr-4 text-neutral-300">
                        {row.label}
                        {row.unscaled ? (
                          <span className="ml-2 text-xs text-neutral-600">as printed</span>
                        ) : null}
                      </td>

                      <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-500">
                        {row.stored ?? <span className="text-neutral-700">not stored</span>}
                      </td>

                      <td className="py-1.5 pr-3">
                        <input
                          name={`value__${row.tag}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="—"
                          aria-label={`${row.label} as printed in the report`}
                          aria-invalid={error ? true : undefined}
                          className={`w-full rounded border bg-neutral-950 px-2 py-1 text-right tabular-nums text-neutral-100 outline-none focus:border-sky-600 ${
                            error ? 'border-red-600' : 'border-neutral-800'
                          }`}
                        />
                        {error ? <p className="mt-0.5 text-xs text-red-400">{error}</p> : null}
                      </td>

                      <td className="py-1.5">
                        <input
                          name={`page__${row.tag}`}
                          defaultValue={row.page ?? ''}
                          autoComplete="off"
                          placeholder="pg"
                          aria-label={`${row.label} page number`}
                          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-center text-neutral-400 outline-none focus:border-sky-600"
                        />
                      </td>

                      <td className="py-1.5 pl-3 text-xs">
                        {badge && badge.label ? (
                          <span className={badge.className}>{badge.label}</span>
                        ) : row.verification === 'verified' ? (
                          <span className="text-emerald-700" title="Already verified">
                            verified
                          </span>
                        ) : row.verification === 'disputed' ? (
                          <span className="text-red-500">disputed</span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <div className="flex items-center gap-4 border-t border-neutral-800 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {isPending ? 'Checking…' : 'Check against report'}
        </button>

        {result ? (
          <p className={`text-sm ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>
            {result.message}
          </p>
        ) : (
          <p className="text-xs text-neutral-600">
            A figure that differs is not overwritten — the old one is kept as a superseded
            revision and the report&apos;s value becomes current.
          </p>
        )}
      </div>
    </form>
  )
}
