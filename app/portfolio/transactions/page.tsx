import Link from 'next/link'

import { listBoAccounts, listPortfolioTransactions, listTrackedCompanies } from '@/db/queries'
import { cashFlowOf } from '@/lib/portfolio'
import { formatBDT } from '@/lib/units'

import { deleteTransaction } from '../actions'
import { AccountForm } from './AccountForm'
import { TransactionForm } from './TransactionForm'

export const dynamic = 'force-dynamic'

const TYPE_STYLE: Record<string, string> = {
  buy: 'text-sky-400',
  sell: 'text-amber-400',
  bonus: 'text-emerald-500',
  rights: 'text-violet-400',
  dividend: 'text-neutral-400',
}

/** Show enough of a BO ID to recognise it, not enough to be worth copying. */
function maskBoNumber(value: string | null): string | null {
  return value ? `•••• ${value.slice(-4)}` : null
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const accountParam = Number(Array.isArray(params.account) ? params.account[0] : params.account)

  const [allTransactions, companies, accounts] = await Promise.all([
    listPortfolioTransactions(),
    listTrackedCompanies(),
    listBoAccounts(),
  ])

  const selected = accounts.find((a) => a.id === accountParam) ?? null
  const transactions = selected
    ? allTransactions.filter((t) => t.accountId === selected.id)
    : allTransactions

  const countByAccount = new Map<number, number>()
  for (const txn of allTransactions) {
    countByAccount.set(txn.accountId, (countByAccount.get(txn.accountId) ?? 0) + 1)
  }

  const activeAccounts = accounts.filter((a) => a.isActive)

  return (
    <div className="space-y-6">
      <header>
        <Link href="/portfolio" className="text-xs text-neutral-500 hover:text-neutral-300">
          ← Portfolio
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-100">Transactions</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {allTransactions.length} recorded across {accounts.length} BO account
          {accounts.length === 1 ? '' : 's'}. This ledger is the only stored truth — quantity and
          average cost are computed from it, separately for each account.
        </p>
      </header>

      <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          BO accounts
        </h2>

        {accounts.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs"
              >
                <span className="font-medium text-neutral-200">{account.name}</span>
                {account.broker ? <span className="ml-2 text-neutral-500">{account.broker}</span> : null}
                {account.boNumber ? (
                  <span className="ml-2 font-mono text-neutral-600">
                    {maskBoNumber(account.boNumber)}
                  </span>
                ) : null}
                <span className="ml-2 text-neutral-600">
                  {countByAccount.get(account.id) ?? 0} txn
                </span>
                {!account.isActive ? <span className="ml-2 text-neutral-600">inactive</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <AccountForm />
      </section>

      <TransactionForm
        symbols={companies.map((c) => c.dseSymbol)}
        accounts={activeAccounts.map((a) => ({ id: a.id, name: a.name }))}
        defaultAccountId={selected?.id}
      />

      {accounts.length > 1 ? (
        <nav className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-600">Show:</span>
          <FilterLink href="/portfolio/transactions" active={!selected}>
            All accounts
          </FilterLink>
          {accounts.map((account) => (
            <FilterLink
              key={account.id}
              href={`/portfolio/transactions?account=${account.id}`}
              active={selected?.id === account.id}
            >
              {account.name}
            </FilterLink>
          ))}
        </nav>
      ) : null}

      {transactions.length > 0 ? (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-left font-medium">Symbol</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Costs</th>
                <th className="px-3 py-2 text-right font-medium">Cash</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => {
                const cash = cashFlowOf(txn)

                return (
                  <tr key={txn.id} className="border-b border-neutral-900 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                      {txn.tradeDate}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-400">{txn.accountName}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/companies/${txn.symbol}`}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {txn.symbol}
                      </Link>
                    </td>
                    <td className={`px-3 py-2 ${TYPE_STYLE[txn.txnType] ?? ''}`}>
                      {txn.txnType}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                      {txn.quantity === null ? '—' : txn.quantity.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                      {txn.pricePerShare === null
                        ? '—'
                        : txn.pricePerShare === 0
                          ? 'free'
                          : `৳${txn.pricePerShare.toFixed(2)}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                      {txn.commission + txn.taxWithheld === 0
                        ? '—'
                        : formatBDT(txn.commission + txn.taxWithheld)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        cash > 0 ? 'text-emerald-500' : cash < 0 ? 'text-neutral-300' : 'text-neutral-600'
                      }`}
                    >
                      {cash === 0 ? '—' : formatBDT(cash)}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 text-xs text-neutral-600">
                      {txn.notes}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <form action={deleteTransaction}>
                        <input type="hidden" name="id" value={txn.id} />
                        <button
                          type="submit"
                          className="text-xs text-neutral-700 hover:text-red-400"
                          title="Delete this entry"
                        >
                          delete
                        </button>
                      </form>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : allTransactions.length > 0 ? (
        <p className="text-sm text-neutral-500">No transactions in this account yet.</p>
      ) : null}
    </div>
  )
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-2.5 py-0.5 ${
        active
          ? 'border-sky-700 text-sky-300'
          : 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
      }`}
    >
      {children}
    </Link>
  )
}
