'use server'

import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { listCompanyNames, listPortfolioTransactions } from '@/db/queries'
import {
  accountSnapshots,
  boAccounts,
  companies,
  portfolioTransactions,
  type SnapshotHolding,
} from '@/db/schema'
import { lifetimeReturn, type LifetimeReturn } from '@/lib/account-return'
import {
  alreadyRecorded,
  detectPaidDividends,
  matchCompany,
  type StoredReceivable,
} from '@/lib/dividends'
import { buildPortfolio, type PortfolioTransaction } from '@/lib/portfolio'
import { hasSession, NOT_SIGNED_IN } from '@/lib/session'
import { extractTextItems, looksScanned } from '@/lib/statements/extract'
import { DSE_MAX_YEARS, fetchDseHistory } from '@/lib/dse-fetch'
import { fetchDsePage } from '@/lib/dse-http'
import { yearsAgo } from '@/lib/insight-inputs'
import { detectDocument } from '@/lib/statements/detect'
import { dhakaNow } from '@/lib/trading-calendar'
import { parseLankaBanglaPortfolio } from '@/lib/statements/lankabangla'
import type { PlannedDividend } from '@/lib/statements/plan'
import { reconcile, type Suggestion } from '@/lib/statements/reconcile'
import type { ParsedStatement } from '@/lib/statements/types'

import {
  applyDividends,
  applyLedger,
  previewDividendReport,
  previewLedger,
  previewPnl,
  resolveAccount,
  validLedgerPlan,
  type DividendReportPreview,
  type LedgerPreview,
  type PnlPreview,
} from './reports'
import { applyPrices, cleanPriceRows, planPrices, previewPrices, type PricesPreview } from './prices'

/** Well above a real statement (~65 KB), well below the action body limit. */
const MAX_BYTES = 3 * 1024 * 1024

export type ImportPreview =
  | StatementPreview
  | LedgerPreview
  | DividendReportPreview
  | PnlPreview
  | PricesPreview

export interface StatementPreview {
  kind?: 'portfolio'
  ok: boolean
  message: string
  statement?: Omit<ParsedStatement, 'boId'> & { boIdLast4: string | null }
  /** The full BO ID travels back only so a new account can be created with it. */
  boId?: string | null
  account?: { id: number; name: string } | null
  suggestedAccountName?: string
  suggestions?: (Suggestion & { tracked: boolean })[]
  untracked?: string[]
  /** Account totals to store as a snapshot, and the lifetime return they imply. */
  snapshot?: SnapshotFigures | null
  lifetime?: LifetimeReturn | null
  /** Dividends declared on the last statement that this one shows were paid. */
  dividends?: DividendSuggestion[]
  /** Dividend cash that arrived since the last statement with no declared dividend to explain it. */
  unexplainedDividendCash?: number
  /** The statement the dividends were compared with, if there was one. */
  previousAsOf?: string | null
}

export interface DividendSuggestion {
  key: string
  symbol: string | null
  companyName: string
  recordDate: string | null
  gross: number
  taxWithheld: number
  caveat: string | null
  /** Already in the ledger — recorded by hand, or by an earlier import. */
  recorded: boolean
}

/** What a snapshot stores, as the broker printed it. */
export interface SnapshotFigures {
  marketValue: number
  costOfHoldings: number | null
  cashBalance: number
  deposit: number
  ipoRefund: number
  cashDividend: number
  shareTransferIn: number
  withdraw: number
  ipoPayment: number
  shareTransferOut: number
  realisedGain: number
  dividendsReceivable: StoredReceivable[]
  /** Each holding as printed, for checking the ledger against later. */
  holdings: SnapshotHolding[]
}

