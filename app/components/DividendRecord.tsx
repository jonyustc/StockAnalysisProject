import { dividendYield, type DividendRecord } from '@/lib/dividend-record'
import { formatBDT, formatPercent, formatPerShare } from '@/lib/units'

/**
 * A company's record of cash dividends: what it declared, when, and what that
 * would be worth against today's price and against what you paid.
 *
 * Years are calendar years of the ex-date — the date the dividend stops
 * travelling with the share — because that is what the announcements state.
 * A year with two entries had an interim and a final.
 */
export function DividendRecordSection({
  record,
  price,
  netCostPerShare,
  quantity,
}: {
  record: DividendRecord
  price: number | null | undefined
  /** Average cost after dividends already received, when you hold it. */
  netCostPerShare: number | null
  quantity: number
}) {
  const { latest, years } = record
  if (!latest || years.length === 0) return null

  const recent = years.slice(0, 10)
  const older = years.slice(10)
  const lastFull = years[0]
  const onPrice = dividendYield(lastFull.total, price)
  const onCost = netCostPerShare !== null && netCostPerShare > 0 ? dividendYield(lastFull.total, netCostPerShare) : null
  const income = quantity > 0 ? lastFull.total * quantity : null

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-neutral-300">Dividends declared</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Paid in {record.paidYears} of the {record.spanYears} years on record
          {record.streak > 1 ? `, ${record.streak} of them unbroken` : ''}. Grouped by the calendar year of the ex-date,
          so a year with two entries paid an interim and a final. These are the company&apos;s announcements — what
          reached your account is in the portfolio ledger.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
        <Stat label={`${lastFull.year} dividend`} value={formatPerShare(lastFull.total)} sub={`ex ${latest.exDate}`} />
        <Stat
          label="Yield at today's price"
          value={onPrice === null ? '—' : formatPercent(onPrice, 2)}
          sub={price ? `on ${formatPerShare(price)}` : 'no price stored'}
        />
        <Stat
          label="Yield on your cost"
          value={onCost === null ? '—' : formatPercent(onCost, 2)}
          sub={netCostPerShare !== null && netCostPerShare > 0 ? `on ${formatPerShare(netCostPerShare)} net` : 'not held'}
        />
        <Stat
          label="At that rate"
          value={income === null ? '—' : formatBDT(income)}
          sub={income === null ? 'not held' : `on ${quantity.toLocaleString()} shares, a year`}
        />
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900/50 text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2 text-left font-medium">Year</th>
              <th className="px-3 py-2 text-right font-medium">Dividend</th>
              <th className="px-3 py-2 text-right font-medium">Change</th>
              <th className="px-3 py-2 text-left font-medium">Payments</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((year, at) => (
              <YearRow key={year.year} year={year} prior={recent[at + 1] ?? older[0]} />
            ))}
          </tbody>
        </table>
        {older.length > 0 ? (
          <details className="border-t border-neutral-800">
            <summary className="cursor-pointer px-3 py-2 text-xs text-neutral-500 hover:text-neutral-300">
              {older.length} earlier year{older.length === 1 ? '' : 's'}, back to {older[older.length - 1].year}
            </summary>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {older.map((year, at) => (
                  <YearRow key={year.year} year={year} prior={older[at + 1]} />
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </div>

      {record.restatedInside || years.some((year) => year.restated) ? (
        <p className="text-xs text-amber-200/70">
          Figures marked <span className="text-amber-400">*</span> came in restated for later bonus issues, so they are
          not what the company declared that year — read them as approximate, and do not read a change against them as
          the dividend having moved.
        </p>
      ) : null}
    </section>
  )
}

function YearRow({ year, prior }: { year: { year: number; total: number; count: number; restated: boolean }; prior?: { year: number; total: number; restated: boolean } }) {
  // A change is only worth showing between consecutive years that were both
  // declared as they stand; against a restated figure it measures the source's
  // arithmetic rather than the dividend.
  const comparable = prior && prior.year === year.year - 1 && prior.total > 0 && !prior.restated && !year.restated
  const change = comparable ? year.total / prior.total - 1 : null

  return (
    <tr className="border-b border-neutral-900 last:border-0">
      <td className="px-3 py-1.5 tabular-nums text-neutral-400">{year.year}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-100">
        {formatPerShare(year.total)}
        {year.restated ? <span className="text-amber-400"> *</span> : null}
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums text-xs ${
          change === null ? 'text-neutral-600' : change >= 0 ? 'text-emerald-500' : 'text-red-400'
        }`}
      >
        {change === null ? '—' : formatPercent(change, 1, true)}
      </td>
      <td className="px-3 py-1.5 text-xs text-neutral-500">{year.count === 1 ? 'one' : `${year.count} in the year`}</td>
    </tr>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-neutral-950 px-3 py-2.5">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-100">{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  )
}
