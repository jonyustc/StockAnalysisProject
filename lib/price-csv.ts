/**
 * Reading a CSV of historical daily prices.
 *
 * Every source writes them differently — "Date,Close", "TRADE DATE,CLOSEP*",
 * "Trading Code,Date,LTP" — so columns are matched by what they mean rather
 * than by an exact heading, and a row that cannot be read is reported with
 * its line number instead of being guessed at.
 *
 * Dates: ISO (2026-09-22), DSE style (22-Sep-2026) and slashed, either way
 * round. Which way is decided from the whole file — one unambiguous row
 * settles every other — because guessing row by row would read half of a
 * month-first file as day-first and quietly move those prices to another
 * day. A file that contradicts itself is refused.
 */

export interface PriceRow {
  symbol: string | null
  date: string
  close: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
}

export interface ParsedPriceCsv {
  rows: PriceRow[]
  /** Which heading was read as what, to show before anything is imported. */
  columns: Record<string, string>
  issues: string[]
}

export const ALIASES: Record<keyof Omit<PriceRow, 'symbol'> | 'symbol', string[]> = {
  date: ['date', 'tradedate', 'trade date', 'trading date', 'time', 'timestamp', 'day'],
  // 'price' last: a file with both a Close and a Price column means Close.
  close: ['close', 'closep', 'close price', 'closing price', 'closeprice', 'ltp', 'last', 'last price', 'lastprice', 'close*', 'price'],
  open: ['open', 'openp', 'open price', 'openprice', 'opening price'],
  high: ['high', 'highp', 'high price', 'day high'],
  low: ['low', 'lowp', 'low price', 'day low'],
  // Not "turnover" or "value": those are money, not a number of shares.
  volume: ['volume', 'vol', 'trade volume', 'shares traded', 'quantity', 'qty'],
  symbol: ['symbol', 'trading code', 'tradingcode', 'code', 'instrument', 'ticker', 'scrip'],
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

export const cleanCell = (value: string) => value.trim().replace(/^["']|["']$/g, '').trim()
const normalise = (heading: string) => cleanCell(heading).toLowerCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim()

/** The delimiter a line is written with: comma, tab or semicolon. */
function delimiterOf(line: string): string {
  const counts = [',', '\t', ';'].map((d) => [d, line.split(d).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ','
}

/** K, M and B, as sites abbreviate volumes: 1.02M is 1,020,000. */
const SUFFIXES: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }

export function parseCell(value: string): number | null {
  const cleaned = cleanCell(value).replace(/,/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === 'N/A') return null

  const abbreviated = cleaned.match(/^(-?\d*\.?\d+)\s*([KMB])$/i)
  if (abbreviated) return Number(abbreviated[1]) * SUFFIXES[abbreviated[2].toLowerCase()]

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

const round = (value: number | null) => (value === null ? null : Math.round(value))

export type DateOrder = 'dayFirst' | 'monthFirst'

/**
 * Which way round a file writes slashed dates, decided from the file as a
 * whole rather than row by row.
 *
 * A single "05/09/2026" cannot be read on its own, but one "22/09/2026"
 * anywhere in the file settles it for every row — and a file containing both
 * "22/09" and "09/22" contradicts itself, which is worth refusing rather
 * than silently halving.
 */
export function detectDateOrder(values: string[]): { order: DateOrder; certain: boolean; conflict: boolean } {
  let dayFirst = false
  let monthFirst = false

  for (const value of values) {
    const parts = cleanCell(value).match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/)
    if (!parts) continue
    if (Number(parts[1]) > 12) dayFirst = true
    if (Number(parts[2]) > 12) monthFirst = true
  }

  if (dayFirst && monthFirst) return { order: 'dayFirst', certain: false, conflict: true }
  if (monthFirst) return { order: 'monthFirst', certain: true, conflict: false }
  if (dayFirst) return { order: 'dayFirst', certain: true, conflict: false }
  // Nothing to go on: Bangladesh writes the day first.
  return { order: 'dayFirst', certain: false, conflict: false }
}

export function parseDate(value: string, order: DateOrder = 'dayFirst'): string | null {
  const text = cleanCell(value)

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // 22-Sep-2026, 22 Sep 2026, 22 September 2026.
  const named = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/)
  if (named) {
    const month = MONTHS[named[2].toLowerCase()]
    if (month) return `${named[3]}-${month}-${named[1].padStart(2, '0')}`
  }

  // Sep 22, 2026 — the month first, as American sites write it.
  const monthFirst = text.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()]
    if (month) return `${monthFirst[3]}-${month}-${monthFirst[2].padStart(2, '0')}`
  }

  const slashed = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slashed) {
    const [, first, second, year] = slashed
    const dayFirst = order === 'dayFirst'
    const day = dayFirst ? first : second
    const month = dayFirst ? second : first
    if (Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
  }

  return null
}

/**
 * One line of CSV into its fields, respecting quotes — a quoted field may
 * hold the delimiter itself, as thousands separators do: "1,023,085".
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += char
    } else if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells
}

/** Rows worth importing, and a plain account of anything that was not. */
export function parsePriceCsv(text: string, fallbackSymbol?: string): ParsedPriceCsv {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) return { rows: [], columns: {}, issues: ['The file has no rows under its heading.'] }

  const delimiter = delimiterOf(lines[0])
  return buildRows(
    splitCsvLine(lines[0], delimiter),
    lines.slice(1).map((line) => splitCsvLine(line, delimiter)),
    fallbackSymbol,
  )
}

