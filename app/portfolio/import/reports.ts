import 'server-only'

import { and, eq, gte, inArray, lte } from 'drizzle-orm'

import { db } from '@/db/client'
import { listCompanyNames, listPortfolioTransactions } from '@/db/queries'
import { boAccounts, cashMovements, companies, portfolioTransactions } from '@/db/schema'
import { alreadyRecorded } from '@/lib/dividends'
import type { PortfolioTransaction } from '@/lib/portfolio'
import { parseLankaBanglaDividends } from '@/lib/statements/lankabangla-dividends'
import { parseLankaBanglaLedger } from '@/lib/statements/lankabangla-ledger'
import { parseLankaBanglaPnl } from '@/lib/statements/lankabangla-pnl'
import {
  comparePnl,
  planDividendImport,
  planLedgerImport,
  type LedgerPlan,
  type PlannedCash,
  type PlannedDividend,
  type PlannedTrade,
  type PnlComparison,
} from '@/lib/statements/plan'
import type { TextItem } from '@/lib/statements/types'

/*
 * Broker ledgers and reports: preview and apply. The server actions in
 * ./actions.ts wrap these with the session check; the logic lives here so it
 * takes a database handle rather than a request.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface Header {
  broker: string
  clientCode: string | null
  boIdLast4: string | null
  accountType?: string | null
  from: string | null
  to: string | null
}

export interface LedgerPreview {
  ok: true
  kind: 'ledger'
  message: string
  header: Header & { openingBalance: number; closingBalance: number }
  boId: string | null
  account: { id: number; name: string } | null
  suggestedAccountName: string
  plan: Omit<LedgerPlan, 'replaced'> & {
    replaced: { id: number; symbol: string; tradeDate: string; txnType: string; quantity: number | null }[]
  }
  summary: {
    buys: number
    sells: number
    commission: number
    deposits: number
    withdrawals: number
    fees: number
    dividends: number
  }
}

export interface DividendReportPreview {
  ok: true
  kind: 'dividends'
  message: string
  header: Header
  account: { id: number; name: string }
  dividends: PlannedDividend[]
}

export interface PnlPreview {
  ok: true
  kind: 'pnl'
  message: string
  header: Header
  account: { id: number; name: string } | null
  rows: PnlComparison[]
  total: { broker: number; ledger: number }
}

type Failure = { ok: false; message: string }

async function accountByBoId(boId: string | null) {
  if (!boId) return null
  const [account] = await db
    .select({ id: boAccounts.id, name: boAccounts.name })
    .from(boAccounts)
    .where(eq(boAccounts.boNumber, boId))
    .limit(1)
  return account ?? null
}

const header = (h: { broker: string; clientCode: string | null; boId: string | null; from: string | null; to: string | null }) => ({
  broker: h.broker,
  clientCode: h.clientCode,
  boIdLast4: h.boId ? h.boId.slice(-4) : null,
  from: h.from,
  to: h.to,
})

type LedgerRow = Awaited<ReturnType<typeof listPortfolioTransactions>>[number]

export async function previewLedger(items: TextItem[]): Promise<LedgerPreview | Failure> {
  const parsed = parseLankaBanglaLedger(items)
  if (!parsed.ok) return { ok: false, message: parsed.reason }
  const ledger = parsed.ledger

  const account = await accountByBoId(ledger.boId)
  const existing: LedgerRow[] = account
    ? (await listPortfolioTransactions()).filter((t) => t.accountId === account.id)
    : []
  const known = new Set((await listCompanyNames()).map((c) => c.symbol))
  const plan = planLedgerImport(ledger, existing, known)

  const sum = (kind: PlannedCash['kind']) =>
    plan.cash.filter((c) => c.kind === kind).reduce((s, c) => s + c.amount, 0)

  return {
    ok: true,
    kind: 'ledger',
    message: `Read ${ledger.entries.length} ledger lines, ${ledger.from} to ${ledger.to}.`,
    header: {
      ...header(ledger),
      accountType: ledger.accountType,
      openingBalance: ledger.openingBalance,
      closingBalance: ledger.closingBalance,
    },
    boId: ledger.boId,
    account,
    suggestedAccountName: `LankaBangla ${ledger.clientCode ?? ''} (${ledger.accountType ?? 'account'})`.trim(),
    plan: {
      ...plan,
      replaced: (plan.replaced as LedgerRow[]).map((t) => ({
        id: t.id,
        symbol: t.symbol,
        tradeDate: t.tradeDate,
        txnType: t.txnType,
        quantity: t.quantity,
      })),
    },
    summary: {
      buys: plan.trades.filter((t) => t.txnType === 'buy').length,
      sells: plan.trades.filter((t) => t.txnType === 'sell').length,
      commission: plan.trades.reduce((s, t) => s + t.commission, 0),
      deposits: sum('deposit'),
      withdrawals: -sum('withdrawal'),
      fees: -sum('fee'),
      dividends: sum('dividend'),
    },
  }
}

export async function previewDividendReport(items: TextItem[]): Promise<DividendReportPreview | Failure> {
  const parsed = parseLankaBanglaDividends(items)
  if (!parsed.ok) return { ok: false, message: parsed.reason }
  const report = parsed.ledger
  if (report.issues.length > 0) {
    return { ok: false, message: `The report does not add up: ${report.issues.join('; ')}` }
  }

  const account = await accountByBoId(report.boId)
  if (!account) {
    return {
      ok: false,
      message: 'No BO account has this BO ID yet. Import the account’s ledger or a portfolio statement first — that sets up the account and its shares.',
    }
  }

  const [transactions, names] = await Promise.all([listPortfolioTransactions(), listCompanyNames()])
  return {
    ok: true,
    kind: 'dividends',
    message: `Read ${report.lines.length} dividend(s) for ${account.name}.`,
    header: header(report),
    account,
    dividends: planDividendImport(report, account.id, transactions, names),
  }
}

export async function previewPnl(items: TextItem[]): Promise<PnlPreview | Failure> {
  const parsed = parseLankaBanglaPnl(items)
  if (!parsed.ok) return { ok: false, message: parsed.reason }
  const pnl = parsed.pnl

  const account = await accountByBoId(pnl.boId)
  const [transactions, names] = await Promise.all([listPortfolioTransactions(), listCompanyNames()])
  const { rows, total } = account
    ? comparePnl(pnl, account.id, transactions, names)
    : { rows: [], total: { broker: pnl.total ?? 0, ledger: 0 } }

  return {
    ok: true,
    kind: 'pnl',
    message: account
      ? `Compared the broker's profit and loss with ${account.name}'s ledger.`
      : 'No BO account has this BO ID yet — import its ledger first, then this report checks it.',
    header: header(pnl),
    account,
    rows,
    total,
  }
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The account a document belongs to: the one the preview matched, or a new
 * one for its BO ID — reusing an account created meanwhile for the same BO ID
 * rather than colliding with it.
 */
