/**
 * Per-share adjustment for corporate actions.
 *
 * This is the single most common way a DSE research database quietly corrupts
 * itself. Bonus shares (stock dividends) and rights issues increase the share
 * count, so an EPS reported in FY2018 is not comparable with one reported in
 * FY2026 unless the earlier figure is restated onto today's share base.
 * Compute a 10-year EPS CAGR without doing this and the answer is fiction —
 * usually flatteringly so, since the share count almost always grows.
 *
 * Convention used throughout: `adjustmentFactor` is a multiplier applied to
 * figures from BEFORE the action. A 10% bonus issue gives 0.909…, so a
 * pre-action EPS of 11.00 becomes 10.00 on the post-action share base.
 *
 * A pure cash dividend does not change the share count and has factor 1.
 */

export type CorporateActionType =
  | 'cash_dividend'
  | 'stock_dividend'
  | 'rights_issue'
  | 'split'
  | 'reverse_split'
  | 'other'

export interface CorporateActionInput {
  actionType: CorporateActionType
  /** The date the adjustment takes effect. */
  exDate?: string | null

  /** Bonus issue, as a percentage of existing holding. DSE quotes 10, 20, 25… */
  stockDividendPct?: number | null

  /** Rights: `rightsNewShares` new for every `rightsPerExisting` held. */
  rightsNewShares?: number | null
  rightsPerExisting?: number | null
  rightsPrice?: number | null
  /** Market price immediately before the rights went ex. */
  cumRightsPrice?: number | null

  /** Split: `splitFrom` shares become `splitTo` shares. */
  splitFrom?: number | null
  splitTo?: number | null
}

/**
 * A bonus issue of X% turns 100 shares into 100 + X. Earnings are unchanged,
 * so per-share figures shrink by 1 / (1 + X/100).
 */
export function stockDividendFactor(pct: number): number {
  if (pct <= -100) {
    throw new RangeError(`Stock dividend of ${pct}% would wipe out the share base`)
  }
  return 1 / (1 + pct / 100)
}

/** `from` shares become `to` shares. A 1-for-2 split gives 0.5. */
export function splitFactor(from: number, to: number): number {
  if (from <= 0 || to <= 0) {
    throw new RangeError(`Split ratio must be positive, got ${from}:${to}`)
  }
  return from / to
}

/**
 * Rights issues are not a pure share-count change: subscribers pay below
 * market, so part of the drop is a real transfer of value and part is dilution.
 * The standard adjustment uses the theoretical ex-rights price.
 *
 *   factor = (M · Pcum + N · P) / ((M + N) · Pcum)
 *
 * where M existing shares carry the right to N new shares at price P, against
 * a cum-rights market price of Pcum.
 *
 * Without a reliable cum-rights price, fall back to the share-count-only
 * adjustment M / (M + N), which over-adjusts but is closer than doing nothing.
 */
export function rightsIssueFactor(params: {
  newShares: number
  perExisting: number
  rightsPrice?: number | null
  cumRightsPrice?: number | null
}): number {
  const { newShares, perExisting, rightsPrice, cumRightsPrice } = params

  if (newShares <= 0 || perExisting <= 0) {
    throw new RangeError(
      `Rights ratio must be positive, got ${newShares} for ${perExisting}`,
    )
  }

  if (
    rightsPrice === null ||
    rightsPrice === undefined ||
    cumRightsPrice === null ||
    cumRightsPrice === undefined ||
    cumRightsPrice <= 0
  ) {
    return perExisting / (perExisting + newShares)
  }

  const theoreticalExRights =
    (perExisting * cumRightsPrice + newShares * rightsPrice) / (perExisting + newShares)

  return theoreticalExRights / cumRightsPrice
}

/** Dispatches to the right calculation for an action. Returns 1 when neutral. */
export function adjustmentFactorFor(action: CorporateActionInput): number {
  switch (action.actionType) {
    case 'cash_dividend':
      // Does not change the share count.
      return 1

    case 'stock_dividend': {
      const pct = action.stockDividendPct
      if (pct === null || pct === undefined || pct === 0) return 1
      return stockDividendFactor(pct)
    }

    case 'rights_issue': {
      const { rightsNewShares, rightsPerExisting } = action
      if (!rightsNewShares || !rightsPerExisting) return 1
      return rightsIssueFactor({
        newShares: rightsNewShares,
        perExisting: rightsPerExisting,
        rightsPrice: action.rightsPrice,
        cumRightsPrice: action.cumRightsPrice,
      })
    }

    case 'split':
    case 'reverse_split': {
      const { splitFrom, splitTo } = action
      if (!splitFrom || !splitTo) return 1
      return splitFactor(splitFrom, splitTo)
    }

    default:
      return 1
  }
}

/**
 * Combined factor for a figure dated `asOf`, given every action on the company.
 *
 * Only actions that went ex AFTER the figure's date affect it — an action that
 * had already happened is baked into the reported number. Actions with no
 * ex-date are skipped rather than guessed at; the entry UI should require one.
 */
export function cumulativeAdjustmentFactor(
  actions: CorporateActionInput[],
  asOf: string,
): number {
  return actions
    .filter((action) => action.exDate != null && action.exDate > asOf)
    .reduce((product, action) => product * adjustmentFactorFor(action), 1)
}

/** Restates a historical per-share figure onto the current share base. */
export function adjustPerShareValue(
  value: number,
  actions: CorporateActionInput[],
  asOf: string,
): number {
  return value * cumulativeAdjustmentFactor(actions, asOf)
}

/**
 * Compound annual growth rate.
 *
 * Returns null rather than a misleading number when the maths is undefined:
 * a non-positive starting value makes CAGR meaningless, and a sign change
 * (a loss-making year to a profitable one) cannot be expressed as a growth
 * rate at all. Both are common in a ten-year DSE history.
 */
export function cagr(
  beginning: number,
  ending: number,
  years: number,
): number | null {
  if (years <= 0) return null
  if (beginning <= 0 || ending <= 0) return null

  return Math.pow(ending / beginning, 1 / years) - 1
}