/**
 * Headings and rows of cells into prices — however they were laid out.
 *
 * Shared by the CSV reader and the DSE archive page, so a column means the
 * same thing whichever way the prices arrived.
 */
export function buildRows(headingCells: string[], body: string[][], fallbackSymbol?: string): ParsedPriceCsv {
  const headings = headingCells.map(normalise)
  const index: Partial<Record<keyof PriceRow, number>> = {}
  const columns: Record<string, string> = {}

  // Aliases are tried in their own order, not in the file's: a DSE export
  // has both "CLOSEP*" and "LTP*", and the closing price is the one the
  // daily feed stores, so history and daily data mean the same thing.
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof PriceRow, string[]][]) {
    for (const alias of aliases) {
      const at = headings.findIndex((h) => h === alias || h.replace(/\*/g, '').trim() === alias)
      if (at >= 0) {
        index[field] = at
        columns[cleanCell(headingCells[at])] = field
        break
      }
    }
  }

  const issues: string[] = []
  if (index.date === undefined) issues.push('No date column found.')
  if (index.close === undefined) issues.push('No closing price column found.')
  if (issues.length > 0) return { rows: [], columns, issues }

  // Which way round this file writes dates, from all of its rows at once.
  const dates = detectDateOrder(body.map((cells) => cells[index.date!] ?? ''))
  if (dates.conflict) {
    return {
      rows: [],
      columns,
      issues: ['This file has both 22/09/2026 and 09/22/2026 style dates, so which is the day cannot be told. Convert the dates to 2026-09-22 form and import again.'],
    }
  }

  const rows: PriceRow[] = []
  const seen = new Map<string, number>()
  let unreadable = 0
  let slashed = 0

  for (let i = 0; i < body.length; i += 1) {
    const cells = body[i]
    // A line of empty fields is padding, not a row that failed.
    if (cells.every((cell) => cleanCell(cell) === '')) continue
    const at = (field: keyof PriceRow) => (index[field] === undefined ? '' : (cells[index[field]!] ?? ''))

    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(cleanCell(at('date')))) slashed += 1
    const date = parseDate(at('date'), dates.order)
    const close = parseCell(at('close'))
    if (!date || close === null || close <= 0) {
      unreadable += 1
      if (unreadable <= 5) issues.push(`Line ${i + 2}: could not read "${cells.join(',').slice(0, 60)}".`)
      continue
    }

    const symbol = index.symbol !== undefined ? cleanCell(at('symbol')).toUpperCase() : (fallbackSymbol ?? null)
    const row: PriceRow = {
      symbol: symbol || null,
      date,
      close,
      open: parseCell(at('open')),
      high: parseCell(at('high')),
      low: parseCell(at('low')),
      // A whole number of shares; a volume written "261.29K" is approximate
      // to begin with, and the column it goes in holds integers.
      volume: round(parseCell(at('volume'))),
    }

    // A file may repeat a day; the later line wins.
    const key = `${row.symbol}|${row.date}`
    const existing = seen.get(key)
    if (existing === undefined) {
      seen.set(key, rows.length)
      rows.push(row)
    } else {
      rows[existing] = row
    }
  }

  if (unreadable > 5) issues.push(`…and ${unreadable - 5} more unreadable lines.`)
  if (slashed > 0) {
    issues.push(
      dates.certain
        ? `Slashed dates read ${dates.order === 'dayFirst' ? 'day first: 22/09/2026 is 22 September' : 'month first: 09/22/2026 is 22 September'} — the file itself settles which.`
        : 'Slashed dates were read day first (22/09/2026 is 22 September), because nothing in the file settles it. Check the dates below.',
    )
  }
  if (rows.some((r) => r.symbol === null)) issues.push('Some rows have no stock symbol: pass one for the whole file.')

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { rows, columns, issues }
}

/**
 * The company part of a file name, for a file that does not name its stock:
 * "Square Pharma Stock Price History (1).csv" leaves "Square Pharma".
 *
 * Only a hint. Whoever uses it matches the result against the companies
 * known, takes it only when exactly one matches, and says on screen that the
 * stock came from the file's name rather than from the file.
 */
export function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\(\d+\)/g, '')
    .replace(/[_+-]+/g, ' ')
    .replace(/\b(stock|shares?|prices?|history|historical|data|daily|export|download|csv|of|the)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
