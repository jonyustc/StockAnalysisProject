/**
 * Compare a broker statement with the ledger for one BO account.
 *
 * The ledger is the source of truth; the statement is a check on it. So this
 * never changes anything — it proposes transactions that would make the two
 * agree, and the person decides.
 *
 * A snapshot says THAT a quantity changed, never WHY, WHEN, or at WHAT PRICE.
 * Every proposal that has to guess one of those says so, and is left
 * unselected by default. Only an opening balance on a first import is
 * unambiguous enough to pre-select.
 */

import type { Holding } from '../portfolio'
import type { StatementHolding } from './types'

export type SuggestionKind =
  /** In the statement, not in the ledger at all: record it as an opening position. */
  | 'opening'
  /** Statement holds more than the ledger. */
  | 'increase'
  /** Statement holds less than the ledger. */
  | 'decrease'
  /** In the ledger, gone from the statement. */
  | 'exit'
  /** Quantities agree. */
  | 'match'

export interface ProposedTransaction {
  txnType: 'buy' | 'bonus' | 'sell'
  quantity: number
  pricePerShare: number
}

export interface Suggestion {
  kind: SuggestionKind
  symbol: string
  statementQty: number
  ledgerQty: number
  delta: number
  statementCost: number | null
  ledgerCost: number
  proposed: ProposedTransaction | null
  /** Plain-language explanation shown next to the row. */
  note: string
  /** Something this proposal had to guess. Shown prominently. */
  caveat: string | null
  selected: boolean
}

/** A cost figure counts as unchanged within half a percent, or a taka. */
function sameCost(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005)
}

export function reconcile(
  statementHoldings: StatementHolding[],
  ledgerPositions: Holding[],
): Suggestion[] {
  const statement = new Map(statementHoldings.map((h) => [h.symbol, h]))
  const ledger = new Map(ledgerPositions.filter((p) => p.quantity > 0).map((p) => [p.symbol, p]))

  const symbols = [...new Set([...statement.keys(), ...ledger.keys()])].sort()

  return symbols.map((symbol): Suggestion => {
    const s = statement.get(symbol)
    const l = ledger.get(symbol)

    const statementQty = s?.totalQty ?? 0
    const ledgerQty = l?.quantity ?? 0
    const ledgerCost = l?.costBasis ?? 0
    const delta = statementQty - ledgerQty

    const base = {
      symbol,
      statementQty,
      ledgerQty,
      delta,
      statementCost: s?.costAmount ?? null,
      ledgerCost,
    }

    if (s && !l) {
      return {
        ...base,
        kind: 'opening',
        // The broker's cost AMOUNT is exact; their printed price is rounded.
        proposed: { txnType: 'buy', quantity: statementQty, pricePerShare: s.costAmount / statementQty },
        note: `Record ${statementQty.toLocaleString()} shares at the broker's cost of ৳${s.costAmount.toLocaleString()} as an opening position.`,
        caveat: null,
        selected: true,
      }
    }

    if (!s && l) {
      return {
        ...base,
        kind: 'exit',
        proposed: null,
        note: `The ledger holds ${ledgerQty.toLocaleString()}, but the statement shows none — sold, or transferred out?`,
        caveat: 'The statement does not say at what price. Record the sale yourself with the real price, so the realised gain is right.',
        selected: false,
      }
    }

    // Both present.
    if (delta === 0) {
      const costNote =
        s && !sameCost(s.costAmount, ledgerCost)
          ? ` Broker's cost is ৳${s.costAmount.toLocaleString()} against ৳${ledgerCost.toFixed(2)} here — brokers often treat commission and bonus shares differently, so this is information, not an error.`
          : ''
      return {
        ...base,
        kind: 'match',
        proposed: null,
        note: `${statementQty.toLocaleString()} in both.${costNote}`,
        caveat: null,
        selected: false,
      }
    }

    if (delta > 0 && s) {
      // More shares but the same total cost: shares arrived without money
      // leaving — a bonus issue is by far the likeliest explanation.
      const looksLikeBonus = sameCost(s.costAmount, ledgerCost)
      const extraCost = s.costAmount - ledgerCost

      return {
        ...base,
        kind: 'increase',
        proposed: looksLikeBonus
          ? { txnType: 'bonus', quantity: delta, pricePerShare: 0 }
          : { txnType: 'buy', quantity: delta, pricePerShare: Math.max(extraCost, 0) / delta },
        note: looksLikeBonus
          ? `${delta.toLocaleString()} more shares with no change in cost — looks like a bonus issue.`
          : `${delta.toLocaleString()} more shares, and ৳${extraCost.toFixed(2)} more cost — looks like a purchase at about ৳${(extraCost / delta).toFixed(2)}.`,
        caveat: looksLikeBonus
          ? 'Check it really was a bonus. If it was a purchase that happened to cost almost nothing, this would understate your cost.'
          : 'Price is derived from the change in the broker’s cost figure, so it includes their commission. Dated as of the statement, not the actual trade day.',
        selected: false,
      }
    }

    // delta < 0
    return {
      ...base,
      kind: 'decrease',
      proposed: null,
      note: `${Math.abs(delta).toLocaleString()} fewer shares than the ledger holds — a sale not yet recorded?`,
      caveat: 'The statement does not say at what price. Record the sale yourself with the real price, so the realised gain is right.',
      selected: false,
    }
  })
}
