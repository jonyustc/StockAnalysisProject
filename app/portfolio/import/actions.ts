'use server'

import { eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { listPortfolioTransactions } from '@/db/queries'
import { accountSnapshots, boAccounts, companies, portfolioTransactions } from '@/db/schema'
import { lifetimeReturn, type LifetimeReturn } from '@/lib/account-return'
import { buildPortfolio } from '@/lib/portfolio'
import { hasSession, NOT_SIGNED_IN } from '@/lib/session'
import { extractTextItems, looksScanned } from '@/lib/statements/extract'
import { parseLankaBanglaPortfolio } from '@/lib/statements/lankabangla'
import { reconcile, type Suggestion } from '@/lib/statements/reconcile'
import type { ParsedStatement } from '@/lib/statements/types'

/** Well above a real statement (~65 KB), well below the action body limit. */
const MAX_BYTES = 3 * 1024 * 1024

export interface StatementPreview {
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
}

function snapshotFrom(statement: ParsedStatement): SnapshotFigures | null {
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
  }
}

/**
 * Read a statement and compare it with the ledger. Writes nothing.
 *
 * The PDF is read in memory and discarded when this returns. It is never
 * written to disk, to the database, or to storage.
 */
export async function previewStatement(
  _previous: StatementPreview | null,
  formData: FormData,
): Promise<StatementPreview> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const file = formData.get('statement')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a statement PDF first.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; a statement is well under 1 MB.` }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Check the file really is a PDF rather than trusting its name.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { ok: false, message: 'That is not a PDF.' }
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
  if (account) {
    const transactions = await listPortfolioTransactions()
    positions = buildPortfolio(transactions, new Map(), new Date(), account.id).positions
  }

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
  const snapshot = statement.issues.length === 0 ? snapshotFrom(statement) : null

  return {
    snapshot,
    lifetime: snapshot ? lifetimeReturn({ asOf: statement.asOf, ...snapshot }) : null,
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
      if (!valid) return { ok: false, message: 'The account figures could not be read. Upload the statement again.' }
      snapshot = parsed
    } catch {
      return { ok: false, message: 'The account figures could not be read. Upload the statement again.' }
    }
  }

  if (rows.length === 0 && !snapshot) {
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
    const current = buildPortfolio(
      transactions.map((t) => ({
        accountId: t.boAccountId,
        symbol: t.company.dseSymbol,
        tradeDate: t.tradeDate,
        txnType: t.txnType,
        quantity: t.quantity === null ? null : Number(t.quantity),
        pricePerShare: t.pricePerShare === null ? null : Number(t.pricePerShare),
        grossAmount: t.grossAmount === null ? null : Number(t.grossAmount),
        commission: Number(t.commission),
        taxWithheld: Number(t.taxWithheld),
      })),
      new Map(),
      new Date(),
      accountId,
    )
    const heldNow = new Map(current.positions.map((p) => [p.symbol, p.quantity]))

    const companyRows =
      rows.length === 0
        ? []
        : await tx
            .select({ id: companies.id, symbol: companies.dseSymbol })
            .from(companies)
            .where(inArray(companies.dseSymbol, rows.map((r) => r.symbol)))
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
        notes:
          row.kind === 'opening'
            ? `Opening position from the ${statementLabel}. Cost is the broker's total, commission included.`
            : `From reconciling the ${statementLabel}. Dated as of the statement, not the actual trade day.`,
      })
      recorded.push(`${row.symbol} ${row.txnType} ${row.quantity}`)
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

  return result
}
