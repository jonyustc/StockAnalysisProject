/**
 * Does what is stored agree with the broker?
 *
 * Every figure here is computed two ways — from the ledger this app keeps,
 * and as the broker printed it on the account's latest statement — and the
 * two are compared. Agreement to the paisa means the history is complete and
 * every calculation built on it (average cost, net cost, realised gain,
 * returns) starts from the right numbers. Disagreement says exactly which
 * figure to look at.
 *
 * Nothing here corrects anything. It only reports.
 */

import { buildHolding, cashFlowOf, type PortfolioTransaction } from './portfolio'

export interface Check {
  label: string
  ours: number | null
  broker: number | null
  /** Null when it cannot be checked yet; `detail` says why. */
  ok: boolean | null
  detail?: string
  format: 'money' | 'shares'
}

export interface AccountCheck {
  asOf: string
  /** Ledger coverage: complete from account opening up to the statement date. */
  complete: boolean
  coverage: string
  holdings: Check[]
  account: Check[]
}

export interface CheckInput {
  snapshot: {
    asOf: string
    cashBalance: number
    deposit: number
    withdraw: number
    cashDividend: number
    realisedGain: number
    marketValue: number
    costOfHoldings: number | null
    holdings: { symbol: string; quantity: number; costAmount: number }[]
  }
  /** This account's transactions. */
  transactions: PortfolioTransaction[]
  /** This account's dated cash movements. */
  movements: { date: string; kind: string; amount: number }[]
  /** This account's imported ledger periods. */
  ledgers: { from: string; to: string; openingBalance: number }[]
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance + 1e-9
const DAY = 86_400_000

/**
 * Whether the imported ledgers cover the account, without gaps, from a zero
 * opening balance up to `asOf`. Only then do lifetime totals — cash,
 * deposits, realised gain — have to agree exactly.
 */
export function ledgerCoverage(
  ledgers: CheckInput['ledgers'],
  asOf: string,
): { complete: boolean; description: string } {
  if (ledgers.length === 0) return { complete: false, description: 'No broker ledger imported yet.' }

  const ordered = [...ledgers].sort((a, b) => (a.from < b.from ? -1 : 1))
  const start = ordered.find((l) => near(l.openingBalance, 0, 0.005))
  let reach = start ? start.to : null

  if (start) {
    for (const l of ordered) {
      if (reach && l.from <= new Date(Date.parse(reach) + DAY).toISOString().slice(0, 10) && l.to > reach) reach = l.to
    }
  }

  const span = `${ordered[0].from} to ${ordered.reduce((m, l) => (l.to > m ? l.to : m), ordered[0].to)}`
  if (!start) {
    return { complete: false, description: `Ledgers cover ${span}, but none starts from a zero balance — the history before it is missing.` }
  }
  if (!reach || reach < asOf) {
    return {
      complete: false,
      description: `Ledgers cover ${start.from} to ${reach}; the statement is dated ${asOf}. Import a ledger reaching ${asOf}.`,
    }
  }
  return { complete: true, description: `Ledgers cover the account from ${start.from}, with no gaps, to ${reach}.` }
}

export function checkAccount(input: CheckInput): AccountCheck {
  const { snapshot: s } = input
  const upTo = input.transactions.filter((t) => t.tradeDate <= s.asOf)
  const moves = input.movements.filter((m) => m.date <= s.asOf)
  const coverage = ledgerCoverage(input.ledgers, s.asOf)

  // --- Holdings, stock by stock ----------------------------------------------
  const symbols = [...new Set([...upTo.map((t) => t.symbol), ...s.holdings.map((h) => h.symbol)])].sort()
  const holdings: Check[] = []
  for (const symbol of symbols) {
    const ours = buildHolding(symbol, upTo.filter((t) => t.symbol === symbol), null)
    const theirs = s.holdings.find((h) => h.symbol === symbol)
    if (ours.quantity === 0 && !theirs) continue

    holdings.push({
      label: `${symbol} shares`,
      ours: ours.quantity,
      broker: theirs?.quantity ?? 0,
      ok: s.holdings.length === 0 ? null : ours.quantity === (theirs?.quantity ?? 0),
      detail: s.holdings.length === 0 ? 'This statement was saved before holdings were kept — import it again.' : undefined,
      format: 'shares',
    })
    if (theirs && ours.quantity === theirs.quantity) {
      holdings.push({
        label: `${symbol} cost`,
        ours: ours.costBasis,
        broker: theirs.costAmount,
        ok: near(ours.costBasis, theirs.costAmount, 0.05),
        detail: near(ours.costBasis, theirs.costAmount, 0.05)
          ? undefined
          : 'Same shares, different cost: a trade price or commission differs, or a bonus or rights issue is recorded differently.',
        format: 'money',
      })
    }
  }

  // --- Account totals --------------------------------------------------------
  const needsLedger = coverage.complete ? undefined : coverage.description
  const lifetime = (label: string, ours: number, broker: number, tolerance: number, why?: string): Check => ({
    label,
    ours,
    broker,
    ok: coverage.complete ? near(ours, broker, tolerance) : null,
    detail: coverage.complete ? (near(ours, broker, tolerance) ? undefined : why) : needsLedger,
    format: 'money',
  })

  const sum = (kind: string) => moves.filter((m) => m.kind === kind).reduce((t, m) => t + m.amount, 0)
  const tradeCash = upTo
    .filter((t) => t.txnType === 'buy' || t.txnType === 'sell' || t.txnType === 'rights')
    .reduce((t, x) => t + cashFlowOf(x), 0)
  const cash = moves.reduce((t, m) => t + m.amount, 0) + tradeCash
  const realised = [...new Set(upTo.map((t) => t.symbol))].reduce(
    (t, symbol) => t + buildHolding(symbol, upTo.filter((x) => x.symbol === symbol), null).realisedGain,
    0,
  )
  const dividendsRecorded = upTo
    .filter((t) => t.txnType === 'dividend')
    .reduce((t, x) => t + (x.grossAmount ?? 0) - x.taxWithheld, 0)

  const account: Check[] = [
    lifetime('Cash balance', cash, s.cashBalance, 0.015, 'A trade, deposit or fee is missing or misread — compare the ledger line by line.'),
    lifetime('Deposited', sum('deposit'), s.deposit, 0.005, 'A deposit is missing: import a ledger covering it.'),
    lifetime('Withdrawn', Math.abs(sum('withdrawal')), s.withdraw, 0.005, 'A withdrawal is missing: import a ledger covering it.'),
    lifetime('Dividends into the account', sum('dividend'), s.cashDividend, 0.005, 'A dividend receipt is missing from the ledger.'),
    lifetime('Realised gain', realised, s.realisedGain, 0.05, 'A sale, or a purchase before it, differs from the broker’s.'),
    {
      label: 'Dividends recorded against stocks',
      ours: dividendsRecorded,
      broker: s.cashDividend,
      // Dividends paid straight to a bank are recorded here but never pass
      // through the broker, so this may exceed the broker's figure — never
      // fall short of it.
      ok: coverage.complete ? dividendsRecorded >= s.cashDividend - 0.01 : null,
      detail: !coverage.complete
        ? needsLedger
        : dividendsRecorded >= s.cashDividend - 0.01
          ? dividendsRecorded > s.cashDividend + 0.01
            ? 'Higher than the broker’s: includes dividends paid straight to your bank.'
            : undefined
          : 'The broker credited dividends that are not recorded against a stock — import the dividend report.',
      format: 'money',
    },
  ]

  return { asOf: s.asOf, complete: coverage.complete, coverage: coverage.description, holdings, account }
}