function snapshotFrom(
  statement: ParsedStatement,
  receivables: StoredReceivable[],
): SnapshotFigures | null {
  const status = statement.accountStatus
  const marketValue = status?.marketValue ?? statement.totals?.marketValue ?? null
  if (!status || marketValue === null || statement.cashBalance === null) return null

  return {
    marketValue,
    costOfHoldings: statement.totals?.costAmount ?? null,
    cashBalance: statement.cashBalance,
    deposit: status.deposit ?? 0,
    ipoRefund: status.ipoRefund ?? 0,
    cashDividend: status.cashDividend ?? 0,
    shareTransferIn: status.shareTransferIn ?? 0,
    withdraw: status.withdraw ?? 0,
    ipoPayment: status.ipoPayment ?? 0,
    shareTransferOut: status.shareTransferOut ?? 0,
    realisedGain: status.realisedGain ?? 0,
    dividendsReceivable: receivables,
    holdings: statement.holdings.map((h) => ({
      symbol: h.symbol,
      quantity: h.totalQty,
      costAmount: h.costAmount,
    })),
  }
}

/**
 * Read a statement and compare it with the ledger. Writes nothing.
 *
 * The PDF is read in memory and discarded when this returns. It is never
 * written to disk, to the database, or to storage.
 */
export async function previewStatement(
  _previous: ImportPreview | null,
  formData: FormData,
): Promise<ImportPreview> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const file = formData.get('statement')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a file first.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the most this reads is 3 MB.` }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46

  // A broker document is a PDF; a price history is text. Decided from the
  // file itself, not from its name.
  if (!isPdf) {
    const text = new TextDecoder().decode(bytes)
    // Anything with a null byte is some other binary, not a CSV.
    if (text.includes('\0')) {
      return { ok: false, message: 'That file is neither a PDF nor a text file of prices.' }
    }
    return previewPrices(text, String(formData.get('symbol') ?? '').toUpperCase() || undefined)
  }

  let items
  try {
    items = await extractTextItems(bytes)
  } catch (error) {
    return { ok: false, message: `Could not read the PDF: ${error instanceof Error ? error.message : 'unknown error'}` }
  }

  if (looksScanned(items)) {
    return {
      ok: false,
      message: 'This PDF has no text layer — it looks like a scan. Only statements your broker generates as text can be read reliably.',
    }
  }

  // Ledgers and reports have their own previews; a portfolio statement is
  // handled below.
  const kind = detectDocument(items)
  if (kind === 'ledger') return previewLedger(items)
  if (kind === 'dividends') return previewDividendReport(items)
  if (kind === 'pnl') return previewPnl(items)
  if (kind === null) {
    return {
      ok: false,
      message:
        'Not a document this can read. It reads LankaBangla portfolio statements, client ledgers, cash dividend ledgers and profit/loss analyses.',
    }
  }

  const parsed = parseLankaBanglaPortfolio(items)
  if (!parsed.ok) return { ok: false, message: parsed.reason }

  const statement = parsed.statement

  // Match the statement to a BO account by its BO ID.
  const [account] = statement.boId
    ? await db
        .select({ id: boAccounts.id, name: boAccounts.name })
        .from(boAccounts)
        .where(eq(boAccounts.boNumber, statement.boId))
        .limit(1)
    : []

  const symbols = statement.holdings.map((h) => h.symbol)
  const known = symbols.length
    ? await db
        .select({ symbol: companies.dseSymbol })
        .from(companies)
        .where(inArray(companies.dseSymbol, symbols))
    : []
  const trackedSymbols = new Set(known.map((k) => k.symbol))

  // The ledger positions for this account only. A new account has none.
  let positions: ReturnType<typeof buildPortfolio>['positions'] = []
  let ledger: PortfolioTransaction[] = []
  if (account) {
    ledger = await listPortfolioTransactions()
    positions = buildPortfolio(ledger, new Map(), new Date(), account.id).positions
  }

  const names = await listCompanyNames()
  const receivables: StoredReceivable[] = statement.dividendsReceivable.map((r) => ({
    ...r,
    symbol: matchCompany(r.companyName, names),
  }))

  // Holdings whose own arithmetic failed are left out entirely.
  const clean = statement.holdings.filter((h) => h.issues.length === 0)

  const suggestions = reconcile(clean, positions).map((s) => ({
    ...s,
    tracked: trackedSymbols.has(s.symbol) || s.ledgerQty > 0,
    // Nothing can be recorded for a company that is not in the database.
    selected: s.selected && (trackedSymbols.has(s.symbol) || s.ledgerQty > 0),
  }))

  const { boId, ...rest } = statement

  // Figures with issues do not become a snapshot: a stored total that does not
  // add up would quietly skew every return computed from it afterwards.
  const snapshot = statement.issues.length === 0 ? snapshotFrom(statement, receivables) : null

  // Which dividends declared on the previous statement this one shows paid.
  const [previous] =
    account && snapshot
      ? await db
          .select({
            asOf: accountSnapshots.asOf,
            cashDividend: accountSnapshots.cashDividend,
            dividendsReceivable: accountSnapshots.dividendsReceivable,
          })
          .from(accountSnapshots)
          .where(and(eq(accountSnapshots.boAccountId, account.id), lt(accountSnapshots.asOf, statement.asOf)))
          .orderBy(desc(accountSnapshots.asOf))
          .limit(1)
      : []

  const detection =
    previous && snapshot
      ? detectPaidDividends(
          previous.dividendsReceivable,
          receivables,
          snapshot.cashDividend - Number(previous.cashDividend),
        )
      : null

  const dividends: DividendSuggestion[] = (detection?.paid ?? []).map((p) => ({
    key: `${p.receivable.companyName}|${p.receivable.recordDate ?? ''}`,
    symbol: p.receivable.symbol,
    companyName: p.receivable.companyName,
    recordDate: p.receivable.recordDate,
    gross: p.gross,
    taxWithheld: p.taxWithheld,
    caveat: p.caveat,
    recorded:
      !!account &&
      !!p.receivable.symbol &&
      alreadyRecorded(ledger, account.id, p.receivable.symbol, p.gross, p.receivable.recordDate),
  }))

  return {
    snapshot,
    lifetime: snapshot ? lifetimeReturn({ asOf: statement.asOf, ...snapshot }) : null,
    dividends,
    unexplainedDividendCash: detection?.unexplained ?? 0,
    previousAsOf: previous?.asOf ?? null,
    ok: true,
    message: account
      ? `Read ${statement.holdings.length} holding(s) for ${account.name}, as of ${statement.asOf}.`
      : `Read ${statement.holdings.length} holding(s). No BO account matches this statement yet — one will be created.`,
    statement: { ...rest, boIdLast4: boId ? boId.slice(-4) : null },
    boId,
    account: account ?? null,
    suggestedAccountName: `${statement.broker.split(' ')[0]} ${statement.clientCode ?? ''} (${statement.accountType ?? 'account'})`.trim(),
    suggestions,
    untracked: symbols.filter((s) => !trackedSymbols.has(s)),
  }
}

export interface ApplyResult {
  ok: boolean
  message: string
}

interface PlannedRow {
  symbol: string
  txnType: 'buy' | 'bonus'
  quantity: number
  pricePerShare: number
  /** What the ledger held when the preview was made. */
  expectedLedgerQty: number
  kind: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Holdings come back from the browser too; keep only well-formed ones. */
function cleanHoldings(value: unknown): SnapshotHolding[] | null {
  if (!Array.isArray(value)) return null
  const ok = value.every(
    (h) =>
      h &&
      typeof h === 'object' &&
      typeof h.symbol === 'string' &&
      /^[A-Z0-9][A-Z0-9&\-.]{1,19}$/.test(h.symbol) &&
      Number.isFinite(h.quantity) &&
      h.quantity >= 0 &&
      Number.isFinite(h.costAmount),
  )
  return ok ? value.map((h) => ({ symbol: h.symbol, quantity: h.quantity, costAmount: h.costAmount })) : null
}

/** Receivables come back from the browser; keep only well-formed entries. */
function cleanReceivables(value: unknown): StoredReceivable[] | null {
  if (!Array.isArray(value)) return null
  const ok = value.every(
    (r) =>
      r &&
      typeof r === 'object' &&
      typeof r.companyName === 'string' &&
      (r.symbol === null || typeof r.symbol === 'string') &&
      [r.holding, r.rate, r.entitlement].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
      (r.recordDate === null || (typeof r.recordDate === 'string' && DATE.test(r.recordDate))),
  )
  if (!ok) return null
  return value.map((r) => ({
    companyName: String(r.companyName).slice(0, 200),
    symbol: r.symbol,
    holding: r.holding,
    rate: r.rate,
    entitlement: r.entitlement,
    recordDate: r.recordDate,
  }))
}

/**
 * Record the rows the person ticked.
 *
 * The preview is not trusted: every row is re-validated, and each is only
 * applied if the ledger still holds what it held at preview time. That stops
 * a double-submitted form, or a second tab, from recording the same shares
 * twice.
 */
export async function applyStatement(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const asOf = String(formData.get('asOf') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { ok: false, message: 'Missing statement date.' }

  let rows: PlannedRow[]
  try {
    rows = JSON.parse(String(formData.get('rows') ?? '[]'))
  } catch {
    return { ok: false, message: 'The import plan could not be read. Upload the statement again.' }
  }

  const selected = new Set(formData.getAll('selected').map(String))
  rows = rows.filter((row) => selected.has(row.symbol))

  // The snapshot comes back from the preview, since the PDF itself is never
  // kept. Re-check it rather than trust it.
  let snapshot: SnapshotFigures | null = null
  const rawSnapshot = String(formData.get('snapshot') ?? '')
  if (rawSnapshot) {
    try {
      const parsed = JSON.parse(rawSnapshot) as SnapshotFigures
      const amounts = [
        parsed.marketValue, parsed.cashBalance, parsed.deposit, parsed.ipoRefund,
        parsed.cashDividend, parsed.shareTransferIn, parsed.withdraw, parsed.ipoPayment,
        parsed.shareTransferOut,
      ]
      const valid =
        amounts.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) &&
        typeof parsed.realisedGain === 'number' && Number.isFinite(parsed.realisedGain) &&
        (parsed.costOfHoldings === null ||
          (typeof parsed.costOfHoldings === 'number' && Number.isFinite(parsed.costOfHoldings)))
      const receivables = cleanReceivables(parsed.dividendsReceivable ?? [])
      if (!valid || !receivables) {
        return { ok: false, message: 'The account figures could not be read. Upload the statement again.' }
      }
      const holdings = cleanHoldings(parsed.holdings ?? [])
      if (!holdings) {
        return { ok: false, message: 'The account figures could not be read. Upload the statement again.' }
      }
      snapshot = { ...parsed, dividendsReceivable: receivables, holdings }
    } catch {
      return { ok: false, message: 'The account figures could not be read. Upload the statement again.' }
    }
  }

  // Paid dividends the person ticked, re-validated like everything else.
  let dividends: DividendSuggestion[] = []
  try {
    dividends = JSON.parse(String(formData.get('dividends') ?? '[]'))
  } catch {
    return { ok: false, message: 'The dividend list could not be read. Upload the statement again.' }
  }
  const tickedDividends = new Set(formData.getAll('dividend').map(String))
  dividends = dividends.filter((d) => tickedDividends.has(d.key) && !d.recorded)
  for (const d of dividends) {
    if (
      typeof d.symbol !== 'string' ||
      !(typeof d.gross === 'number' && d.gross > 0) ||
      !(typeof d.taxWithheld === 'number' && d.taxWithheld >= 0 && d.taxWithheld <= d.gross) ||
      (d.recordDate !== null && !DATE.test(String(d.recordDate)))
    ) {
      return { ok: false, message: `Bad dividend figures for ${d.companyName}.` }
    }
  }

  if (rows.length === 0 && !snapshot && dividends.length === 0) {
    return { ok: false, message: 'Nothing was ticked, so nothing was recorded.' }
  }

  for (const row of rows) {
    if (!['buy', 'bonus'].includes(row.txnType)) return { ok: false, message: `Unexpected type for ${row.symbol}.` }
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) return { ok: false, message: `Bad quantity for ${row.symbol}.` }
    if (!(row.pricePerShare >= 0) || (row.txnType === 'buy' && row.pricePerShare <= 0)) {
      return { ok: false, message: `Bad price for ${row.symbol}.` }
    }
  }

  const broker = String(formData.get('broker') ?? '').trim() || null
  const statementLabel = `${broker ?? 'broker'} statement as on ${asOf}`

  const result = await db.transaction(async (tx) => {
    // Resolve, or create, the account the statement belongs to.
    let accountId = Number(formData.get('accountId')) || null
    let accountName = ''

    if (accountId) {
      const [existing] = await tx.select().from(boAccounts).where(eq(boAccounts.id, accountId)).limit(1)
      if (!existing) return { ok: false, message: 'That BO account no longer exists.' }
      accountName = existing.name
    } else {
      const name = String(formData.get('newAccountName') ?? '').trim()
      const boNumber = String(formData.get('boId') ?? '').trim() || null
      if (boNumber && !/^\d{16}$/.test(boNumber)) return { ok: false, message: 'Bad BO ID on the statement.' }

      // The account may have been created since the preview — by an earlier
      // submission of this same form, or in another tab. Reuse it: the ledger
      // check below then stops anything being recorded twice. Creating a
      // second account would instead collide with the BO ID's unique index.
      const [existing] = boNumber
        ? await tx
            .select({ id: boAccounts.id, name: boAccounts.name })
            .from(boAccounts)
            .where(eq(boAccounts.boNumber, boNumber))
            .limit(1)
        : []

      if (existing) {
        accountId = existing.id
        accountName = existing.name
      } else {
        if (!name) return { ok: false, message: 'Name the new BO account.' }

        const [clash] = await tx.select({ id: boAccounts.id }).from(boAccounts).where(eq(boAccounts.name, name)).limit(1)
        if (clash) return { ok: false, message: `There is already an account called "${name}".` }

        const [created] = await tx
          .insert(boAccounts)
          .values({ name, boNumber, broker, notes: `Created from the ${statementLabel}.` })
          .returning({ id: boAccounts.id, name: boAccounts.name })
        accountId = created.id
        accountName = created.name
      }
    }

    // One snapshot per account per statement date: re-importing the same day
    // replaces it, rather than counting the day twice.
    let snapshotSaved = false
    if (snapshot) {
      const figures = {
        broker,
        marketValue: String(snapshot.marketValue),
        costOfHoldings: snapshot.costOfHoldings === null ? null : String(snapshot.costOfHoldings),
        cashBalance: String(snapshot.cashBalance),
        deposit: String(snapshot.deposit),
        ipoRefund: String(snapshot.ipoRefund),
        cashDividend: String(snapshot.cashDividend),
        shareTransferIn: String(snapshot.shareTransferIn),
        withdraw: String(snapshot.withdraw),
        ipoPayment: String(snapshot.ipoPayment),
        shareTransferOut: String(snapshot.shareTransferOut),
        realisedGain: String(snapshot.realisedGain),
        dividendsReceivable: snapshot.dividendsReceivable,
        holdings: snapshot.holdings,
      }
      await tx
        .insert(accountSnapshots)
        .values({ boAccountId: accountId, asOf, ...figures })
        .onConflictDoUpdate({
          target: [accountSnapshots.boAccountId, accountSnapshots.asOf],
          set: figures,
        })
      snapshotSaved = true
    }

    // Re-derive the ledger now, not from what the browser sent back.
    const transactions = await tx.query.portfolioTransactions.findMany({
      where: eq(portfolioTransactions.boAccountId, accountId),
      with: { company: { columns: { dseSymbol: true } } },
    })
    const ledger: PortfolioTransaction[] = transactions.map((t) => ({
      accountId: t.boAccountId,
      symbol: t.company.dseSymbol,
      tradeDate: t.tradeDate,
      txnType: t.txnType,
      quantity: t.quantity === null ? null : Number(t.quantity),
      pricePerShare: t.pricePerShare === null ? null : Number(t.pricePerShare),
      grossAmount: t.grossAmount === null ? null : Number(t.grossAmount),
      commission: Number(t.commission),
      taxWithheld: Number(t.taxWithheld),
      recordDate: t.recordDate,
    }))
    const current = buildPortfolio(ledger, new Map(), new Date(), accountId)
    const heldNow = new Map(current.positions.map((p) => [p.symbol, p.quantity]))

    const wanted = [...rows.map((r) => r.symbol), ...dividends.map((d) => d.symbol!)]
    const companyRows =
      wanted.length === 0
        ? []
        : await tx
            .select({ id: companies.id, symbol: companies.dseSymbol })
            .from(companies)
            .where(inArray(companies.dseSymbol, wanted))
    const companyId = new Map(companyRows.map((c) => [c.symbol, c.id]))

    const recorded: string[] = []
    const skipped: string[] = []

    for (const row of rows) {
      const id = companyId.get(row.symbol)
      if (!id) {
        skipped.push(`${row.symbol} (not a tracked company)`)
        continue
      }
      if ((heldNow.get(row.symbol) ?? 0) !== row.expectedLedgerQty) {
        skipped.push(`${row.symbol} (the ledger changed since the preview — upload again)`)
        continue
      }

      await tx.insert(portfolioTransactions).values({
        companyId: id,
        boAccountId: accountId,
        tradeDate: asOf,
        txnType: row.txnType,
        quantity: String(row.quantity),
        pricePerShare: String(row.pricePerShare),
        commission: '0',
        taxWithheld: '0',
        source: 'statement',
        notes:
          row.kind === 'opening'
            ? `Opening position from the ${statementLabel}. Cost is the broker's total, commission included.`
            : `From reconciling the ${statementLabel}. Dated as of the statement, not the actual trade day.`,
      })
      recorded.push(`${row.symbol} ${row.txnType} ${row.quantity}`)
    }

    for (const d of dividends) {
      const symbol = d.symbol!
      const id = companyId.get(symbol)
      if (!id) {
        skipped.push(`${d.companyName} dividend (not a tracked company)`)
        continue
      }
      // Checked against the ledger now, not the preview: a second submit, or
      // a dividend recorded by hand meanwhile, must not be counted twice.
      if (alreadyRecorded(ledger, accountId, symbol, d.gross, d.recordDate)) {
        skipped.push(`${symbol} dividend (already recorded)`)
        continue
      }
      await tx.insert(portfolioTransactions).values({
        companyId: id,
        boAccountId: accountId,
        tradeDate: asOf,
        txnType: 'dividend',
        grossAmount: String(d.gross),
        taxWithheld: String(d.taxWithheld),
        commission: '0',
        source: 'statement',
        recordDate: d.recordDate,
        notes: `Paid between statements; found by the ${statementLabel}. Record date ${d.recordDate ?? 'unknown'}. Tax inferred from the cash credited.`,
      })
      ledger.push({
        accountId,
        symbol,
        tradeDate: asOf,
        txnType: 'dividend',
        quantity: null,
        pricePerShare: null,
        grossAmount: d.gross,
        commission: 0,
        taxWithheld: d.taxWithheld,
        recordDate: d.recordDate,
      })
      recorded.push(`${symbol} dividend ৳${d.gross.toFixed(2)}`)
    }

    const parts = [
      recorded.length > 0 ? `recorded ${recorded.join(', ')}` : null,
      snapshotSaved ? `saved the ${asOf} account snapshot` : null,
    ].filter(Boolean)

    return {
      ok: recorded.length > 0 || snapshotSaved,
      message:
        (parts.length > 0 ? `${accountName}: ${parts.join('; ')}.` : 'Nothing recorded.') +
        (skipped.length > 0 ? ` Skipped ${skipped.join('; ')}.` : ''),
    }
  })

  revalidatePath('/portfolio')
  revalidatePath('/portfolio/transactions')
  revalidatePath('/portfolio/import')
  revalidatePath('/portfolio/dividends')

  return result
}

