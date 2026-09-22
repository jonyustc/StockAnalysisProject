import Link from 'next/link'

/** Shared pieces of the portfolio pages. */

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad'
}) {
  const colour =
    tone === 'good' ? 'text-emerald-500' : tone === 'bad' ? 'text-red-400' : 'text-neutral-100'

  return (
    <div className="bg-neutral-950 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-0.5 text-lg font-medium ${colour}`}>{value}</p>
      {sub ? <p className="text-xs text-neutral-600">{sub}</p> : null}
    </div>
  )
}

export function FilterLink({
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

/** The account chips, when there is more than one account to choose from. */
export function AccountFilter({
  basePath,
  accounts,
  selectedId,
}: {
  basePath: string
  accounts: { id: number; name: string }[]
  selectedId: number | null
}) {
  if (accounts.length < 2) return null
  return (
    <nav className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-600">Account:</span>
      <FilterLink href={basePath} active={selectedId === null}>
        All
      </FilterLink>
      {accounts.map((account) => (
        <FilterLink
          key={account.id}
          href={`${basePath}?account=${account.id}`}
          active={selectedId === account.id}
        >
          {account.name}
        </FilterLink>
      ))}
    </nav>
  )
}

/** The portfolio section tabs. */
export function PortfolioNav({ current }: { current: 'holdings' | 'trading' | 'dividends' | 'cash' | 'checks' }) {
  const tabs = [
    { key: 'holdings', href: '/portfolio', label: 'Holdings' },
    { key: 'trading', href: '/portfolio/trading', label: 'Trading' },
    { key: 'dividends', href: '/portfolio/dividends', label: 'Dividends' },
    { key: 'cash', href: '/portfolio/cash', label: 'Cash & withdrawals' },
    { key: 'checks', href: '/portfolio/checks', label: 'Checks' },
  ] as const
  return (
    <nav className="flex gap-1 border-b border-neutral-800 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-3 py-1.5 ${
            current === tab.key
              ? 'border-sky-500 text-neutral-100'
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

export const TH = 'px-3 py-2 font-medium'
export const THEAD_ROW =
  'border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500'
export const TD = 'px-3 py-2'
export const ROW = 'border-b border-neutral-900 last:border-0'
