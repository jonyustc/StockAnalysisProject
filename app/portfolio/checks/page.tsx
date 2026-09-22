import Link from 'next/link'

import {
  listAccountSnapshots,
  listBoAccounts,
  listCashMovements,
  listLedgerImports,
  listPortfolioTransactions,
} from '@/db/queries'
import { checkAccount, type Check } from '@/lib/checks'
import { formatTradeDate } from '@/lib/trading-calendar'

import { PortfolioNav, ROW, TD, TH, THEAD_ROW } from '../ui'

export const dynamic = 'force-dynamic'

const money = (v: number | null) =>
  v === null ? '—' : `৳${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function ChecksPage() {
  const [accounts, snapshots, transactions, movements, ledgers] = await Promise.all([
    listBoAccounts(),
    listAccountSnapshots(),
    listPortfolioTransactions(),
    listCashMovements(),
    listLedgerImports(),
  ])

  const results = accounts.map((account) => {
    const latest = snapshots.filter((s) => s.accountId === account.id).at(-1)
    if (!latest) return { account, result: null }
    return {
      account,
      result: checkAccount({
        snapshot: latest,
        transactions: transactions.filter((t) => t.accountId === account.id),
        movements: movements.filter((m) => m.accountId === account.id),
        ledgers: ledgers.filter((l) => l.accountId === account.id),
      }),
    }
  })

  const all = results.flatMap((r) => (r.result ? [...r.result.holdings, ...r.result.account] : []))
  const failed = all.filter((c) => c.ok === false).length
  const unchecked = all.filter((c) => c.ok === null).length
  const passed = all.filter((c) => c.ok === true).length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">Checks</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          Every figure worked out twice — from the ledger kept here, and as the broker printed it
          on the account&apos;s latest statement — and compared. When they agree, the history is
          complete and everything built on it starts from the right numbers. Nothing here changes
          any data.
        </p>
      </header>

      <PortfolioNav current="checks" />

      <p
        className={`rounded border px-4 py-3 text-sm ${
          failed > 0
            ? 'border-red-900/60 bg-red-950/30 text-red-200'
            : unchecked > 0
              ? 'border-amber-900/60 bg-amber-950/30 text-amber-200/90'
              : 'border-emerald-900/60 bg-emerald-950/20 text-emerald-200/90'
        }`}
      >
        {failed > 0
          ? `${failed} check${failed === 1 ? '' : 's'} disagree with the broker — see below for which figure, and why it might.`
          : unchecked > 0
            ? `${passed} checks agree; ${unchecked} cannot be checked yet — see below for what is needed.`
            : `All ${passed} checks agree with the broker (to within a paisa of rounding).`}
      </p>

      {results.map(({ account, result }) => (
        <section key={account.id} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-neutral-300">{account.name}</h2>
            {result ? (
              <p className="text-xs text-neutral-500">Against the statement of {formatTradeDate(result.asOf)}</p>
            ) : null}
          </div>

          {!result ? (
            <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-xs text-neutral-500">
              No statement imported for this account yet —{' '}
              <Link href="/portfolio/import" className="text-sky-400 hover:text-sky-300">import one</Link> to check against.
            </p>
          ) : (
            <>
              <p className={`text-xs ${result.complete ? 'text-neutral-500' : 'text-amber-400/80'}`}>{result.coverage}</p>
              <div className="overflow-x-auto rounded border border-neutral-800">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={`${TH} w-8`} />
                      <th className={`${TH} text-left`}>Figure</th>
                      <th className={`${TH} text-right`}>Here</th>
                      <th className={`${TH} text-right`}>Broker</th>
                      <th className={`${TH} text-left`} />
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.holdings, ...result.account].map((c) => (
                      <Row key={c.label} check={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ))}

      <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 text-xs text-neutral-500">
        <p className="text-sm text-neutral-300">Keeping these green</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Import each account&apos;s client ledger from the day it opened, then a newer one every month or so — overlapping periods are fine.</li>
          <li>Import the latest portfolio statement after it, so both describe the same day.</li>
          <li>Import the cash dividend report when a dividend is paid.</li>
          <li>A red row names the figure that differs; the ledger import preview shows exactly what an import will replace.</li>
        </ul>
      </section>
    </div>
  )
}

function Row({ check: c }: { check: Check }) {
  const show = (v: number | null) => (c.format === 'shares' ? (v === null ? '—' : v.toLocaleString()) : money(v))
  return (
    <tr className={ROW}>
      <td className={`${TD} text-center`}>
        {c.ok === true ? (
          <span className="text-emerald-500" aria-label="agrees">✓</span>
        ) : c.ok === false ? (
          <span className="text-red-400" aria-label="differs">✗</span>
        ) : (
          <span className="text-neutral-600" aria-label="not checked">–</span>
        )}
      </td>
      <td className={`${TD} text-neutral-300`}>{c.label}</td>
      <td className={`${TD} text-right tabular-nums text-neutral-200`}>{show(c.ours)}</td>
      <td className={`${TD} text-right tabular-nums text-neutral-400`}>{show(c.broker)}</td>
      <td className={`${TD} text-xs ${c.ok === false ? 'text-red-300/80' : 'text-neutral-500'}`}>{c.detail}</td>
    </tr>
  )
}