function revalidatePortfolio() {
  for (const path of ['/portfolio', '/portfolio/transactions', '/portfolio/import', '/portfolio/dividends', '/portfolio/cash']) {
    revalidatePath(path)
  }
}

/**
 * Record a broker ledger's trades and cash movements. The plan comes back
 * from the preview, since the PDF is never kept; it is re-validated here, and
 * written only if the account's trades are still what the preview saw.
 */
export async function applyLedgerImport(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const from = String(formData.get('from') ?? '')
  const to = String(formData.get('to') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return { ok: false, message: 'Missing the ledger period.' }
  }

  let plan: LedgerPreview['plan']
  try {
    plan = JSON.parse(String(formData.get('plan') ?? ''))
  } catch {
    return { ok: false, message: 'The import plan could not be read. Upload the ledger again.' }
  }
  const invalid = validLedgerPlan(plan, from, to)
  if (invalid) return { ok: false, message: `${invalid} Upload the ledger again.` }
  if (Array.isArray(plan.blockers) && plan.blockers.length > 0) {
    return { ok: false, message: 'This ledger has problems that stop it being imported.' }
  }

  const openingBalance = Number(formData.get('openingBalance'))
  const closingBalance = Number(formData.get('closingBalance'))
  if (!Number.isFinite(openingBalance) || !Number.isFinite(closingBalance)) {
    return { ok: false, message: 'Missing the ledger balances. Upload the ledger again.' }
  }

  // Rows the preview saw in the period: those it replaces, and hand-entered
  // ones it keeps unless the person ticked them for removal.
  const replacedIds = plan.replaced.map((r) => Number(r.id))
  const manualIds = plan.keptManual.map((r) => Number(r.id))
  const removeManual = formData.getAll('removeManual').map(Number).filter((id) => manualIds.includes(id))

  const broker = String(formData.get('broker') ?? '').trim() || null
  const source = `${broker ?? 'broker'} ledger ${from} to ${to}`

  // A refusal rolls everything back, account creation included; its message
  // is kept here to report once the transaction has unwound.
  let refusal: ApplyResult | null = null
  const result = await db
    .transaction(async (tx) => {
      const account = await resolveAccount(tx, formData, broker, source)
      if ('error' in account) return { ok: false, message: account.error }

      const outcome = await applyLedger(
        tx,
        account.id,
        {
          from,
          to,
          openingBalance,
          closingBalance,
          trades: plan.trades,
          cash: plan.cash,
          seen: [...replacedIds, ...manualIds],
          remove: [...replacedIds, ...removeManual],
          confirmHoldingChange: formData.get('confirmHoldings') === '1',
        },
        source,
      )
      if (!outcome.ok) {
        refusal = { ok: false, message: outcome.message }
        tx.rollback()
      }
      return { ok: true, message: `${account.name}: ${outcome.message}` }
    })
    .catch((error: unknown) => {
      if (refusal) return refusal
      throw error
    })

  if (result.ok) revalidatePortfolio()
  return result
}

