/**
 * Cash dividends: what has arrived, what is on its way, and what the holdings
 * should pay in a year.
 *
 * Three sources, kept apart because they answer different questions:
 *
 *   - the ledger's dividend transactions: received, per stock, gross and tax;
 *   - broker statements' "receivable" list: declared, not yet paid;
 *   - reported dividend per share: what the holdings would pay if the company
 *     repeats its last year. A projection, and labelled as one.
 */

import type { PortfolioTransaction } from './portfolio'

/** A declared, unpaid dividend as a statement prints it, plus a matched symbol. */
export interface StoredReceivable {
  companyName: string
  /** Null when no tracked company's name matches. */
  symbol: string | null
  holding: number
  /** Per share, in taka. */
  rate: number
  /** Gross cash due. */
  entitlement: number
  recordDate: string | null
}

export interface CompanyName {
  symbol: string
  name: string
  shortName: string | null
}

/** Words that differ between how a broker and a company write the same name. */
const NOISE = new Set(['limited', 'ltd', 'plc', 'company', 'co', 'the', 'inc'])

export function normaliseCompanyName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !NOISE.has(word))
}

/**
 * The tracked company a statement's name refers to, or null.
 *
 * Statements abbreviate ("Marico Bangladesh" for "Marico Bangladesh Limited"),
 * so a match is one name's words being the start of the other's. The longest
 * such match wins — "BSRM Steels" must not lose to "BSRM Ltd", which is just
 * "BSRM" once "Ltd" is dropped. A tie between two companies is refused rather
 * than guessed.
 */
export function matchCompany(name: string, companies: CompanyName[]): string | null {
  const words = normaliseCompanyName(name)
  if (words.length === 0) return null

  const startsWith = (a: string[], b: string[]) => b.length > 0 && b.every((w, i) => a[i] === w)

  const scored = companies.map((company) => {
    const score = Math.max(
      0,
      ...[company.name, company.shortName, company.symbol]
        .filter((n): n is string => !!n)
        .map(normaliseCompanyName)
        .filter((c) => startsWith(words, c) || startsWith(c, words))
        .map((c) => Math.min(c.length, words.length)),
    )
    return { symbol: company.symbol, score }
  })

  const best = Math.max(0, ...scored.map((s) => s.score))
  if (best === 0) return null
  const winners = scored.filter((s) => s.score === best)
  return winners.length === 1 ? winners[0].symbol : null
}

/** Same dividend on two statements: same company, same record date. */
function sameDividend(a: StoredReceivable, b: StoredReceivable): boolean {
  return a.companyName === b.companyName && a.recordDate === b.recordDate
}

export interface PaidDividend {
  receivable: StoredReceivable
  gross: number
  taxWithheld: number
  /** Why the split between gross and tax should be checked, if it should. */
  caveat: string | null
}

export interface PaidDetection {
  paid: PaidDividend[]
  /**
   * Dividend cash that arrived with no receivable to explain it — declared and
   * paid between two imports, so it never appeared on a statement's list.
   */
  unexplained: number
}

/**
 * DSE cash dividends are paid net of withholding tax: 10% for an individual
 * with a TIN, 15% without one. Outside roughly that band the split is a guess.
 */
const PLAUSIBLE_NET_SHARE = { low: 0.8, high: 1 }

/**
 * Which receivables on the previous statement have been paid by this one.
 *
 * A receivable that has left the list was either paid or cancelled; the
 * lifetime "Cash Dividend" total rising says which. The total arrives net of
 * tax and is not broken down, so when several are paid at once the net is
 * shared in proportion to their entitlement — exact when the tax rate is the
 * same for each, which it is for one person's account.
 *
 * @param credited  rise in the lifetime cash-dividend total between the two.
 */
