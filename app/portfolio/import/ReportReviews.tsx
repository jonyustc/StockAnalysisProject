'use client'

import { useActionState } from 'react'

import { applyDividendReport, applyLedgerImport, type ApplyResult } from './actions'
import type { DividendReportPreview, LedgerPreview, PnlPreview } from './reports'

function taka(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `৳${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const box = 'rounded border border-neutral-800 bg-neutral-900/40 p-4 text-sm'
const th = 'px-3 py-2 font-medium'
const thead = 'border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500'
const td = 'px-3 py-1.5'

function Facts({ items }: { items: [string, string][] }) {
  return (
    <section className="grid gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="bg-neutral-950 px-4 py-2.5">
          <p className="text-xs text-neutral-500">{label}</p>
          <p className="mt-0.5 text-sm text-neutral-200">{value}</p>
        </div>
      ))}
    </section>
  )
}

function Outcome({ result, pending, label, disabled }: { result: ApplyResult | null; pending: boolean; label: string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-4 border-t border-neutral-800 pt-4">
      <button
        type="submit"
        disabled={pending || disabled || result?.ok}
        className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {pending ? 'Saving…' : label}
      </button>
      {result ? <p className={`text-sm ${result.ok ? 'text-emerald-500' : 'text-red-400'}`}>{result.message}</p> : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function LedgerReview({ preview }: { preview: LedgerPreview }) {
  const [result, action, pending] = useActionState<ApplyResult | null, FormData>(applyLedgerImport, null)
  const { header: h, plan, summary } = preview
  const blocked = plan.blockers.length > 0
  const changed = plan.holdings.filter((x) => x.before !== x.after)

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="from" value={plan.from} />
      <input type="hidden" name="to" value={plan.to} />
      <input type="hidden" name="broker" value={h.broker} />
      <input type="hidden" name="plan" value={JSON.stringify(plan)} />

      <Facts
        items={[
          ['Document', 'Client ledger'],
          ['Client code', `${h.clientCode ?? '—'} · ${h.accountType ?? ''}`],
          ['BO ID', h.boIdLast4 ? `•••• ${h.boIdLast4}` : '—'],
          ['Period', `${h.from} → ${h.to}`],
          ['Trades', `${summary.buys} buys · ${summary.sells} sells`],
          ['Commission paid', taka(summary.commission)],
          ['Deposited', taka(summary.deposits)],
          ['Withdrawn · fees', `${taka(summary.withdrawals)} · ${taka(summary.fees)}`],
        ]}
      />

      <p className="text-xs text-neutral-500">
        Every line&apos;s running balance was checked against the one before, and the totals and
        closing balance ({taka(h.closingBalance)}) against the sum of the lines.
      </p>

      <AccountChoice account={preview.account} boId={preview.boId} suggested={preview.suggestedAccountName} />

      {blocked ? (
        <div className="rounded border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-xs text-red-200/80">
          <p className="mb-1 font-medium">This ledger cannot be imported — a history with a gap would be wrong from that day on:</p>
          {plan.blockers.map((b) => <p key={b}>{b}</p>)}
        </div>
      ) : null}

      <section className={box}>
        <p className="text-neutral-200">What changes</p>
        <ul className="mt-2 space-y-1 text-xs text-neutral-400">
          <li>
            <strong className="text-neutral-200">{plan.trades.length}</strong> trades recorded with their real dates, prices
            and commission
            {plan.replaced.length > 0 ? (
              <>
                , replacing{' '}
                {plan.replaced.map((r) => `${r.symbol} ${r.txnType} ${r.quantity ?? ''} on ${r.tradeDate}`).join('; ')} — the
                ledger is the full record for {plan.from} to {plan.to}
              </>
            ) : null}
            .
          </li>
          <li>
            <strong className="text-neutral-200">{plan.cash.length}</strong> cash movements — deposits, fees and dividends
            received — with their dates.
          </li>
          {plan.newSymbols.length > 0 ? (
            <li>
              Added as untracked companies, since you traded them: <strong className="text-neutral-200">{plan.newSymbols.join(', ')}</strong>.
              They join the ledger, not the screener.
            </li>
          ) : null}
          {plan.skipped.length > 0 ? <li className="text-amber-400/80">Not imported: {plan.skipped.join('; ')}</li> : null}
          <li>
            Bonus shares, rights and dividends already recorded are kept — a cash ledger does not show them.
          </li>
        </ul>
      </section>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={thead}>
              <th className={`${th} text-left`}>Symbol</th>
              <th className={`${th} text-right`}>Shares now</th>
              <th className={`${th} text-right`}>After import</th>
              <th className={`${th} text-left`} />
            </tr>
          </thead>
          <tbody>
            {plan.holdings.map((x) => (
              <tr key={x.symbol} className="border-b border-neutral-900 last:border-0">
                <td className={`${td} font-medium text-neutral-200`}>{x.symbol}</td>
                <td className={`${td} text-right tabular-nums text-neutral-500`}>{x.before.toLocaleString()}</td>
                <td className={`${td} text-right tabular-nums text-neutral-200`}>{x.after.toLocaleString()}</td>
                <td className={`${td} text-xs`}>
                  {x.before === x.after ? (
                    <span className="text-emerald-500">{x.after === 0 ? 'bought and sold' : 'same — history filled in'}</span>
                  ) : (
                    <span className="text-amber-400">changes — check nothing is missing, e.g. bonus shares</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Outcome
        result={result}
        pending={pending}
        disabled={blocked}
        label={changed.length > 0 ? 'Import anyway' : 'Import the history'}
      />
    </form>
  )
}

function AccountChoice({
  account,
  boId,
  suggested,
}: {
  account: { id: number; name: string } | null
  boId: string | null
  suggested: string
}) {
  return (
    <section className={box}>
      {account ? (
        <>
          <input type="hidden" name="accountId" value={account.id} />
          <p className="text-neutral-300">
            Matched by BO ID to <strong className="text-neutral-100">{account.name}</strong>.
          </p>
        </>
      ) : (
        <>
          <input type="hidden" name="boId" value={boId ?? ''} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-400">
              No BO account has this BO ID yet. Name the one that will be created:
            </span>
            <input
              name="newAccountName"
              defaultValue={suggested}
              autoComplete="off"
              className="w-full max-w-md rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
            />
          </label>
        </>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */

export function DividendReportReview({ preview }: { preview: DividendReportPreview }) {
  const [result, action, pending] = useActionState<ApplyResult | null, FormData>(applyDividendReport, null)
  const { header: h, dividends } = preview
  const recordable = dividends.filter((d) => d.symbol && !d.recorded)

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="accountId" value={preview.account.id} />
      <input type="hidden" name="broker" value={h.broker} />
      <input type="hidden" name="dividends" value={JSON.stringify(dividends)} />

      <Facts
        items={[
          ['Document', 'Cash dividend ledger'],
          ['Account', preview.account.name],
          ['BO ID', h.boIdLast4 ? `•••• ${h.boIdLast4}` : '—'],
          ['Period', `${h.from ?? '?'} → ${h.to ?? '?'}`],
        ]}
      />

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={thead}>
              <th className="w-10 px-3 py-2" />
              <th className={`${th} text-left`}>Company</th>
              <th className={`${th} text-left`}>Record date</th>
              <th className={`${th} text-right`}>Shares</th>
              <th className={`${th} text-right`}>Gross</th>
              <th className={`${th} text-right`}>Tax</th>
              <th className={`${th} text-right`}>Received</th>
              <th className={`${th} text-left`}>Paid</th>
            </tr>
          </thead>
          <tbody>
            {dividends.map((d) => (
              <tr key={d.key} className="border-b border-neutral-900 align-top last:border-0">
                <td className={td}>
                  {d.symbol && !d.recorded ? (
                    <input
                      type="checkbox"
                      name="dividend"
                      value={d.key}
                      defaultChecked={d.suggested}
                      aria-label={`Record ${d.companyName}`}
                      className="rounded border-neutral-700 bg-neutral-950"
                    />
                  ) : null}
                </td>
                <td className={td}>
                  <span className="font-medium text-neutral-200">{d.symbol ?? d.companyName}</span>
                  {d.recorded ? <span className="block text-xs text-emerald-500">already recorded</span> : null}
                  {!d.symbol ? <span className="block text-xs text-amber-400/80">no matching company</span> : null}
                  {d.caveat ? <span className="block max-w-md text-xs text-amber-400/80">{d.caveat}</span> : null}
                </td>
                <td className={`${td} text-xs text-neutral-400`}>{d.recordDate}</td>
                <td className={`${td} text-right tabular-nums text-neutral-300`}>
                  {d.holding}
                  {d.ledgerHolding === d.holding ? <span className="block text-xs text-emerald-500/80">matches ledger</span> : null}
                </td>
                <td className={`${td} text-right tabular-nums text-neutral-200`}>{taka(d.gross)}</td>
                <td className={`${td} text-right tabular-nums text-neutral-500`}>{taka(d.taxWithheld)}</td>
                <td className={`${td} text-right tabular-nums text-emerald-500`}>{taka(d.gross - d.taxWithheld)}</td>
                <td className={`${td} text-xs text-neutral-400`}>
                  {d.paidVia === 'broker' ? `${d.date}, via broker` : 'outside the broker'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Outcome result={result} pending={pending} disabled={recordable.length === 0} label="Record ticked dividends" />
    </form>
  )
}

/* -------------------------------------------------------------------------- */

export function PnlReview({ preview }: { preview: PnlPreview }) {
  const complete = preview.rows.length > 0 && preview.rows.every((r) => r.complete)
  const gap = Math.abs(preview.total.broker - preview.total.ledger)

  return (
    <div className="space-y-5">
      <Facts
        items={[
          ['Document', 'Profit/loss analysis'],
          ['Account', preview.account?.name ?? '—'],
          ['BO ID', preview.header.boIdLast4 ? `•••• ${preview.header.boIdLast4}` : '—'],
          ['Period', `${preview.header.from ?? '?'} → ${preview.header.to ?? '?'}`],
        ]}
      />

      <p className={`rounded border px-4 py-2.5 text-sm ${complete && gap < 1 ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-200/90' : 'border-amber-900/60 bg-amber-950/30 text-amber-200/80'}`}>
        {preview.message}{' '}
        {preview.account
          ? complete
            ? gap < 1
              ? `Every trade is accounted for, and the realised gain agrees: ${taka(preview.total.ledger)}.`
              : `Every trade is accounted for. Realised gain here ${taka(preview.total.ledger)}, broker ${taka(preview.total.broker)}.`
            : 'Some quantities differ — a trade is missing from the history, or the periods differ. Import the ledger for the same period.'
          : null}
        {' '}Nothing from this report is recorded; it is a check.
      </p>

      {preview.rows.length > 0 ? (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className={thead}>
                <th className={`${th} text-left`}>Company</th>
                <th className={`${th} text-right`}>Bought</th>
                <th className={`${th} text-right`}>Sold</th>
                <th className={`${th} text-right`}>Broker&apos;s gain</th>
                <th className={`${th} text-right`}>Gain here</th>
                <th className={`${th} text-left`} />
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.companyName} className="border-b border-neutral-900 last:border-0">
                  <td className={td}>
                    <span className="text-neutral-200">{r.symbol ?? r.companyName}</span>
                    {r.symbol ? <span className="ml-2 text-xs text-neutral-600">{r.companyName}</span> : null}
                  </td>
                  <td className={`${td} text-right tabular-nums text-neutral-400`}>
                    {r.broker.buyQty}
                    {r.ledger && r.ledger.buyQty !== r.broker.buyQty ? <span className="text-amber-400"> / {r.ledger.buyQty}</span> : null}
                  </td>
                  <td className={`${td} text-right tabular-nums text-neutral-400`}>
                    {r.broker.saleQty}
                    {r.ledger && r.ledger.saleQty !== r.broker.saleQty ? <span className="text-amber-400"> / {r.ledger.saleQty}</span> : null}
                  </td>
                  <td className={`${td} text-right tabular-nums text-neutral-300`}>{taka(r.broker.profit)}</td>
                  <td className={`${td} text-right tabular-nums text-neutral-200`}>{taka(r.ledger?.profit)}</td>
                  <td className={`${td} text-xs`}>
                    {r.complete ? <span className="text-emerald-500">complete</span> : <span className="text-amber-400">missing trades</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