export async function resolveAccount(
  tx: Tx,
  formData: FormData,
  broker: string | null,
  label: string,
): Promise<{ id: number; name: string } | { error: string }> {
  const accountId = Number(formData.get('accountId')) || null
  if (accountId) {
    const [existing] = await tx
      .select({ id: boAccounts.id, name: boAccounts.name })
      .from(boAccounts)
      .where(eq(boAccounts.id, accountId))
      .limit(1)
    return existing ?? { error: 'That BO account no longer exists.' }
  }

  const boNumber = String(formData.get('boId') ?? '').trim() || null
  if (boNumber && !/^\d{16}$/.test(boNumber)) return { error: 'Bad BO ID on the document.' }
  if (boNumber) {
    const [existing] = await tx
      .select({ id: boAccounts.id, name: boAccounts.name })
      .from(boAccounts)
      .where(eq(boAccounts.boNumber, boNumber))
      .limit(1)
    if (existing) return existing
  }

  const name = String(formData.get('newAccountName') ?? '').trim()
  if (!name) return { error: 'Name the new BO account.' }
  const [clash] = await tx.select({ id: boAccounts.id }).from(boAccounts).where(eq(boAccounts.name, name)).limit(1)
  if (clash) return { error: `There is already an account called "${name}".` }

  const [created] = await tx
    .insert(boAccounts)
    .values({ name, boNumber, broker, notes: `Created from the ${label}.` })
    .returning({ id: boAccounts.id, name: boAccounts.name })
  return created
}

const SYMBOL = /^[A-Z0-9][A-Z0-9&\-.]{1,19}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CASH_KINDS = ['deposit', 'withdrawal', 'fee', 'dividend', 'ipo'] as const

