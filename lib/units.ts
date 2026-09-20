/**
 * Scale handling and number formatting.
 *
 * Annual reports print figures in units, thousands, lakh, millions or crore —
 * inconsistently, and sometimes changing between statements in one document.
 * The rule everywhere in this app: enter the number exactly as printed, record
 * the scale alongside it, and let code do the conversion. Never convert in
 * your head.
 */

export type ValueScale = 'unit' | 'thousand' | 'lakh' | 'million' | 'crore' | 'billion'

/** Must stay identical to the CASE expression in db/migrations/0001_init.sql. */
export const SCALE_FACTORS: Record<ValueScale, number> = {
  unit: 1,
  thousand: 1_000,
  lakh: 100_000,
  million: 1_000_000,
  crore: 10_000_000,
  billion: 1_000_000_000,
}

export const SCALE_LABELS: Record<ValueScale, string> = {
  unit: 'Taka',
  thousand: "Taka in '000",
  lakh: 'Taka in lakh',
  million: 'Taka in million',
  crore: 'Taka in crore',
  billion: 'Taka in billion',
}

/** Converts a figure as printed into base BDT. Mirrors the generated column. */
export function toBaseValue(reported: number, scale: ValueScale): number {
  return reported * SCALE_FACTORS[scale]
}

/** Converts base BDT back into a display scale. */
export function fromBaseValue(base: number, scale: ValueScale): number {
  return base / SCALE_FACTORS[scale]
}

/**
 * Picks the scale a BDT amount reads most naturally in, using the Bangladeshi
 * convention (lakh, then crore) rather than million/billion.
 */
export function naturalScale(base: number): ValueScale {
  const magnitude = Math.abs(base)
  if (magnitude >= SCALE_FACTORS.crore) return 'crore'
  if (magnitude >= SCALE_FACTORS.lakh) return 'lakh'
  return 'unit'
}

const SCALE_SUFFIX: Record<ValueScale, string> = {
  unit: '',
  thousand: 'K',
  lakh: ' lakh',
  million: 'M',
  crore: ' cr',
  billion: 'B',
}

export interface FormatOptions {
  /** Omit to pick automatically. */
  scale?: ValueScale
  decimals?: number
  /** Prefix with ৳. */
  currency?: boolean
}

/** Formats a base-BDT amount for display, e.g. 20_920_000_000 -> "৳2,092.00 cr". */
export function formatBDT(base: number | null | undefined, options: FormatOptions = {}): string {
  if (base === null || base === undefined || Number.isNaN(base)) return '—'

  const scale = options.scale ?? naturalScale(base)
  const decimals = options.decimals ?? (scale === 'unit' ? 0 : 2)
  const value = fromBaseValue(base, scale)

  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return `${options.currency === false ? '' : '৳'}${formatted}${SCALE_SUFFIX[scale]}`
}

/** Per-share figures are never scaled — EPS 19.02 is 19.02 taka. */
export function formatPerShare(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `৳${value.toFixed(decimals)}`
}

/** Takes a fraction (0.2263), prints a percentage ("22.63%"). */
export function formatPercent(
  fraction: number | null | undefined,
  decimals = 2,
  withSign = false,
): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return '—'
  const pct = fraction * 100
  const sign = withSign && pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(decimals)}%`
}

export function formatRatio(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(decimals)
}

/**
 * Parses a figure as typed from a report: "1,234.56", "(1,234)" for negatives,
 * "-" and "" for absent. Returns null when there is no number, which is
 * meaningfully different from zero.
 */
export function parseReportedNumber(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '' || trimmed === '-' || trimmed === '—' || trimmed === 'N/A') return null

  // Accountants' parentheses mean negative.
  const negative = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[(),\s৳]/g, '')

  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null

  const value = Number(cleaned)
  if (Number.isNaN(value)) return null

  return negative ? -Math.abs(value) : value
}
