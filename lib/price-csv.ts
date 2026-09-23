/**
 * Reading a CSV of historical daily prices.
 *
 * Every source writes them differently — "Date,Close", "TRADE DATE,CLOSEP*",
 * "Trading Code,Date,LTP" — so columns are matched by what they mean rather
 * than by an exact heading, and a row that cannot be read is reported with
 * its line number instead of being guessed at.
 *
 * Dates: ISO (2026-09-22), DSE style (22-Sep-2026) and slashed (22/09/2026).
 * A slashed date where both parts could be the day is read day-first, as
 * Bangladesh writes them, and the caller is told that happened.
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

const ALIASES: Record<keyof Omit<PriceRow, 'symbol'> | 'symbol', string[]> = {
  date: ['date', 'tradedate', 'trade date', 'trading date', 'time', 'timestamp', 'day'],
  close: ['close', 'closep', 'close price', 'closing price', 'closeprice', 'ltp', 'last', 'last price', 'lastprice', 'close*'],
  open: ['open', 'openp', 'open price', 'openprice', 'opening price'],
  high: ['high', 'highp', 'high price', 'day high'],
  low: ['low', 'lowp', 'low price', 'day low'],
  volume: ['volume', 'vol', 'trade volume', 'shares traded', 'quantity', 'qty'],
  symbol: ['symbol', 'trading code', 'tradingcode', 'code', 'instrument', 'ticker', 'scrip'],
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

const clean = (value: string) => value.trim().replace(/^["']|["']$/g, '').trim()
const normalise = (heading: string) => clean(heading).toLowerCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim()

/** The delimiter a line is written with: comma, tab or semicolon. */
function delimiterOf(line: string): string {
  const counts = [',', '\t', ';'].map((d) => [d, line.split(d).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ','
}

function number(value: string): number | null {
  const cleaned = clean(value).replace(/,/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === 'N/A') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseDate(value: string): { date: string | null; assumedDayFirst: boolean } {
  const text = clean(value)

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, assumedDayFirst: false }

  const named = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/)
  if (named) {
    const month = MONTHS[named[2].toLowerCase()]
    if (month) return { date: `${named[3]}-${month}-${named[1].padStart(2, '0')}`, assumedDayFirst: false }
  }

  const slashed = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slashed) {
    const [, first, second, year] = slashed
    // Day first, unless the first part can only be a month.
    const dayFirst = Number(first) > 12 || Number(second) <= 12
    const day = dayFirst ? first : second
    const month = dayFirst ? second : first
    if (Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12) {
      return {
        date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
        assumedDayFirst: Number(first) <= 12 && Number(second) <= 12,
      }
    }
  }

  return { date: null, assumedDayFirst: false }
}

/** Rows worth importing, and a plain account of anything that was not. */
export function parsePriceCsv(text: string, fallbackSymbol?: string): ParsedPriceCsv {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) return { rows: [], columns: {}, issues: ['The file has no rows under its heading.'] }

  const delimiter = delimiterOf(lines[0])
  const headings = lines[0].split(delimiter).map(normalise)
  const index: Partial<Record<keyof PriceRow, number>> = {}
  const columns: Record<string, string> = {}

  for (const [field, aliases] of Object.entries(ALIASES) as [keyof PriceRow, string[]][]) {
    const at = headings.findIndex((h) => aliases.includes(h) || aliases.some((a) => h.replace(/\*/g, '') === a))
    if (at >= 0) {
      index[field] = at
      columns[clean(lines[0].split(delimiter)[at])] = field
    }
  }

  const issues: string[] = []
  if (index.date === undefined) issues.push('No date column found.')
  if (index.close === undefined) issues.push('No closing price column found.')
  if (issues.length > 0) return { rows: [], columns, issues }

  const rows: PriceRow[] = []
  const seen = new Map<string, number>()
  let dayFirstAssumed = false
  let unreadable = 0

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(delimiter)
    const at = (field: keyof PriceRow) => (index[field] === undefined ? '' : (cells[index[field]!] ?? ''))

    const { date, assumedDayFirst } = parseDate(at('date'))
    const close = number(at('close'))
    if (!date || close === null || close <= 0) {
      unreadable += 1
      if (unreadable <= 5) issues.push(`Line ${i + 1}: could not read "${lines[i].slice(0, 60)}".`)
      continue
    }
    dayFirstAssumed ||= assumedDayFirst

    const symbol = index.symbol !== undefined ? clean(at('symbol')).toUpperCase() : (fallbackSymbol ?? null)
    const row: PriceRow = {
      symbol: symbol || null,
      date,
      close,
      open: number(at('open')),
      high: number(at('high')),
      low: number(at('low')),
      volume: number(at('volume')),
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
  if (dayFirstAssumed) issues.push('Slashed dates were read day first (22/09/2026 is 22 September). Check if the file is month first.')
  if (rows.some((r) => r.symbol === null)) issues.push('Some rows have no stock symbol: pass one for the whole file.')

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { rows, columns, issues }
}
