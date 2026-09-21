import Link from 'next/link'

import { listPortfolioTransactions, listTrackedCompanies } from '@/db/queries'
import { cashFlowOf } from '@/lib/portfolio'
import { formatBDT } from '@/lib/units'

import { deleteTransaction } from '../actions'
import { TransactionForm } from './TransactionForm'

export const dynamic = 'force-dynamic'

const TYPE_STYLE: Record<string, string> = {
  buy: 'text-sky-400',
  sell: 'text-amber-400',
  bonus: 'text-emerald-500',
  rights: 'text-violet-400',
  dividend: 'text-neutral-400',
}

export default async function TransactionsPage() {
  const [transactions, companies] = await Promise.all([
    listPortfolioTransactions(),
    listTrackedCompanies(),
  ])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/portfolio" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← Portfolio
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-100">Transactions</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {transactions.length} recorded. This ledger is the only stored truth — quantity and
            average cost are computed from it.
          </p>
        </div>
      </header>

      <TransactionForm symbols={companies.map((c) => c.dseSymbol)} />

      {transactions.length > 0 ? (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 text-left font-medium">Date</th>
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
      ) : null}
    </div>
  )
}