export function detectPaidDividends(
  previous: StoredReceivable[],
  current: StoredReceivable[],
  credited: number,
): PaidDetection {
  const gone = previous.filter((p) => !current.some((c) => sameDividend(p, c)))
  const arrived = Math.max(0, credited)

  if (gone.length === 0 || arrived < 0.005) {
    return { paid: [], unexplained: gone.length === 0 ? arrived : 0 }
  }

  const due = gone.reduce((sum, r) => sum + r.entitlement, 0)
  if (due <= 0) return { paid: [], unexplained: arrived }

  const netShare = Math.min(1, arrived / due)
  const plausible = netShare >= PLAUSIBLE_NET_SHARE.low && netShare <= PLAUSIBLE_NET_SHARE.high

  const paid = gone.map((receivable) => {
    const gross = receivable.entitlement
    const net = round2(gross * netShare)
    return {
      receivable,
      gross,
      taxWithheld: round2(gross - net),
      caveat: plausible
        ? null
        : `Only ${(netShare * 100).toFixed(0)}% of what was due arrived — perhaps not all of it has been paid yet. Check the tax before recording.`,
    }
  })

  const accounted = paid.reduce((sum, p) => sum + (p.gross - p.taxWithheld), 0)
  return { paid, unexplained: round2(Math.max(0, arrived - accounted)) }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Cash dividends are paid within weeks of the record date; allow a season. */
const PAYMENT_WINDOW_DAYS = 120

/**
 * Whether the ledger already has this dividend. Stops a dividend recorded by
 * hand being offered again by the next import, and the reverse.
 *
 * The record date identifies a dividend: a company can pay two equal
 * interims, so the amount alone does not. When both sides know it, it must
 * match. A row recorded without one is matched by amount, paid within a
 * season after the record date — not merely "any time after", which would
 * let an earlier interim's payment hide a later, equal one.
 */
export function alreadyRecorded(
  transactions: Pick<PortfolioTransaction, 'accountId' | 'symbol' | 'txnType' | 'grossAmount' | 'tradeDate' | 'recordDate'>[],
  accountId: number,
  symbol: string,
  gross: number,
  recordDate: string | null,
): boolean {
  const latest = recordDate ? addDays(recordDate, PAYMENT_WINDOW_DAYS) : null

  return transactions.some((t) => {
    if (t.txnType !== 'dividend' || t.accountId !== accountId || t.symbol !== symbol) return false
    if (recordDate && t.recordDate) return t.recordDate === recordDate
    if (Math.abs((t.grossAmount ?? 0) - gross) >= 0.01) return false
    return recordDate === null || (t.tradeDate >= recordDate && t.tradeDate <= latest!)
  })
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10)
}

export interface YearIncome {
  year: number
  gross: number
  tax: number
  net: number
  payments: number
}

/** Dividends received per calendar year, newest first. */
export function incomeByYear(transactions: PortfolioTransaction[]): YearIncome[] {
  const years = new Map<number, YearIncome>()

  for (const t of transactions) {
    if (t.txnType !== 'dividend') continue
    const year = Number(t.tradeDate.slice(0, 4))
    const row = years.get(year) ?? { year, gross: 0, tax: 0, net: 0, payments: 0 }
    const gross = t.grossAmount ?? 0
    row.gross += gross
    row.tax += t.taxWithheld
    row.net += gross - t.taxWithheld
    row.payments += 1
    years.set(year, row)
  }

  return [...years.values()].sort((a, b) => b.year - a.year)
}

export interface IncomeProjection {
  symbol: string
  quantity: number
  /** Last reported dividend per share, on today's share base. */
  dividendPerShare: number | null
  fiscalYear: number | null
  /** Gross, for a year, if the company repeats its last dividend. */
  annualIncome: number | null
  /** Against what the holding is worth now. */
  yieldOnValue: number | null
  /** Against what the holding cost. */
  yieldOnCost: number | null
}

/**
 * What each holding would pay in a year if the company repeats its last
 * reported dividend. A projection: companies cut, raise and skip dividends.
 */
export function projectIncome(
  holdings: { symbol: string; quantity: number; costBasis: number; marketValue: number | null }[],
  dividends: Map<string, { dividendPerShare: number; fiscalYear: number }>,
): { rows: IncomeProjection[]; annualIncome: number; yieldOnValue: number | null; yieldOnCost: number | null } {
  const rows = holdings
    .filter((h) => h.quantity > 0)
    .map((h) => {
      const latest = dividends.get(h.symbol) ?? null
      const annualIncome = latest ? latest.dividendPerShare * h.quantity : null
      return {
        symbol: h.symbol,
        quantity: h.quantity,
        dividendPerShare: latest?.dividendPerShare ?? null,
        fiscalYear: latest?.fiscalYear ?? null,
        annualIncome,
        yieldOnValue:
          annualIncome !== null && h.marketValue !== null && h.marketValue > 0
            ? annualIncome / h.marketValue
            : null,
        yieldOnCost: annualIncome !== null && h.costBasis > 0 ? annualIncome / h.costBasis : null,
      }
    })
    .sort((a, b) => (b.annualIncome ?? -1) - (a.annualIncome ?? -1))

  // Yields only over holdings with a known dividend, so a missing figure does
  // not read as a zero and drag the average down.
  const known = rows.filter((r) => r.annualIncome !== null)
  const income = known.reduce((sum, r) => sum + r.annualIncome!, 0)
  const value = holdings
    .filter((h) => known.some((r) => r.symbol === h.symbol))
    .reduce((sum, h) => sum + (h.marketValue ?? 0), 0)
  const cost = holdings
    .filter((h) => known.some((r) => r.symbol === h.symbol))
    .reduce((sum, h) => sum + h.costBasis, 0)

  return {
    rows,
    annualIncome: income,
    yieldOnValue: value > 0 ? income / value : null,
    yieldOnCost: cost > 0 ? income / cost : null,
  }
}
