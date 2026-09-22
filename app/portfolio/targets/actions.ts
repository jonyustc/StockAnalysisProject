'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { boAccounts, companies, priceTargets } from '@/db/schema'
import { hasSession, NOT_SIGNED_IN } from '@/lib/session'
import { parseReportedNumber } from '@/lib/units'

export interface TargetResult {
  ok: boolean
  message: string
}

function revalidate() {
  revalidatePath('/portfolio/targets')
  revalidatePath('/portfolio')
}

/**
 * Set the targets for a stock in one account, or in any. Saving again for the
 * same stock and account replaces them — there is only ever one of each.
 * Leaving both prices empty removes it.
 */
export async function saveTarget(_previous: TargetResult | null, formData: FormData): Promise<TargetResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const symbol = String(formData.get('symbol') ?? '').toUpperCase()
  const accountRaw = String(formData.get('accountId') ?? '')
  const accountId = accountRaw === '' ? null : Number(accountRaw)
  const buyBelow = parseReportedNumber(String(formData.get('buyBelow') ?? ''))
  const sellAbove = parseReportedNumber(String(formData.get('sellAbove') ?? ''))
  const note = String(formData.get('note') ?? '').trim().slice(0, 500) || null

  if (!symbol) return { ok: false, message: 'Pick a stock.' }
  if (accountId !== null && (!Number.isInteger(accountId) || accountId <= 0)) {
    return { ok: false, message: 'Pick an account, or "Any account".' }
  }
  if ((buyBelow !== null && buyBelow <= 0) || (sellAbove !== null && sellAbove <= 0)) {
    return { ok: false, message: 'Prices must be above zero.' }
  }
  if (buyBelow !== null && sellAbove !== null && buyBelow >= sellAbove) {
    return { ok: false, message: 'The buy price must be below the sell price.' }
  }

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.dseSymbol, symbol)).limit(1)
  if (!company) return { ok: false, message: `No company with symbol ${symbol}.` }

  let accountName = 'any account'
  if (accountId !== null) {
    const [account] = await db.select({ name: boAccounts.name }).from(boAccounts).where(eq(boAccounts.id, accountId)).limit(1)
    if (!account) return { ok: false, message: 'That account no longer exists.' }
    accountName = account.name
  }

  const scope = and(
    eq(priceTargets.companyId, company.id),
    accountId === null ? isNull(priceTargets.boAccountId) : eq(priceTargets.boAccountId, accountId),
  )

  const message = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: priceTargets.id }).from(priceTargets).where(scope).limit(1)

    if (buyBelow === null && sellAbove === null) {
      if (!existing) return 'Enter a buy price, a sell price, or both.'
      await tx.delete(priceTargets).where(eq(priceTargets.id, existing.id))
      return `Removed the targets for ${symbol} (${accountName}).`
    }

    const values = {
      buyBelow: buyBelow === null ? null : String(buyBelow),
      sellAbove: sellAbove === null ? null : String(sellAbove),
      note,
      // A changed target is a new one to watch: its next crossing alerts.
      buyAlertedOn: null,
      sellAlertedOn: null,
    }
    if (existing) await tx.update(priceTargets).set(values).where(eq(priceTargets.id, existing.id))
    else await tx.insert(priceTargets).values({ companyId: company.id, boAccountId: accountId, ...values })
    return `${existing ? 'Updated' : 'Set'} targets for ${symbol} (${accountName}).`
  })

  revalidate()
  return { ok: !message.startsWith('Enter'), message }
}

export async function deleteTarget(formData: FormData): Promise<void> {
  if (!(await hasSession())) return
  const id = Number(formData.get('id'))
  if (!Number.isInteger(id)) return
  await db.delete(priceTargets).where(eq(priceTargets.id, id))
  revalidate()
}
