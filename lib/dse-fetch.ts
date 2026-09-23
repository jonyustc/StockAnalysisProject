/**
 * Fetching a stretch of DSE day-end history.
 *
 * The archive page caps what it returns — ask for three years of one stock
 * and you get the most recent five hundred rows or so, with the older part
 * silently missing. So a long range is fetched as a series of shorter
 * windows and stitched together, and each window reports what it brought
 * back: a window that returns nothing is said so rather than quietly
 * leaving a hole in the history.
 *
 * The fetch itself is passed in, so this can be exercised without a network.
 */

import { dseArchiveUrl, parseDseArchive } from './dse-archive'
import type { PriceRow } from './price-csv'

/** Comfortably under the page's row cap, even for a busy stock. */
export const WINDOW_DAYS = 300

/** How far back the import page offers to fetch in one go; the script has no such limit. */
export const DSE_MAX_YEARS = 3

/** A guard on one request, so a mistyped range cannot fetch for ever. */
export const MAX_WINDOWS = 20

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** A long range split into windows the archive will answer in full. */
export function windowsFor(from: string, to: string, windowDays = WINDOW_DAYS): { from: string; to: string }[] {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return []

  const windows: { from: string; to: string }[] = []
  for (let at = end; at >= start && windows.length < MAX_WINDOWS; at -= (windowDays + 1) * DAY) {
    const windowStart = Math.max(start, at - windowDays * DAY)
    windows.push({ from: iso(windowStart), to: iso(at) })
    if (windowStart === start) break
  }
  // Oldest first, so the merged history reads forwards.
  return windows.reverse()
}

export interface FetchedWindow {
  from: string
  to: string
  rows: number
  issue: string | null
}

export interface FetchedHistory {
  rows: PriceRow[]
  windows: FetchedWindow[]
  issues: string[]
}

export interface FetchOptions {
  symbol: string
  from: string
  to: string
  fetchPage: (url: string) => Promise<{ ok: boolean; status: number; text: string }>
  /** Between windows, so a backfill is not a burst of requests. */
  pauseMs?: number
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Day-end rows for one stock across a range, in windows the archive answers. */
export async function fetchDseHistory({
  symbol,
  from,
  to,
  fetchPage,
  pauseMs = 700,
  sleep = wait,
}: FetchOptions): Promise<FetchedHistory> {
  const windows = windowsFor(from, to)
  if (windows.length === 0) return { rows: [], windows: [], issues: ['That date range reads backwards.'] }

  const byDate = new Map<string, PriceRow>()
  const reports: FetchedWindow[] = []
  const issues: string[] = []

  for (const [i, window] of windows.entries()) {
    if (i > 0 && pauseMs > 0) await sleep(pauseMs)

    let report: FetchedWindow = { ...window, rows: 0, issue: null }
    try {
      const response = await fetchPage(dseArchiveUrl({ symbol, from: window.from, to: window.to }))
      if (!response.ok) {
        report = { ...report, issue: `DSE answered ${response.status}` }
      } else {
        const parsed = parseDseArchive(response.text)
        for (const row of parsed.rows) byDate.set(`${row.symbol}|${row.date}`, row)
        report = {
          ...report,
          rows: parsed.rows.length,
          issue: parsed.rows.length === 0 ? (parsed.issues[0] ?? 'nothing returned') : null,
        }
      }
    } catch (error) {
      report = { ...report, issue: error instanceof Error ? error.message : 'could not be fetched' }
    }
    reports.push(report)
  }

  const failed = reports.filter((r) => r.issue !== null && r.rows === 0)
  if (failed.length === reports.length) {
    issues.push(`Nothing came back for ${symbol}. ${failed[0]?.issue ?? ''}`.trim())
  } else if (failed.length > 0) {
    issues.push(
      `${failed.length} of ${reports.length} windows brought nothing (${failed.map((f) => `${f.from}→${f.to}`).join(', ')}), so those dates may be missing.`,
    )
  }

  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { rows, windows: reports, issues }
}
