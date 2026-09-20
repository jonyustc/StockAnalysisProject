'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import {
  applyFilters,
  EMPTY_FILTERS,
  sortRows,
  type Filters,
  type NumericField,
  type ScreenerRow,
  type SortField,
} from '@/lib/screener'
import { formatPercent, formatRatio } from '@/lib/units'

interface Column {
  field: SortField
  label: string
  title?: string
  render: (row: ScreenerRow) => React.ReactNode
  align?: 'left' | 'right'
}

/** Presets are the screens worth running often, not every screen possible. */
const PRESETS: { label: string; title: string; filters: Partial<Filters> }[] = [
  {
    label: 'Quality',
    title: 'ROE above 15% with debt under half of equity',
    filters: { ranges: { roe: { min: 0.15 }, debtToEquity: { max: 0.5 } } },
  },
  {
    label: 'Cash-backed',
    title: 'Operating cash flow at least as large as reported profit',
    filters: { ranges: { cashConversion: { min: 1 } } },
  },
  {
    label: 'Income',
    title: 'Dividend yield above 4%',
    filters: { ranges: { dividendYield: { min: 0.04 } } },
  },
  {
    label: 'Near 52w low',
    title: 'Trading in the bottom third of its 52-week range',
    filters: { ranges: { rangePosition: { max: 0.33 } } },
  },
]

