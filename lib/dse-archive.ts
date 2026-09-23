/**
 * Reading DSE's own day-end archive.
 *
 *   https://www.dsebd.org/day_end_archive.php?startDate=…&endDate=…&inst=…&archive=data
 *
 * There is no JSON behind that page: it renders a table of day-end rows. So
 * the table is found by its headings — the same headings its CSV export
 * uses — and the cells go through the same column matching, which means a
 * price fetched from the page and one imported from a file mean exactly the
 * same thing.
 *
 * The page carries a few hundred other tables (the ticker along the top),
 * so the right one is the one whose header row has a date and a price, not
 * the first or the largest.
 */

import { buildRows, cleanCell, type ParsedPriceCsv } from './price-csv'

export const DSE_ARCHIVE_URL = 'https://www.dsebd.org/day_end_archive.php'

/** Every instrument, which is how DSE names "all of them" in this form. */
export const ALL_INSTRUMENTS = 'All Instrument'

export function dseArchiveUrl({ symbol, from, to }: { symbol: string; from: string; to: string }): string {
  const url = new URL(DSE_ARCHIVE_URL)
  url.searchParams.set('startDate', from)
  url.searchParams.set('endDate', to)
  url.searchParams.set('inst', symbol)
  url.searchParams.set('archive', 'data')
  return url.toString()
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

/** The text of one cell: tags stripped, entities resolved, spaces collapsed. */
export function cellText(html: string): string {
  return cleanCell(
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
      .replace(/\s+/g, ' '),
  )
}

function rowsOf(table: string): string[][] {
  return (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
    (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText),
  )
}

export interface ParsedArchive extends ParsedPriceCsv {
  /** How many rows the page's table held, before any were rejected. */
  tableRows: number
}

/**
 * The day-end rows on an archive page.
 *
 * A page with no data table — a date range with no trading in it, or DSE
 * showing a message instead — comes back with no rows and says so, rather
 * than looking like a successful fetch of nothing.
 */
export function parseDseArchive(html: string): ParsedArchive {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? []

  for (const table of tables) {
    const rows = rowsOf(table).filter((cells) => cells.length > 1)
    if (rows.length < 2) continue

    const headings = rows[0].map((h) => h.toLowerCase().replace(/\*/g, '').trim())
    const looksRight = headings.some((h) => h === 'date') && headings.some((h) => h.startsWith('closep') || h === 'close' || h === 'ltp')
    if (!looksRight) continue

    const parsed = buildRows(rows[0], rows.slice(1))
    return { ...parsed, tableRows: rows.length - 1 }
  }

  return {
    rows: [],
    columns: {},
    issues: [
      'No day-end table on that page. DSE shows one only for a range with trading days in it, and only when the stock code is exactly right.',
    ],
    tableRows: 0,
  }
}
