/**
 * Fiscal period arithmetic.
 *
 * The seven tracked companies do not share a year-end — Marico and Berger end
 * 31 March, Square/Renata/Olympic 30 June, LafargeHolcim 31 December. A bare
 * "FY2026" is therefore ambiguous across companies, so every period carries
 * real start and end dates.
 *
 * Convention: FY<N> is the fiscal year ENDING in calendar year N.
 *   Marico FY2026        = 2025-04-01 .. 2026-03-31
 *   Square FY2026        = 2025-07-01 .. 2026-06-30
 *   LafargeHolcim FY2026 = 2026-01-01 .. 2026-12-31
 *
 * All arithmetic is in UTC to keep it free of local-timezone drift.
 */

export interface FiscalYearEnd {
  /** 1-12 */
  month: number
  /** 1-31 */
  day: number
}

export interface PeriodBounds {
  /** ISO date, YYYY-MM-DD */
  start: string
  /** ISO date, YYYY-MM-DD */
  end: string
  monthsCovered: number
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Reads an ISO date string as a UTC date, ignoring any time component. */
function fromIso(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function assertValidFiscalYearEnd(fye: FiscalYearEnd): void {
  if (!Number.isInteger(fye.month) || fye.month < 1 || fye.month > 12) {
    throw new RangeError(`Fiscal year end month must be 1-12, got ${fye.month}`)
  }
  if (!Number.isInteger(fye.day) || fye.day < 1 || fye.day > 31) {
    throw new RangeError(`Fiscal year end day must be 1-31, got ${fye.day}`)
  }
}

/**
 * Start and end dates of an annual fiscal period.
 *
 * The start is the day after the previous year's end, so periods abut exactly
 * with no gap or overlap. Date.UTC normalises overflow, which handles month
 * ends correctly: a 31 March year-end gives a 1 April start.
 */
export function fiscalYearBounds(fye: FiscalYearEnd, fiscalYear: number): PeriodBounds {
  assertValidFiscalYearEnd(fye)

  const end = new Date(Date.UTC(fiscalYear, fye.month - 1, fye.day))
  const start = new Date(Date.UTC(fiscalYear - 1, fye.month - 1, fye.day + 1))

  return { start: toIso(start), end: toIso(end), monthsCovered: 12 }
}

/**
 * Which fiscal year a calendar date falls into.
 *
 * A date on the year-end itself belongs to the year that ends there.
 */
export function fiscalYearForDate(fye: FiscalYearEnd, date: Date | string): number {
  assertValidFiscalYearEnd(fye)

  const target = typeof date === 'string' ? fromIso(date) : date
  const calendarYear = target.getUTCFullYear()
  const endThisYear = new Date(Date.UTC(calendarYear, fye.month - 1, fye.day))

  return target.getTime() <= endThisYear.getTime() ? calendarYear : calendarYear + 1
}

/**
 * Bounds of a quarter within a fiscal year. `quarter` is 1-4 counted from the
 * start of the fiscal year, not the calendar year.
 *
 * Note: DSE companies typically publish Q1, Q2 and Q3 only, and the Q3 report
 * is usually cumulative (covering nine months). This returns the DISCRETE
 * quarter; whether a given filing is cumulative is recorded per period on
 * fiscal_periods.is_cumulative.
 */
export function fiscalQuarterBounds(
  fye: FiscalYearEnd,
  fiscalYear: number,
  quarter: 1 | 2 | 3 | 4,
): PeriodBounds {
  assertValidFiscalYearEnd(fye)

  const { start } = fiscalYearBounds(fye, fiscalYear)
  const yearStart = fromIso(start)

  const quarterStart = new Date(
    Date.UTC(
      yearStart.getUTCFullYear(),
      yearStart.getUTCMonth() + (quarter - 1) * 3,
      yearStart.getUTCDate(),
    ),
  )

  // End is the day before the next quarter begins.
  const nextQuarterStart = new Date(
    Date.UTC(
      yearStart.getUTCFullYear(),
      yearStart.getUTCMonth() + quarter * 3,
      yearStart.getUTCDate(),
    ),
  )
  const quarterEnd = new Date(nextQuarterStart.getTime() - 86_400_000)

  return { start: toIso(quarterStart), end: toIso(quarterEnd), monthsCovered: 3 }
}

/** Cumulative period from the start of the fiscal year through `quarter`. */
export function fiscalCumulativeBounds(
  fye: FiscalYearEnd,
  fiscalYear: number,
  quarter: 1 | 2 | 3 | 4,
): PeriodBounds {
  const { start } = fiscalYearBounds(fye, fiscalYear)
  const { end } = fiscalQuarterBounds(fye, fiscalYear, quarter)
  return { start, end, monthsCovered: quarter * 3 }
}

/** "FY2026" */
export function fiscalYearLabel(fiscalYear: number): string {
  return `FY${fiscalYear}`
}

/**
 * "FY2026 (Apr 2025 – Mar 2026)" — worth showing wherever companies with
 * different year-ends appear side by side, which is most places.
 */
export function fiscalYearRangeLabel(fye: FiscalYearEnd, fiscalYear: number): string {
  const { start, end } = fiscalYearBounds(fye, fiscalYear)
  const startDate = fromIso(start)
  const endDate = fromIso(end)

  const from = `${MONTH_NAMES[startDate.getUTCMonth()]} ${startDate.getUTCFullYear()}`
  const to = `${MONTH_NAMES[endDate.getUTCMonth()]} ${endDate.getUTCFullYear()}`

  return `${fiscalYearLabel(fiscalYear)} (${from} – ${to})`
}

/** Descending list of fiscal years, newest first — the usual display order. */
export function fiscalYearRange(latest: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => latest - index)
}

/**
 * The most recent fiscal year whose results a company should have published,
 * allowing a reporting lag. DSE companies file audited annuals within roughly
 * four months of year-end, so anything more recent will not exist yet.
 */
export function latestReportedFiscalYear(
  fye: FiscalYearEnd,
  asOf: Date = new Date(),
  lagMonths = 4,
): number {
  const lagged = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - lagMonths, asOf.getUTCDate()),
  )
  const fy = fiscalYearForDate(fye, lagged)
  const { end } = fiscalYearBounds(fye, fy)

  // fiscalYearForDate rounds up to the year the date falls inside; if that
  // year has not ended by the lagged date, step back one.
  return fromIso(end).getTime() <= lagged.getTime() ? fy : fy - 1
}
