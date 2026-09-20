/**
 * Daily price ingestion and valuation.
 *
 * Source: stocknow.com.bd's public instruments endpoint, which publishes the
 * whole DSE board with no key. It is the only part of this database that is
 * not hand-entered, and the only source that is not a company filing — so the
 * parsing here is deliberately suspicious of what it receives. An unmaintained
 * third-party feed will eventually serve something wrong, and a wrong close
 * price silently poisons every PE, PB and yield on the page.
 */

export const PRICE_SOURCE_URL = 'https://stocknow.com.bd/api/v1/instruments'
export const PRICE_SOURCE_NAME = 'stocknow.com.bd'

/** One instrument as the feed publishes it. Every field is untrusted. */
export interface RawInstrument {
  code?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  ycp?: unknown
  volume?: unknown
  value?: unknown
  trades?: unknown
  yearly_high?: unknown
  yearly_low?: unknown
  updated_at?: unknown
}

export interface PriceQuote {
  symbol: string
  tradeDate: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  ycp: number | null
  volume: number | null
  /** The feed reports turnover in millions BDT; converted to base here. */
  valueBdt: number | null
  trades: number | null
  yearlyHigh: number | null
  yearlyLow: number | null
}

export interface ParseResult {
  quotes: PriceQuote[]
  skipped: { symbol: string; reason: string }[]
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Positive numbers only — a zero price means "did not trade", not "free". */
function positive(value: unknown): number | null {
  const parsed = num(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

/** "2026-09-20 14:05:53" -> "2026-09-20". Already Dhaka local, which is what we want. */
function tradeDateFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const [, year, month, day] = match
  const monthNum = Number(month)
  const dayNum = Number(day)
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null

  return `${year}-${month}-${day}`
}

/**
 * Picks out the instruments we track and validates each one.
 *
 * `wanted` is matched case-insensitively against DSE symbols. Anything the
 * feed sends that we do not track is ignored rather than stored: 473
 * instruments a day would be 170,000 rows a year for seven we never look at.
 */
export function parseInstruments(payload: unknown, wanted: string[]): ParseResult {
  const quotes: PriceQuote[] = []
  const skipped: { symbol: string; reason: string }[] = []

  if (payload === null || typeof payload !== 'object') {
    return { quotes, skipped: [{ symbol: '*', reason: 'payload is not an object' }] }
  }

  const byCode = payload as Record<string, RawInstrument>
  const index = new Map(Object.keys(byCode).map((key) => [key.toUpperCase(), key]))

  for (const symbol of wanted) {
    const key = index.get(symbol.toUpperCase())

    if (key === undefined) {
      skipped.push({ symbol, reason: 'not present in feed' })
      continue
    }

    const raw = byCode[key]
    const close = positive(raw.close)
    const tradeDate = tradeDateFrom(raw.updated_at)

    if (close === null) {
      // Common and legitimate: suspended, or simply no trade that session.
      skipped.push({ symbol, reason: 'no close price' })
      continue
    }

    if (tradeDate === null) {
      skipped.push({ symbol, reason: 'unusable updated_at' })
      continue
    }

    const high = positive(raw.high)
    const low = positive(raw.low)

    // A high below the low, or a close outside the day's range, means the feed
    // is confused. Storing it would look like a real price move.
    if (high !== null && low !== null && high < low) {
      skipped.push({ symbol, reason: `high ${high} below low ${low}` })
      continue
    }
    if (high !== null && close > high * 1.001) {
      skipped.push({ symbol, reason: `close ${close} above high ${high}` })
      continue
    }
    if (low !== null && close < low * 0.999) {
      skipped.push({ symbol, reason: `close ${close} below low ${low}` })
      continue
    }

    const value = num(raw.value)

    quotes.push({
      symbol: symbol.toUpperCase(),
      tradeDate,
      open: positive(raw.open),
      high,
      low,
      close,
      ycp: positive(raw.ycp),
      volume: num(raw.volume),
      // Scaling by a million leaves float noise (54.661 * 1e6 is not exactly
      // 54,661,000), so round to paisa rather than store a long tail of
      // meaningless digits in a numeric column.
      valueBdt: value === null ? null : Math.round(value * 1_000_000 * 100) / 100,
      trades: num(raw.trades),
      yearlyHigh: positive(raw.yearly_high),
      yearlyLow: positive(raw.yearly_low),
    })
  }

  return { quotes, skipped }
}

export interface Valuation {
  price: number
  /** Trailing, against the most recent reported fiscal year. */
  pe: number | null
  pb: number | null
  dividendYield: number | null
  /** 0 at the 52-week low, 1 at the high. */
  rangePosition: number | null
  aboveLow: number | null
  belowHigh: number | null
}

/**
 * Valuation from a quote and the latest reported per-share figures.
 *
 * Needs no share count: PE is price over EPS and PB is price over NAVPS, both
 * already per-share. Market capitalisation would need shares outstanding, and
 * deriving that from net profit over EPS would be inference, not a fact.
 */
export function computeValuation(
  quote: Pick<PriceQuote, 'close' | 'yearlyHigh' | 'yearlyLow'>,
  latest: { eps?: number | null; navps?: number | null; dividendPerShare?: number | null },
): Valuation {
  const price = quote.close

  const ratioAgainst = (perShare: number | null | undefined) =>
    perShare === null || perShare === undefined || perShare <= 0 ? null : price / perShare

  const { yearlyHigh: high, yearlyLow: low } = quote
  const haveRange = high !== null && low !== null && high > low

  return {
    price,
    // A negative or zero EPS has no meaningful PE — a loss-making company does
    // not have a "very high" one.
    pe: ratioAgainst(latest.eps),
    pb: ratioAgainst(latest.navps),
    dividendYield:
      latest.dividendPerShare === null ||
      latest.dividendPerShare === undefined ||
      latest.dividendPerShare < 0
        ? null
        : latest.dividendPerShare / price,
    rangePosition: haveRange ? (price - low!) / (high! - low!) : null,
    aboveLow: low !== null && low > 0 ? price / low - 1 : null,
    belowHigh: high !== null && high > 0 ? price / high - 1 : null,
  }
}