/** Record the dividends ticked from a broker's dividend report. */
export async function applyDividendReport(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const accountId = Number(formData.get('accountId'))
  if (!Number.isInteger(accountId) || accountId <= 0) return { ok: false, message: 'Missing the account.' }

  let dividends: PlannedDividend[]
  try {
    dividends = JSON.parse(String(formData.get('dividends') ?? '[]'))
  } catch {
    return { ok: false, message: 'The dividend list could not be read. Upload the report again.' }
  }
  const ticked = new Set(formData.getAll('dividend').map(String))
  dividends = dividends.filter((d) => ticked.has(d.key) && !d.recorded)
  if (dividends.length === 0) return { ok: false, message: 'Nothing was ticked, so nothing was recorded.' }

  for (const d of dividends) {
    if (
      typeof d.symbol !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(d.recordDate)) ||
      !(typeof d.gross === 'number' && d.gross > 0) ||
      !(typeof d.taxWithheld === 'number' && d.taxWithheld >= 0 && d.taxWithheld <= d.gross)
    ) {
      return { ok: false, message: `Bad figures for ${d.companyName}.` }
    }
  }

  const broker = String(formData.get('broker') ?? '').trim() || 'broker'
  const result = await db.transaction(async (tx) => {
    const [account] = await tx.select({ id: boAccounts.id, name: boAccounts.name }).from(boAccounts).where(eq(boAccounts.id, accountId)).limit(1)
    if (!account) return { ok: false, message: 'That BO account no longer exists.' }
    const outcome = await applyDividends(tx, account.id, dividends, `${broker} cash dividend report`)
    return { ok: outcome.ok, message: `${account.name}: ${outcome.message}` }
  })

  revalidatePortfolio()
  return result
}

