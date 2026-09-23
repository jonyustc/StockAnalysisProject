'use client'

import { useActionState, useState } from 'react'

import {
  applyStatement,
  previewStatement,
  type ApplyResult,
  type ImportPreview,
  type StatementPreview,
} from './actions'
import { PricesReview } from './PricesReview'
import { DividendReportReview, LedgerReview, PnlReview } from './ReportReviews'

const KIND: Record<string, { label: string; className: string }> = {
  opening: { label: 'new position', className: 'text-sky-400' },
  increase: { label: 'more shares', className: 'text-amber-400' },
  decrease: { label: 'fewer shares', className: 'text-amber-400' },
  exit: { label: 'gone', className: 'text-red-400' },
  match: { label: 'matches', className: 'text-emerald-500' },
}

function taka(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `৳${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ImportForm() {
  const [result, previewAction, reading] = useActionState<ImportPreview | null, FormData>(
    previewStatement,
    null,
  )
  // Ledgers and reports have their own review; a portfolio statement uses the
  // one below.
  const [fileName, setFileName] = useState('')
  const report = result?.ok && result.kind && result.kind !== 'portfolio' ? result : null
  const preview = report ? null : (result as StatementPreview | null)
  const [applied, applyAction, applying] = useActionState<ApplyResult | null, FormData>(
    applyStatement,
    null,
  )

  const s = preview?.ok ? preview.statement : undefined
  const suggestions = preview?.suggestions ?? []
  const actionable = suggestions.filter((x) => x.proposed && x.tracked)

  const plan = actionable.map((x) => ({
    symbol: x.symbol,
    txnType: x.proposed!.txnType,
    quantity: x.proposed!.quantity,
    pricePerShare: x.proposed!.pricePerShare,
    expectedLedgerQty: x.ledgerQty,
    kind: x.kind,
  }))

  const holdingIssues = s?.holdings.filter((h) => h.issues.length > 0) ?? []
  const dividends = preview?.dividends ?? []
  const recordableDividends = dividends.filter((d) => d.symbol && !d.recorded)

  return (
    <div className="space-y-6">
      <form
        action={previewAction}
        className="flex flex-wrap items-center gap-3 rounded border border-neutral-800 bg-neutral-900/40 p-4"
      >
        <input
          type="file"
          name="statement"
          accept="application/pdf,.pdf,text/csv,.csv,.txt"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
          required
          className="text-sm text-neutral-300 file:mr-3 file:rounded file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-sm file:text-neutral-200 hover:file:bg-neutral-700"
        />
        <button
          type="submit"
          disabled={reading}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {reading ? 'Reading…' : 'Read file'}
        </button>
        <p className="w-full text-xs text-neutral-600">
          A broker PDF — portfolio statement, client ledger, cash dividend ledger or profit/loss
          analysis — or a CSV of historical daily prices. Which one it is comes from the file
          itself, not its name. Nothing is recorded yet: this only compares. The file is read in
          memory and discarded; it is never stored.
        </p>
      </form>

      {report?.kind === 'prices' ? <PricesReview key={report.message} preview={report} fileName={fileName} /> : null}
      {report?.kind === 'ledger' ? <LedgerReview key={report.message + report.header.to} preview={report} /> : null}
      {report?.kind === 'dividends' ? <DividendReportReview key={report.message} preview={report} /> : null}
      {report?.kind === 'pnl' ? <PnlReview preview={report} /> : null}

      {preview && !preview.ok ? (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-sm text-red-300">
          {preview.message}
        </p>
      ) : null}

      {s && preview ? (
        <form action={applyAction} className="space-y-5">
          <input type="hidden" name="asOf" value={s.asOf} />
          <input type="hidden" name="broker" value={s.broker} />
          <input type="hidden" name="rows" value={JSON.stringify(plan)} />
          {preview.snapshot ? (
            <input type="hidden" name="snapshot" value={JSON.stringify(preview.snapshot)} />
          ) : null}

          <section className="grid gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
            <Fact label="Broker" value={s.broker} />
            <Fact label="Client code" value={`${s.clientCode ?? '—'} · ${s.accountType ?? ''}`} />
            <Fact label="BO ID" value={s.boIdLast4 ? `•••• ${s.boIdLast4}` : '—'} />
            <Fact label="As on" value={s.asOf} />
            <Fact label="Cost" value={taka(s.totals?.costAmount)} />
            <Fact label="Market value" value={taka(s.totals?.marketValue)} />
            <Fact label="Unrealised" value={taka(s.totals?.unrealised)} />
            <Fact label="Cash balance" value={taka(s.cashBalance)} />
          </section>

          {preview.lifetime ? (
            <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
              <p className="text-neutral-300">
                Lifetime return on this account:{' '}
                <strong
                  className={
                    (preview.lifetime.totalReturn ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'
                  }
                >
                  {preview.lifetime.totalReturn === null
                    ? '—'
                    : `${(preview.lifetime.totalReturn * 100).toFixed(2)}%`}
                </strong>{' '}
                <span className="text-neutral-500">
                  ({taka(preview.lifetime.gain)} on {taka(preview.lifetime.moneyIn)} deposited)
                </span>
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Realised {taka(preview.lifetime.realised)} · dividends {taka(preview.lifetime.dividends)}
                {preview.lifetime.unrealised !== null ? ` · unrealised ${taka(preview.lifetime.unrealised)}` : ''}
                {preview.lifetime.unexplained !== null && Math.abs(preview.lifetime.unexplained) >= 1
                  ? ` · ${taka(preview.lifetime.unexplained)} not explained by any line — usually account charges`
                  : ''}
              </p>
            </section>
          ) : null}

          <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
            {preview.account ? (
              <>
                <input type="hidden" name="accountId" value={preview.account.id} />
                <p className="text-neutral-300">
                  Matched by BO ID to <strong className="text-neutral-100">{preview.account.name}</strong>.
                </p>
              </>
            ) : (
              <>
                <input type="hidden" name="boId" value={preview.boId ?? ''} />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-400">
                    No BO account has this BO ID yet. Name the one that will be created:
                  </span>
                  <input
                    name="newAccountName"
                    defaultValue={preview.suggestedAccountName}
                    autoComplete="off"
                    className="w-full max-w-md rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
                  />
                </label>
                <p className="mt-1 text-xs text-neutral-600">
                  The BO ID is stored so next time this statement matches itself. It is included in
                  the nightly backup on your private repo.
                </p>
              </>
            )}
          </section>

          {s.issues.length > 0 || holdingIssues.length > 0 ? (
            <div className="rounded border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-xs text-red-200/80">
              <p className="mb-1 font-medium">These did not add up and will not be imported:</p>
              {s.issues.map((issue) => <p key={issue}>{issue}</p>)}
              {holdingIssues.map((h) => (
                <p key={h.symbol}>{h.symbol}: {h.issues.join('; ')}</p>
              ))}
            </div>
          ) : null}

          {preview.untracked && preview.untracked.length > 0 ? (
            <p className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
              Not tracked here yet, so they cannot be recorded: {preview.untracked.join(', ')}. Add
              the company first.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-right font-medium">Statement</th>
                  <th className="px-3 py-2 text-right font-medium">Ledger</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((x) => {
                  const kind = KIND[x.kind]
                  const canRecord = Boolean(x.proposed) && x.tracked
                  return (
                    <tr key={x.symbol} className="border-b border-neutral-900 align-top last:border-0">
                      <td className="px-3 py-2">
                        {canRecord ? (
                          <input
                            type="checkbox"
                            name="selected"
                            value={x.symbol}
                            defaultChecked={x.selected}
                            aria-label={`Record ${x.symbol}`}
                            className="rounded border-neutral-700 bg-neutral-950"
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-medium text-neutral-200">{x.symbol}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                        {x.statementQty.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                        {x.ledgerQty.toLocaleString()}
                      </td>
                      <td className={`px-3 py-2 text-xs ${kind.className}`}>{kind.label}</td>
                      <td className="px-3 py-2 text-xs text-neutral-400">
                        <p>{x.note}</p>
                        {x.proposed ? (
                          <p className="mt-0.5 font-mono text-neutral-500">
                            {x.proposed.txnType} {x.proposed.quantity} @ ৳{x.proposed.pricePerShare.toFixed(4)}
                          </p>
                        ) : null}
                        {x.caveat ? <p className="mt-0.5 text-amber-400/80">{x.caveat}</p> : null}
                        {!x.tracked ? <p className="mt-0.5 text-amber-400/80">Not a tracked company.</p> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <input type="hidden" name="dividends" value={JSON.stringify(dividends)} />
          {dividends.length > 0 ? (
            <section className="rounded border border-emerald-900/60 bg-emerald-950/20 p-4 text-sm">
              <p className="text-neutral-200">
                Dividends paid since the {preview.previousAsOf} statement
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Declared on that statement, gone from this one, and the account&apos;s dividend total
                rose to match. The tax is inferred from how much actually arrived.
              </p>
              <ul className="mt-3 space-y-2">
                {dividends.map((d) => (
                  <li key={d.key} className="flex items-start gap-3">
                    {d.symbol && !d.recorded ? (
                      <input
                        type="checkbox"
                        name="dividend"
                        value={d.key}
                        defaultChecked={!d.caveat}
                        aria-label={`Record ${d.companyName} dividend`}
                        className="mt-1 rounded border-neutral-700 bg-neutral-950"
                      />
                    ) : (
                      <span className="mt-1 w-3.25" />
                    )}
                    <div className="text-xs">
                      <p className="text-neutral-300">
                        <strong className="font-medium text-neutral-100">{d.symbol ?? d.companyName}</strong>{' '}
                        {taka(d.gross)} gross · {taka(d.taxWithheld)} tax ·{' '}
                        {taka(d.gross - d.taxWithheld)} received
                        <span className="text-neutral-500"> · record date {d.recordDate ?? '?'}</span>
                      </p>
                      {d.recorded ? <p className="text-emerald-500/80">Already in the ledger.</p> : null}
                      {!d.symbol ? (
                        <p className="text-amber-400/80">No tracked company matches this name, so it cannot be recorded.</p>
                      ) : null}
                      {d.caveat ? <p className="text-amber-400/80">{d.caveat}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {(preview.unexplainedDividendCash ?? 0) >= 0.01 ? (
            <p className="rounded border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200/80">
              {taka(preview.unexplainedDividendCash)} of dividends arrived since the{' '}
              {preview.previousAsOf} statement that no declared dividend explains — declared and paid
              between two imports. Record it on the transactions page so it counts towards the stock.
            </p>
          ) : null}

          {s.dividendsReceivable.length > 0 ? (
            <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-400">
              Declared but not yet paid:{' '}
              {s.dividendsReceivable
                .map((d) => `${d.companyName} ${taka(d.entitlement)} (record date ${d.recordDate ?? '?'})`)
                .join('; ')}
              . Saved with the snapshot: the dividends page lists it, and a later import offers to
              record it once it has been paid.
            </p>
          ) : null}

          <div className="flex items-center gap-4 border-t border-neutral-800 pt-4">
            <button
              type="submit"
              disabled={
                applying ||
                (actionable.length === 0 && recordableDividends.length === 0 && !preview.snapshot)
              }
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {applying
                ? 'Saving…'
                : actionable.length > 0 || recordableDividends.length > 0
                  ? 'Record ticked rows and save snapshot'
                  : 'Save snapshot'}
            </button>
            {applied ? (
              <p className={`text-sm ${applied.ok ? 'text-emerald-500' : 'text-red-400'}`}>
                {applied.message}
              </p>
            ) : actionable.length === 0 && recordableDividends.length === 0 ? (
              <p className="text-xs text-neutral-600">
                Holdings already agree with the ledger. Saving still records today&apos;s account
                snapshot, which is what yearly returns are built from.
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-950 px-4 py-2.5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-0.5 text-sm text-neutral-200">{value}</p>
    </div>
  )
}
