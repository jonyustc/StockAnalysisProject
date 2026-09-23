/**
 * Turning what is stored into what the insight panel needs.
 *
 * Pure: the database work happens in the page, so the judgement calls here —
 * how long after a year end the market could know its earnings, how much
 * history is enough to say anything — are testable on their own.
 */

import type { Earnings } from './insights'

/**
 * A DSE company reports its full year within about four months of the year
 * end; until then the market is still valuing the year before. Dating each
 * figure from its publication, not from the year it describes, keeps a P/E
 * history from being flattered by earnings nobody had yet.
 */
export const PUBLICATION_LAG_DAYS = 120

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10)
}

export function yearsAgo(from: string, years: number): string {
  const [y, m, d] = from.split('-').map(Number)
  return `${y - years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Earnings per share as the market learned them, for the P/E history. */
export function earningsTimeline(
  years: { fiscalYear: number; values: Record<string, number | null | undefined> }[],
  periodEnd: (fiscalYear: number) => string,
  lagDays = PUBLICATION_LAG_DAYS,
): Earnings[] {
  return years
    .map((year) => ({ from: addDays(periodEnd(year.fiscalYear), lagDays), eps: year.values.eps_basic }))
    .filter((e): e is Earnings => typeof e.eps === 'number' && Number.isFinite(e.eps))
    .sort((a, b) => (a.from < b.from ? -1 : 1))
}

export interface Coverage {
  days: number
  from: string | null
  to: string | null
  /** Enough to judge where the price sits over a year. */
  hasYear: boolean
  /** Enough for a P/E band worth showing. */
  hasBand: boolean
  /** Enough calendar years for the months of highs and lows to mean anything. */
  hasSeasons: boolean
  /** What is still needed, in words, when something is missing. */
  note: string | null
}

/** How much price history there is, and what it is enough for. */
export function coverageOf(history: { date: string }[]): Coverage {
  const days = history.length
  const from = days > 0 ? history[0].date : null
  const to = days > 0 ? history[days - 1].date : null
  // Roughly 250 trading days in a DSE year.
  const hasYear = days >= 200
  const hasBand = days >= 250
  const fullYears = new Set(
    history
      .map((c) => Number(c.date.slice(0, 4)))
      .filter((year) => history.filter((c) => c.date.startsWith(String(year))).length >= 180),
  ).size
  const hasSeasons = fullYears >= 2

  const missing = !hasYear
    ? `${days} day${days === 1 ? '' : 's'} of prices stored so far; a year of them is about 250. One more is added each trading day.`
    : !hasSeasons
      ? 'Two full calendar years of prices are needed before the months of highs and lows mean anything.'
      : null

  return { days, from, to, hasYear, hasBand, hasSeasons, note: missing }
}
