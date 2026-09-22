/**
 * How fresh is a closing price?
 *
 * "A few days old" cannot be measured in calendar days. DSE trades Sunday to
 * Thursday, so a Thursday close looked at on Saturday is the newest price
 * there is — two calendar days old and perfectly current. A calendar-day rule
 * would raise a false alarm every weekend, and a warning that fires every
 * weekend gets ignored the one time it matters.
 *
 * So this counts TRADING days missed, against when a price should exist: the
 * daily job runs around 17:00 Dhaka, so before evening the latest close due
 * is the previous session's.
 *
 * Public holidays (Eid closures can run over a week) are not known here, so a
 * long holiday will read as missed days. The warning says so rather than
 * pretending to know.
 */

/** Dhaka is UTC+6 all year — Bangladesh does not observe daylight saving. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

/**
 * By this Dhaka hour, today's close should be in. The job is scheduled for
 * 17:00 and the free Vercel plan may start it any time in that hour.
 */
export const CLOSE_AVAILABLE_HOUR = 18

/** Sunday = 0 ... Thursday = 4 are trading days; Friday and Saturday are not. */
export function isTradingDay(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  return day >= 0 && day <= 4
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function previousTradingDay(isoDate: string): string {
  let day = addDays(isoDate, -1)
  while (!isTradingDay(day)) day = addDays(day, -1)
  return day
}

/** Trading days after `from` up to and including `to`. */
export function tradingDaysBetween(from: string, to: string): number {
  let count = 0
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) {
    if (isTradingDay(day)) count += 1
  }
  return count
}

/** Today's date and hour in Dhaka, whatever timezone the server runs in. */
export function dhakaNow(now: Date = new Date()): { date: string; hour: number } {
  const shifted = new Date(now.getTime() + DHAKA_OFFSET_MS)
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() }
}

/** The most recent session whose close should already have been fetched. */
export function expectedLatestClose(now: Date = new Date()): string {
  const { date, hour } = dhakaNow(now)
  if (isTradingDay(date) && hour >= CLOSE_AVAILABLE_HOUR) return date
  return previousTradingDay(date)
}

export type FreshnessStatus =
  /** Nothing stored at all. */
  | 'none'
  /** The newest close that should exist is here. */
  | 'fresh'
  /** One session missed — the job may just have failed once. */
  | 'behind'
  /** Two or more sessions missed. Values are going stale. */
  | 'stale'

export interface Freshness {
  status: FreshnessStatus
  latest: string | null
  expected: string
  missedTradingDays: number
}

export function assessFreshness(latest: string | null, now: Date = new Date()): Freshness {
  const expected = expectedLatestClose(now)

  if (latest === null) return { status: 'none', latest, expected, missedTradingDays: 0 }

  const missed = latest >= expected ? 0 : tradingDaysBetween(latest, expected)

  return {
    status: missed === 0 ? 'fresh' : missed === 1 ? 'behind' : 'stale',
    latest,
    expected,
    missedTradingDays: missed,
  }
}

/** "21 Sep 2026" — unambiguous, unlike 09/21 vs 21/09. */
export function formatTradeDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${day} ${names[month - 1]} ${year}`
}
