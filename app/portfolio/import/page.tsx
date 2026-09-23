import Link from 'next/link'

import { listCompanyNames } from '@/db/queries'

import { DseFetch } from './DseFetch'
import { PasteDividends } from './PasteDividends'
import { ImportForm } from './ImportForm'

export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const companies = await listCompanyNames()
  return (
    <div className="space-y-6">
      <header>
        <Link href="/portfolio" className="text-xs text-neutral-500 hover:text-neutral-300">
          ← Portfolio
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-100">Import</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          Broker documents and price history, in one place. Whatever the file is, it is read,
          compared and shown to you before anything is written.
        </p>
        <ul className="mt-3 max-w-3xl list-disc space-y-1 pl-4 text-xs text-neutral-500">
          <li>
            <strong className="font-medium text-neutral-400">Portfolio statement</strong> — a snapshot,
            not a history, so it never overwrites the ledger: it sets up your positions the first
            time, then proposes transactions for whatever differs.
          </li>
          <li>
            <strong className="font-medium text-neutral-400">Client ledger</strong> — every trade with
            its real price and commission, plus dated deposits, withdrawals and fees.
          </li>
          <li>
            <strong className="font-medium text-neutral-400">Cash dividend ledger</strong> — dividends
            with the tax withheld. <strong className="font-medium text-neutral-400">Profit/loss
            analysis</strong> — a check that no trade is missing.
          </li>
          <li>
            <strong className="font-medium text-neutral-400">Price history (CSV)</strong> — daily
            closes from DSE, investing.com or any other export: the years the valuation insights
            compare against. Columns are matched by meaning, so a file naming its close &ldquo;Price&rdquo;
            and its volume &ldquo;1.02M&rdquo; reads as well as DSE&apos;s own. A file that does not name its
            stock takes the one chosen beside it. A day already stored is replaced, never duplicated.
          </li>
        </ul>
        <p className="mt-2 text-xs text-neutral-600">
          Supports LankaBangla Securities&apos; documents; price files from any source.
        </p>
      </header>

      <ImportForm symbols={companies.map((c) => c.symbol).sort()} />

      <section className="space-y-2 border-t border-neutral-800 pt-6">
        <h2 className="text-sm font-medium text-neutral-300">Or fetch price history from DSE</h2>
        <p className="max-w-3xl text-xs text-neutral-500">
          The exchange publishes day-end prices for every stock. Fetching them here saves downloading a file, and the
          preview is the same one a CSV gives.
        </p>
        <DseFetch symbols={companies.map((c) => c.symbol).sort()} />
      </section>

      <section className="space-y-2 border-t border-neutral-800 pt-6">
        <h2 className="text-sm font-medium text-neutral-300">Or paste a dividend history</h2>
        <p className="max-w-3xl text-xs text-neutral-500">
          Dividends a company has announced, going back further than the years you have entered by hand. Copy the table
          from wherever it is published and paste it — markup and all.
        </p>
        <PasteDividends symbols={companies.map((c) => c.symbol).sort()} />
      </section>
    </div>
  )
}