export function ScreenerTable({ rows, sectors }: { rows: ScreenerRow[]; sectors: string[] }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<{ field: SortField; direction: 'asc' | 'desc' }>({
    field: 'symbol',
    direction: 'asc',
  })

  const visible = useMemo(
    () => sortRows(applyFilters(rows, filters), sort.field, sort.direction),
    [rows, filters, sort],
  )

  function setRange(field: NumericField, bound: 'min' | 'max', raw: string) {
    const parsed = raw.trim() === '' ? undefined : Number(raw)

    setFilters((current) => {
      const ranges = { ...current.ranges }

      if (parsed === undefined || Number.isNaN(parsed)) {
        const existing = { ...ranges[field] }
        delete existing[bound]
        if (Object.keys(existing).length === 0) delete ranges[field]
        else ranges[field] = existing
      } else {
        ranges[field] = { ...ranges[field], [bound]: parsed }
      }

      return { ...current, ranges }
    })
  }

  function toggleSort(field: SortField) {
    setSort((current) =>
      current.field === field
        ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : // Text ascends, numbers descend — "best first" is what you want on a
          // metric and A-Z is what you want on a name.
          { field, direction: field === 'symbol' || field === 'sector' ? 'asc' : 'desc' },
    )
  }

  const columns: Column[] = [
    { field: 'price', label: 'Price', render: (r) => fmt(r.price, (v) => `৳${v.toFixed(2)}`) },
    {
      field: 'changePct',
      label: 'Chg',
      render: (r) =>
        r.changePct === null ? (
          dash
        ) : (
          <span className={r.changePct >= 0 ? 'text-emerald-500' : 'text-red-400'}>
            {formatPercent(r.changePct, 2, true)}
          </span>
        ),
    },
    { field: 'pe', label: 'PE', title: 'Price / latest reported EPS', render: (r) => fmt(r.pe, formatRatio) },
    { field: 'pb', label: 'PB', title: 'Price / NAVPS', render: (r) => fmt(r.pb, formatRatio) },
    {
      field: 'dividendYield',
      label: 'Yield',
      title: 'Declared dividend per share / price',
      render: (r) => fmt(r.dividendYield, (v) => formatPercent(v, 2)),
    },
    {
      field: 'rangePosition',
      label: '52w',
      title: 'Where the price sits in its 52-week range',
      render: (r) => <RangeMeter position={r.rangePosition} aboveLow={r.aboveLow} />,
      align: 'left',
    },
    { field: 'roe', label: 'ROE', render: (r) => fmt(r.roe, (v) => formatPercent(v, 1)) },
    { field: 'roce', label: 'ROCE', render: (r) => fmt(r.roce, (v) => formatPercent(v, 1)) },
    {
      field: 'netMargin',
      label: 'Net margin',
      render: (r) => fmt(r.netMargin, (v) => formatPercent(v, 1)),
    },
    { field: 'debtToEquity', label: 'D/E', render: (r) => fmt(r.debtToEquity, formatRatio) },
    {
      field: 'cashConversion',
      label: 'Cash conv.',
      title: 'Operating cash flow / net profit. Under 1 for years on end is a warning.',
      render: (r) => fmt(r.cashConversion, formatRatio),
    },
    {
      field: 'revenueCagr',
      label: 'Rev CAGR',
      render: (r) => fmt(r.revenueCagr, (v) => formatPercent(v, 1)),
    },
    {
      field: 'epsCagr',
      label: 'EPS CAGR',
      render: (r) => fmt(r.epsCagr, (v) => formatPercent(v, 1)),
    },
    {
      field: 'yearsEntered',
      label: 'Years',
      title: 'Fiscal years of fundamentals entered',
      render: (r) =>
        r.yearsEntered === 0 ? (
          <span className="text-neutral-700">—</span>
        ) : (
          <span className="text-neutral-400">{r.yearsEntered}</span>
        ),
    },
  ]

  const activeFilterCount =
    Object.keys(filters.ranges).length +
    (filters.search ? 1 : 0) +
    (filters.sector ? 1 : 0) +
    (filters.withDataOnly ? 1 : 0)

  return (
    <div className="space-y-4">
      {/* One filter row above everything it scopes. */}
      <div className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filters.search}
            onChange={(e) => setFilters((c) => ({ ...c, search: e.target.value }))}
            placeholder="Search symbol or name"
            aria-label="Search symbol or name"
            className="w-56 rounded border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-600"
          />

          <select
            value={filters.sector ?? ''}
            onChange={(e) => setFilters((c) => ({ ...c, sector: e.target.value || null }))}
            aria-label="Sector"
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-600"
          >
            <option value="">All sectors</option>
            {sectors.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </select>

          <NumberFilter label="Max PE" onChange={(v) => setRange('pe', 'max', v)} />
          <NumberFilter label="Min ROE %" onChange={(v) => setRange('roe', 'min', pct(v))} />
          <NumberFilter label="Max D/E" onChange={(v) => setRange('debtToEquity', 'max', v)} />
          <NumberFilter
            label="Min yield %"
            onChange={(v) => setRange('dividendYield', 'min', pct(v))}
          />

          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={filters.withDataOnly}
              onChange={(e) => setFilters((c) => ({ ...c, withDataOnly: e.target.checked }))}
              className="rounded border-neutral-700 bg-neutral-950"
            />
            With data only
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-600">Presets:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              title={preset.title}
              onClick={() => setFilters({ ...EMPTY_FILTERS, ...preset.filters })}
              className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300 hover:border-sky-700 hover:text-sky-300"
            >
              {preset.label}
            </button>
          ))}

          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="ml-auto text-xs text-neutral-500 hover:text-neutral-300"
            >
              Reset {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        {visible.length} of {rows.length} companies
        {visible.length > 0 && visible[0].tradeDate ? ` · prices ${visible[0].tradeDate}` : ''}
      </p>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
              <Th
                field="symbol"
                label="Symbol"
                sort={sort}
                onSort={toggleSort}
                className="sticky left-0 z-10 bg-neutral-900 text-left"
              />
              {columns.map((column) => (
                <Th
                  key={column.field}
                  field={column.field}
                  label={column.label}
                  title={column.title}
                  sort={sort}
                  onSort={toggleSort}
                  className={column.align === 'left' ? 'text-left' : 'text-right'}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.symbol} className="group border-b border-neutral-900 last:border-0">
                <td className="sticky left-0 z-10 bg-neutral-950 px-3 py-2 group-hover:bg-neutral-900">
                  <Link
                    href={`/companies/${row.symbol}`}
                    className="font-medium text-sky-400 hover:text-sky-300"
                    title={row.name}
                  >
                    {row.symbol}
                  </Link>
                </td>
                {columns.map((column) => (
                  <td
                    key={column.field}
                    className={`px-3 py-2 tabular-nums text-neutral-200 group-hover:bg-neutral-900/50 ${
                      column.align === 'left' ? 'text-left' : 'text-right'
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}

            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-sm text-neutral-500">
                  Nothing matches. A company with no figure for a filtered metric is excluded
                  rather than assumed to pass.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const dash = <span className="text-neutral-700">—</span>

function fmt(value: number | null, render: (value: number) => string): React.ReactNode {
  return value === null ? dash : render(value)
}

/** Percent inputs are typed as 15, stored as 0.15. */
function pct(raw: string): string {
  if (raw.trim() === '') return ''
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? '' : String(parsed / 100)
}

function NumberFilter({ label, onChange }: { label: string; onChange: (value: string) => void }) {
  return (
    <input
      type="number"
      step="any"
      placeholder={label}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="w-28 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-600"
    />
  )
}

function Th({
  field,
  label,
  title,
  sort,
  onSort,
  className = '',
}: {
  field: SortField
  label: string
  title?: string
  sort: { field: SortField; direction: 'asc' | 'desc' }
  onSort: (field: SortField) => void
  className?: string
}) {
  const active = sort.field === field

  return (
    <th className={`px-3 py-2 font-medium ${className}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-neutral-300 ${
          active ? 'text-neutral-200' : ''
        }`}
      >
        {label}
        <span aria-hidden className={active ? '' : 'opacity-0 group-hover:opacity-40'}>
          {active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  )
}

/** Where the price sits between its 52-week low and high. */
function RangeMeter({ position, aboveLow }: { position: number | null; aboveLow: number | null }) {
  if (position === null) return dash

  const clamped = Math.max(0, Math.min(1, position))

  return (
    <span
      className="inline-flex items-center gap-2"
      title={aboveLow === null ? undefined : `${formatPercent(aboveLow, 1, true)} above the 52-week low`}
    >
      <span className="relative block h-1.5 w-16 rounded-full bg-neutral-800">
        <span
          className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-sky-400"
          style={{ left: `${clamped * 100}%` }}
        />
      </span>
      <span className="text-xs text-neutral-500">{Math.round(clamped * 100)}</span>
    </span>
  )
}
