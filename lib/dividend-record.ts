/**
 * What a company's record of cash dividends says.
 *
 * The announcements are grouped by the calendar year of their ex-date, not by
 * fiscal year: an interim and a final dividend are declared months apart and
 * a site's table does not say which year's profit either belongs to, so any
 * mapping onto fiscal years would be a guess dressed as a fact. A calendar
 * year is what the dates actually support.
 *
 * Figures a source has restated for later bonus issues are kept apart from
 * the arithmetic wherever they would change an answer — a restated amount is
 * not what the company declared, and a "dividend growth" figure built on one
 * is growth in the source's arithmetic, not in the dividend.
 */

export interface AnnouncedDividend {
  exDate: string
  paymentDate: string | null
  /** Per share. Null when only a percentage of face value was recorded. */
  amount: number | null
  percentOfFace: number | null
  /** That source had restated it for later bonus issues. */
  restated: boolean
}

export interface DividendYear {
  year: number
  total: number
  /** How many announcements made up the total — 2 means an interim and a final. */
  count: number
  /** Any part of the total was restated by its source. */
  restated: boolean
}

export interface DividendRecord {
  years: DividendYear[]
  latest: AnnouncedDividend | null
  /** Years with a dividend, out of the years the record spans. */
  paidYears: number
  spanYears: number
  /** Unbroken run of paying years ending at the most recent one. */
  streak: number
  /** Latest full year against the one before, as a fraction. */
  changeOnPriorYear: number | null
  /** Mean of the last five completed years that have one. */
  fiveYearAverage: number | null
  /** True when any figure used above came in restated. */
  restatedInside: boolean
}

const yearOf = (isoDate: string) => Number(isoDate.slice(0, 4))

export function summariseDividends(rows: AnnouncedDividend[]): DividendRecord {
  const paid = rows.filter((row) => row.amount !== null && row.amount > 0)
  if (paid.length === 0) {
    return {
      years: [],
      latest: null,
      paidYears: 0,
      spanYears: 0,
      streak: 0,
      changeOnPriorYear: null,
      fiveYearAverage: null,
      restatedInside: false,
    }
  }

  const byYear = new Map<number, DividendYear>()
  for (const row of paid) {
    const year = yearOf(row.exDate)
    const seen = byYear.get(year)
    if (seen) {
      seen.total += row.amount!
      seen.count += 1
      seen.restated ||= row.restated
    } else {
      byYear.set(year, { year, total: row.amount!, count: 1, restated: row.restated })
    }
  }

  const years = [...byYear.values()].sort((a, b) => b.year - a.year)
  const latest = [...paid].sort((a, b) => (a.exDate < b.exDate ? 1 : -1))[0]

  // The run is counted against the calendar, so a year passed over breaks it.
  let streak = 0
  for (let at = 0; at < years.length; at += 1) {
    if (years[at].year !== years[0].year - at) break
    streak += 1
  }

  const [newest, prior] = years
  const changeOnPriorYear =
    newest && prior && prior.year === newest.year - 1 && prior.total > 0
      ? newest.total / prior.total - 1
      : null

  const lastFive = years.slice(0, 5)
  const fiveYearAverage =
    lastFive.length > 0 ? lastFive.reduce((sum, year) => sum + year.total, 0) / lastFive.length : null

  return {
    years,
    latest,
    paidYears: years.length,
    spanYears: years[0].year - years[years.length - 1].year + 1,
    streak,
    changeOnPriorYear,
    fiveYearAverage,
    restatedInside: lastFive.some((year) => year.restated),
  }
}

/** A dividend against a price, as a fraction. Null when either is missing. */
export function dividendYield(amount: number | null, price: number | null | undefined): number | null {
  if (amount === null || amount <= 0 || !price || price <= 0) return null
  return amount / price
}