/** Everything the browser sent back is re-checked; none of it is trusted. */
export function validLedgerPlan(value: unknown, from: string, to: string): string | null {
  const plan = value as { trades?: unknown; cash?: unknown; replaced?: unknown; newSymbols?: unknown }
  if (!plan || !Array.isArray(plan.trades) || !Array.isArray(plan.cash) || !Array.isArray(plan.replaced)) {
    return 'The import plan could not be read.'
  }
  const inRange = (d: unknown) => typeof d === 'string' && DATE.test(d) && d >= from && d <= to
  for (const t of plan.trades as PlannedTrade[]) {
    if (
      !inRange(t.date) ||
      !['buy', 'sell'].includes(t.txnType) ||
      !SYMBOL.test(t.symbol) ||
      !Number.isInteger(t.quantity) || t.quantity <= 0 ||
      !(t.pricePerShare > 0) || !Number.isFinite(t.pricePerShare) ||
      !(t.commission >= 0)
    ) {
      return `A trade in the plan is malformed (${t?.date} ${t?.symbol}).`
    }
  }
  for (const c of plan.cash as PlannedCash[]) {
    const signOk =
      c.kind === 'deposit' || c.kind === 'dividend' ? c.amount > 0 : c.kind === 'withdrawal' || c.kind === 'fee' ? c.amount < 0 : c.amount !== 0
    if (!inRange(c.date) || !(CASH_KINDS as readonly string[]).includes(c.kind) || !Number.isFinite(c.amount) || !signOk) {
      return `A cash line in the plan is malformed (${c?.date} ${c?.kind}).`
    }
  }
  return null
}

/**
 * Write a ledger's history for one account: its trades replace the account's
 * buys and sells in the period, its cash lines replace the account's cash
 * movements in the period. Doing both as replacements is what makes
 * importing the same ledger twice — or an overlapping one — safe.
 *
 * @param expectedReplaced  the ids the preview showed as being replaced. If
 *   the account's trades in the period are no longer exactly those, something
 *   changed since the preview and nothing is written.
 */
export async function applyLedger(
  tx: Tx,
  accountId: number,
  plan: { from: string; to: string; trades: PlannedTrade[]; cash: PlannedCash[] },
  expectedReplaced: number[],
  source: string,
): Promise<{ ok: boolean; message: string }> {
  const current = await tx
    .select({ id: portfolioTransactions.id })
    .from(portfolioTransactions)
    .where(
      and(
        eq(portfolioTransactions.boAccountId, accountId),
        inArray(portfolioTransactions.txnType, ['buy', 'sell']),
        gte(portfolioTransactions.tradeDate, plan.from),
        lte(portfolioTransactions.tradeDate, plan.to),
      ),
    )
  const currentIds = current.map((r) => r.id).sort((a, b) => a - b)
  const expected = [...expectedReplaced].sort((a, b) => a - b)
  if (currentIds.join(',') !== expected.join(',')) {
    return { ok: false, message: 'The account’s trades changed since the preview. Upload the ledger again.' }
  }

  // Companies the account traded that are not in the database yet: added as
  // untracked, so they are in the ledger without joining the screener.
  const symbols = [...new Set(plan.trades.map((t) => t.symbol))]
  const existing = symbols.length
    ? await tx.select({ id: companies.id, symbol: companies.dseSymbol }).from(companies).where(inArray(companies.dseSymbol, symbols))
    : []
  const ids = new Map(existing.map((c) => [c.symbol, c.id]))
  const added: string[] = []
  for (const symbol of symbols.filter((s) => !ids.has(s))) {
    const [row] = await tx
      .insert(companies)
      .values({
        dseSymbol: symbol,
        name: symbol,
        // Unknown until researched; the note says so.
        fiscalYearEndMonth: 6,
        fiscalYearEndDay: 30,
        isTracked: false,
        notes: `Added from a broker ledger because you traded it. Name and fiscal year end not verified.`,
      })
      .returning({ id: companies.id })
    ids.set(symbol, row.id)
    added.push(symbol)
  }

  if (currentIds.length > 0) {
    await tx.delete(portfolioTransactions).where(inArray(portfolioTransactions.id, currentIds))
  }
  if (plan.trades.length > 0) {
    await tx.insert(portfolioTransactions).values(
      plan.trades.map((t) => ({
        companyId: ids.get(t.symbol)!,
        boAccountId: accountId,
        tradeDate: t.date,
        txnType: t.txnType,
        quantity: String(t.quantity),
        pricePerShare: String(t.pricePerShare),
        commission: String(t.commission),
        taxWithheld: '0',
        notes: `From the ${source}.`,
      })),
    )
  }

  await tx
    .delete(cashMovements)
    .where(
      and(
        eq(cashMovements.boAccountId, accountId),
        gte(cashMovements.movementDate, plan.from),
        lte(cashMovements.movementDate, plan.to),
      ),
    )
  if (plan.cash.length > 0) {
    await tx.insert(cashMovements).values(
      plan.cash.map((c) => ({
        boAccountId: accountId,
        movementDate: c.date,
        kind: c.kind,
        amount: String(c.amount),
        description: c.description.slice(0, 300),
        source,
      })),
    )
  }

  return {
    ok: true,
    message:
      `Recorded ${plan.trades.length} trades and ${plan.cash.length} cash movements` +
      (currentIds.length > 0 ? `, replacing ${currentIds.length} earlier entr${currentIds.length === 1 ? 'y' : 'ies'}` : '') +
      (added.length > 0 ? `. Added ${added.join(', ')} as untracked companies` : '') +
      '.',
  }
}