/**
 * Write historical prices read from a CSV. The rows come back from the
 * preview, since the file itself is not kept, and every one is checked again
 * before it is written.
 */
export async function applyPriceHistory(
  _previous: ApplyResult | null,
  formData: FormData,
): Promise<ApplyResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  let parsed: unknown
  try {
    parsed = JSON.parse(String(formData.get('rows') ?? ''))
  } catch {
    return { ok: false, message: 'The prices could not be read. Choose the file again.' }
  }

  const rows = cleanPriceRows(parsed)
  if (!rows) return { ok: false, message: 'Some rows were malformed, so nothing was imported. Choose the file again.' }

  const name = String(formData.get('fileName') ?? '').slice(0, 80).replace(/[^\w.\- ]/g, '') || 'upload'
  const result = await applyPrices(rows, `csv:${name}`)

  revalidatePath('/portfolio')
  revalidatePath('/portfolio/import')
  for (const stock of result.coverage) revalidatePath(`/companies/${stock.symbol}`)

  const covered = result.coverage.map((c) => `${c.symbol} ${c.days} days (${c.from} to ${c.to})`).join('; ')

  return {
    ok: result.written > 0,
    message:
      (result.written > 0
        ? `Imported ${result.written.toLocaleString()} days. Stored now: ${covered}.`
        : 'Nothing was imported.') +
      (result.skipped.length > 0 ? ` Skipped ${result.skipped.join(', ')} — not in the database.` : ''),
  }
}

