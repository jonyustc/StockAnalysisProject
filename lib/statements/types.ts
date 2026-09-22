/**
 * Broker statements, as parsed.
 *
 * A statement is a snapshot of what an account holds on one date. It is never
 * the source of truth — the transaction ledger is — so everything here exists
 * to be compared against the ledger, not to replace it.
 */

/** One piece of text on a PDF page, with the position it was drawn at. */
export interface TextItem {
  str: string
  x: number
  /** PDF space: larger is higher up the page. */
  y: number
  page: number
}

export interface StatementHolding {
  symbol: string
  category: string | null
  saleableQty: number
  /** Not yet tradeable, e.g. recently credited bonus shares or IPO lock-in. */
  lockQty: number
  lienQty: number
  totalQty: number
  /** The broker's average price, rounded to 2 decimals for display. */
  costPrice: number
  /** The broker's total cost. Exact — use this, not qty x costPrice. */
  costAmount: number
  marketPrice: number
  marketValue: number
  unrealised: number
  /** Arithmetic that did not add up. A holding with issues is not imported. */
  issues: string[]
}

export interface DividendReceivable {
  companyName: string
  holding: number
  /** Per share, as the statement prints it. */
  rate: number
  /** Gross cash due. */
  entitlement: number
  recordDate: string | null
}

/**
 * The account-level totals printed under the holdings: "Account Status Till
 * Today". Lifetime figures, so they carry the history of sales and dividends
 * that the holdings table alone does not.
 */
export interface AccountStatus {
  /** Holdings at market ("Total Portfolio Value"). */
  marketValue: number | null
  /** The broker's margin equity: LOWER of cost and market, plus cash. Not a valuation. */
  equity: number | null

  deposit: number | null
  ipoRefund: number | null
  cashDividend: number | null
  shareTransferIn: number | null
  totalDeposit: number | null

  withdraw: number | null
  ipoPayment: number | null
  shareTransferOut: number | null
  totalWithdraw: number | null

  /** Lifetime realised gain on sales, as the broker computes it. */
  realisedGain: number | null
}

export interface ParsedStatement {
  broker: string
  format: string
  clientCode: string | null
  boId: string | null
  accountType: string | null
  /** ISO date the positions are stated as of. */
  asOf: string
  holdings: StatementHolding[]
  totals: { costAmount: number; marketValue: number; unrealised: number } | null
  cashBalance: number | null
  accountStatus: AccountStatus | null
  dividendsReceivable: DividendReceivable[]
  /** Problems with the statement as a whole, e.g. totals that do not sum. */
  issues: string[]
}

export type ParseResult =
  | { ok: true; statement: ParsedStatement }
  | { ok: false; reason: string }
