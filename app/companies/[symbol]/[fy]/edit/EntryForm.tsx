'use client'

import { useActionState } from 'react'

import { saveAnnualEntry, type SaveResult } from '@/app/actions'
import type { FactRow } from '@/db/queries'

interface LineItem {
  id: number
  tag: string
  label: string
  statement: 'income' | 'balance' | 'cashflow' | 'per_share' | 'other'
  unit: 'currency' | 'per_share' | 'ratio' | 'percent' | 'count' | 'days'
}

interface Props {
  symbol: string
  companyName: string
  fiscalYear: number
  periodLabel: string
  periodStart: string
  periodEnd: string
  items: LineItem[]
  facts: Record<number, FactRow>
  existing: {
    basis: 'consolidated' | 'standalone'
    auditStatus: 'audited' | 'unaudited' | 'provisional' | 'restated'
    isComplete: boolean
    notes: string | null
  } | null
  documents: { id: number; title: string }[]
  defaultScale: string
}

const STATEMENT_HEADINGS: Record<LineItem['statement'], string> = {
  income: 'Income statement',
  balance: 'Balance sheet',
  cashflow: 'Cash flow',
  per_share: 'Per share',
  other: 'Other',
}

const STATEMENT_ORDER: LineItem['statement'][] = [
  'income',
  'balance',
  'cashflow',
  'per_share',
  'other',
]

/** Which rows are unaffected by the period scale — printed as-is in the report. */
const UNSCALED_UNITS = new Set(['per_share', 'percent', 'ratio', 'days'])

export function EntryForm({
  symbol,
  companyName,
  fiscalYear,
  periodLabel,
  periodStart,
  periodEnd,
  items,
  facts,
  existing,
  documents,
  defaultScale,
}: Props) {
  const [result, formAction, isPending] = useActionState<SaveResult | null, FormData>(
    saveAnnualEntry,
    null,
  )

  const grouped = STATEMENT_ORDER.map((statement) => ({
    statement,
    rows: items.filter((item) => item.statement === statement),
  })).filter((group) => group.rows.length > 0)

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="symbol" value={symbol} />
      <input type="hidden" name="fiscalYear" value={fiscalYear} />

      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-neutral-100">
          {companyName} · {periodLabel}
        </h1>
        <p className="font-mono text-xs text-neutral-500">
          {periodStart} → {periodEnd}
        </p>
      </header>

      {/* Period-level settings: set once, applied to every row below. */}
      <section className="grid gap-4 rounded border border-neutral-800 bg-neutral-900/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Basis">
          <Select name="basis" defaultValue={existing?.basis ?? 'consolidated'}>
            <option value="consolidated">Consolidated</option>
            <option value="standalone">Standalone</option>
          </Select>
        </Field>

        <Field label="Scale as printed" hint="Applies to amounts, not per-share figures">
          <Select name="scale" defaultValue={defaultScale}>
            <option value="unit">Taka (as-is)</option>
            <option value="thousand">Taka in &apos;000</option>
            <option value="lakh">Taka in lakh</option>
            <option value="million">Taka in million</option>
            <option value="crore">Taka in crore</option>
            <option value="billion">Taka in billion</option>
          </Select>
        </Field>

        <Field label="Audit status">
          <Select name="auditStatus" defaultValue={existing?.auditStatus ?? 'audited'}>
            <option value="audited">Audited</option>
            <option value="unaudited">Unaudited</option>
            <option value="provisional">Provisional</option>
            <option value="restated">Restated</option>
          </Select>
        </Field>

        <Field label="Source document">
          {documents.length > 0 ? (
            <Select name="sourceDocumentId" defaultValue="">
              <option value="">New document…</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </Select>
          ) : (
            <Input name="docTitle" placeholder={`Annual Report ${fiscalYear - 1}-${String(fiscalYear).slice(2)}`} />
          )}
        </Field>

        {documents.length > 0 ? (
          <Field label="…or name a new one">
            <Input name="docTitle" placeholder={`Annual Report ${fiscalYear - 1}-${String(fiscalYear).slice(2)}`} />
          </Field>
        ) : null}

        <Field label="OneDrive path" hint="Where the PDF lives">
          <Input name="docPath" placeholder={`${symbol}/AR-${fiscalYear}.pdf`} />
        </Field>
      </section>

      {/* Line items */}
      <div className="space-y-6">
        {grouped.map((group) => (
          <section key={group.statement}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {STATEMENT_HEADINGS[group.statement]}
            </h2>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {group.rows.map((item) => {
                  const fact = facts[item.id]
                  const error = result?.fieldErrors?.[item.tag]

                  return (
                    <tr key={item.id} className="border-b border-neutral-900">
                      <td className="w-1/2 py-1.5 pr-4 text-neutral-300">
                        {item.label}
                        {UNSCALED_UNITS.has(item.unit) ? (
                          <span className="ml-2 text-xs text-neutral-600">as printed</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3">
                        <input
                          name={`value__${item.tag}`}
                          defaultValue={fact ? trimNumber(fact.valueReported) : ''}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="—"
                          aria-invalid={error ? true : undefined}
                          className={`w-full rounded border bg-neutral-950 px-2 py-1 text-right tabular-nums text-neutral-100 outline-none focus:border-sky-600 ${
                            error ? 'border-red-600' : 'border-neutral-800'
                          }`}
                        />
                        {error ? (
                          <p className="mt-0.5 text-xs text-red-400">{error}</p>
                        ) : null}
                      </td>
                      <td className="w-20 py-1.5">
                        <input
                          name={`page__${item.tag}`}
                          defaultValue={fact?.sourcePage ?? ''}
                          autoComplete="off"
                          placeholder="pg"
                          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-center text-neutral-400 outline-none focus:border-sky-600"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <section className="space-y-4">
        <Field label="Notes">
          <Input name="notes" defaultValue={existing?.notes ?? ''} placeholder="Anything odd about this year" />
        </Field>

        <label className="flex items-center gap-2 text-sm text-neutral-400">
          <input
            type="checkbox"
            name="isComplete"
            defaultChecked={existing?.isComplete ?? false}
            className="rounded border-neutral-700 bg-neutral-950"
          />
          Mark this year as complete
        </label>
      </section>

      <div className="flex items-center gap-4 border-t border-neutral-800 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>

        {result ? (
          <p className={`text-sm ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>
            {result.message}
          </p>
        ) : (
          <p className="text-xs text-neutral-600">
            Leave a field blank if the report does not state it — blank is recorded as absent,
            not as zero.
          </p>
        )}
      </div>
    </form>
  )
}

/** numeric(24,6) comes back as "20712.000000"; show it the way it was typed. */
function trimNumber(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value
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

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
    />
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      autoComplete="off"
      className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
    />
  )
}
