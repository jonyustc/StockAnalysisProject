import Link from 'next/link'

import { ImportForm } from './ImportForm'

export const dynamic = 'force-dynamic'

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <header>
        <Link href="/portfolio" className="text-xs text-neutral-500 hover:text-neutral-300">
          ← Portfolio
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-100">Import a broker statement</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          A statement is a snapshot, not a history, so it never overwrites the ledger. The first
          time, it sets up your positions. After that, it checks the ledger against the broker and
          proposes transactions for anything that differs — you tick what to record. Supports
          LankaBangla Securities&apos; client portfolio statement.
        </p>
      </header>

      <ImportForm />
    </div>
  )
}
