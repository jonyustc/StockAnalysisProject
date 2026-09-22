'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { hasSession, NOT_SIGNED_IN } from '@/lib/session'
import { boAccounts, companies, portfolioTransactions } from '@/db/schema'
import { parseReportedNumber } from '@/lib/units'

export interface TransactionResult {
  ok: boolean
  message: string
}

const TYPES = ['buy', 'sell', 'bonus', 'rights', 'dividend'] as const
type TxnType = (typeof TYPES)[number]

function number(formData: FormData, field: string): number | null {
  return parseReportedNumber(String(formData.get(field) ?? ''))
}

export async function addTransaction(
  _previous: TransactionResult | null,
  formData: FormData,
): Promise<TransactionResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const symbol = String(formData.get('symbol') ?? '').toUpperCase()
  const tradeDate = String(formData.get('tradeDate') ?? '').trim()
  const txnType = String(formData.get('txnType') ?? '') as TxnType

  const boAccountId = Number(formData.get('boAccountId'))

  if (!Number.isInteger(boAccountId) || boAccountId <= 0) {
    return { ok: false, message: 'Pick the BO account this happened in.' }
  }
  if (!symbol) return { ok: false, message: 'Pick a company.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return { ok: false, message: 'Enter a valid date.' }
  if (!TYPES.includes(txnType)) return { ok: false, message: 'Pick a transaction type.' }

  const [account] = await db
    .select({ id: boAccounts.id, name: boAccounts.name })
    .from(boAccounts)
    .where(eq(boAccounts.id, boAccountId))
    .limit(1)

  if (!account) return { ok: false, message: 'That BO account no longer exists.' }

  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.dseSymbol, symbol))
    .limit(1)

  if (!company) return { ok: false, message: `No company with symbol ${symbol}.` }

  const quantity = number(formData, 'quantity')
  const pricePerShare = number(formData, 'pricePerShare')
  const grossAmount = number(formData, 'grossAmount')
  const commission = number(formData, 'commission') ?? 0
  const taxWithheld = number(formData, 'taxWithheld') ?? 0

  // The database enforces this too, but a clear message beats a constraint
  // violation surfacing as a stack trace.
  if (txnType === 'dividend') {
    if (grossAmount === null || grossAmount <= 0) {
      return { ok: false, message: 'A dividend needs the gross amount received.' }
    }
  } else {
    if (quantity === null || quantity <= 0) {
      return { ok: false, message: 'Enter how many shares moved.' }
    }
    if (txnType !== 'bonus' && (pricePerShare === null || pricePerShare <= 0)) {
      return { ok: false, message: 'Enter the price per share.' }
    }
  }

  if (commission < 0 || taxWithheld < 0) {
    return { ok: false, message: 'Commission and tax cannot be negative.' }
  }

  await db.insert(portfolioTransactions).values({
    companyId: company.id,
    boAccountId: account.id,
    tradeDate,
    txnType,
    quantity: txnType === 'dividend' ? null : String(quantity),
    // A bonus issue costs nothing; that is what makes average cost fall.
    pricePerShare:
      txnType === 'dividend' ? null : String(txnType === 'bonus' ? 0 : pricePerShare),
    grossAmount: txnType === 'dividend' ? String(grossAmount) : null,
    commission: String(commission),
    taxWithheld: String(taxWithheld),
    notes: String(formData.get('notes') ?? '').trim() || null,
  })

  revalidatePath('/portfolio')
  revalidatePath('/portfolio/transactions')
  revalidatePath(`/companies/${symbol}`)

  return {
    ok: true,
    message: `Recorded ${txnType} · ${symbol} · ${tradeDate} · ${account.name}.`,
  }
}

export async function addBoAccount(
  _previous: TransactionResult | null,
  formData: FormData,
): Promise<TransactionResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const name = String(formData.get('name') ?? '').trim()
  // CDBL BO IDs are sixteen digits; people paste them with spaces or dashes.
  const boNumber = String(formData.get('boNumber') ?? '').replace(/[\s-]/g, '') || null
  const broker = String(formData.get('broker') ?? '').trim() || null

  if (!name) return { ok: false, message: 'Give the account a name you will recognise.' }
  if (boNumber !== null && !/^\d{16}$/.test(boNumber)) {
    return { ok: false, message: 'A BO ID is 16 digits. Leave it blank if you would rather not store it.' }
  }

  const existing = await db
    .select({ id: boAccounts.id })
    .from(boAccounts)
    .where(eq(boAccounts.name, name))
    .limit(1)
  if (existing.length > 0) return { ok: false, message: `There is already an account called "${name}".` }

  await db.insert(boAccounts).values({ name, boNumber, broker })

  revalidatePath('/portfolio')
  revalidatePath('/portfolio/transactions')

  return { ok: true, message: `Added "${name}".` }
}

export async function deleteTransaction(formData: FormData): Promise<void> {
  if (!(await hasSession())) return

  const id = Number(formData.get('id'))
  if (!Number.isInteger(id)) return

  await db.delete(portfolioTransactions).where(eq(portfolioTransactions.id, id))

  revalidatePath('/portfolio')
  revalidatePath('/portfolio/transactions')
}