/**
 * Fetch a stock's day-end history from DSE and show what it would change.
 *
 * DSE's archive caps what one request returns, so a range is fetched as
 * several windows; a window that brings nothing back is reported rather
 * than leaving a silent hole. Nothing is written here — the preview it
 * returns is the same one a CSV gives, and the same button imports it.
 */
export async function fetchDsePrices(
  _previous: ImportPreview | null,
  formData: FormData,
): Promise<ImportPreview> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const symbol = String(formData.get('symbol') ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9&.\-]{1,19}$/.test(symbol)) return { ok: false, message: 'Enter a DSE trading code, such as SQURPHARMA.' }

  const years = Number(formData.get('years') ?? 1)
  if (!Number.isInteger(years) || years < 1 || years > DSE_MAX_YEARS) {
    return { ok: false, message: `Choose between 1 and ${DSE_MAX_YEARS} years.` }
  }

  const to = dhakaNow().date
  const from = yearsAgo(to, years)

  const history = await fetchDseHistory({
    symbol,
    from,
    to,
    pauseMs: 400,
    fetchPage: fetchDsePage,
  })

  if (history.rows.length === 0) {
    return {
      ok: false,
      message: `${history.issues[0] ?? 'DSE returned no rows.'} Check the trading code, or import a CSV instead.`,
    }
  }

  const preview = await planPrices({
    rows: history.rows,
    columns: { 'DSE day-end archive': `${symbol} ${from} → ${to}` },
    issues: history.issues,
  })
  return preview.ok ? { ...preview, message: `${preview.message} From DSE, ${history.windows.length} request(s).` } : preview
}