/** Record the ticked dividends, skipping any the ledger already has. */
export async function applyDividends(
  tx: Tx,
  accountId: number,
  dividends: PlannedDividend[],
  source: string,
): Promise<{ ok: boolean; message: string }> {
  const rows = await tx.query.portfolioTransactions.findMany({
    where: eq(portfolioTransactions.boAccountId, accountId),
    with: { company: { columns: { dseSymbol: true, id: true } } },
  })
  const ledger: PortfolioTransaction[] = rows.map((t) => ({
    accountId: t.boAccountId,
    symbol: t.company.dseSymbol,
    tradeDate: t.tradeDate,
    txnType: t.txnType,
    quantity: t.quantity === null ? null : Number(t.quantity),
    pricePerShare: t.pricePerShare === null ? null : Number(t.pricePerShare),
    grossAmount: t.grossAmount === null ? null : Number(t.grossAmount),
    commission: Number(t.commission),
    taxWithheld: Number(t.taxWithheld),
  }))

  const symbols = [...new Set(dividends.map((d) => d.symbol).filter((s): s is string => !!s))]
  const found = symbols.length
    ? await tx.select({ id: companies.id, symbol: companies.dseSymbol }).from(companies).where(inArray(companies.dseSymbol, symbols))
    : []
  const ids = new Map(found.map((c) => [c.symbol, c.id]))

  const recorded: string[] = []
  const skipped: string[] = []
  for (const d of dividends) {
    const id = d.symbol ? ids.get(d.symbol) : undefined
    if (!d.symbol || !id) {
      skipped.push(`${d.companyName} (no matching company)`)
      continue
    }
    if (alreadyRecorded(ledger, accountId, d.symbol, d.gross, d.recordDate)) {
      skipped.push(`${d.symbol} (already recorded)`)
      continue
    }
    await tx.insert(portfolioTransactions).values({
      companyId: id,
      boAccountId: accountId,
      tradeDate: d.date,
      txnType: 'dividend',
      grossAmount: String(d.gross),
      taxWithheld: String(d.taxWithheld),
      commission: '0',
      notes: `From the ${source}. Record date ${d.recordDate}; ${d.holding} shares${d.paidVia === 'elsewhere' ? '; paid outside the broker, tax assumed' : ''}.`,
    })
    ledger.push({
      accountId,
      symbol: d.symbol,
      tradeDate: d.date,
      txnType: 'dividend',
      quantity: null,
      pricePerShare: null,
      grossAmount: d.gross,
      commission: 0,
      taxWithheld: d.taxWithheld,
    })
    recorded.push(`${d.symbol} ৳${d.gross.toFixed(2)}`)
  }

  return {
    ok: recorded.length > 0,
    message:
      (recorded.length > 0 ? `Recorded ${recorded.join(', ')}.` : 'Nothing recorded.') +
      (skipped.length > 0 ? ` Skipped ${skipped.join('; ')}.` : ''),
  }
}
