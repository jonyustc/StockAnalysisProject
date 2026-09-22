'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import { pushSubscriptions } from '@/db/schema'
import { hasSession } from '@/lib/session'

import { runTargetAlerts, sendToAll } from '../push'

export interface PushResult {
  ok: boolean
  message: string
}

const NOT_SIGNED_IN = { ok: false, message: 'Your session has ended. Sign in again.' }

/** base64url, as browsers encode subscription keys. */
const KEY = /^[A-Za-z0-9_-]{16,200}$/

/** Remember this browser as one to alert. Subscribing again just refreshes it. */
export async function savePushSubscription(
  subscription: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } },
  label: string,
): Promise<PushResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN

  const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : ''
  const p256dh = subscription?.keys?.p256dh
  const auth = subscription?.keys?.auth
  let url: URL | null = null
  try {
    url = new URL(endpoint)
  } catch {
    url = null
  }
  if (!url || url.protocol !== 'https:' || endpoint.length > 1000) return { ok: false, message: 'The browser sent an invalid subscription.' }
  if (typeof p256dh !== 'string' || !KEY.test(p256dh) || typeof auth !== 'string' || !KEY.test(auth)) {
    return { ok: false, message: 'The browser sent invalid subscription keys.' }
  }

  const values = { p256dh, auth, label: label.slice(0, 120) || null, failures: 0 }
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })

  revalidatePath('/portfolio/targets')
  return { ok: true, message: 'System alerts are on for this device.' }
}

export async function removePushSubscription(endpoint: string): Promise<PushResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, String(endpoint)))
  revalidatePath('/portfolio/targets')
  return { ok: true, message: 'System alerts are off for this device.' }
}

export async function removeDevice(formData: FormData): Promise<void> {
  if (!(await hasSession())) return
  const id = Number(formData.get('id'))
  if (!Number.isInteger(id)) return
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id))
  revalidatePath('/portfolio/targets')
}

export async function sendTestAlert(): Promise<PushResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN
  const result = await sendToAll({
    title: 'Test alert',
    body: 'System alerts work. A real one arrives when a price target is reached at the daily close.',
    url: '/portfolio/targets',
    tag: 'test',
  })
  if (result.error) return { ok: false, message: result.error }
  if (result.devices === 0) return { ok: false, message: 'No device has system alerts turned on.' }
  return {
    ok: result.delivered > 0,
    message: `Sent to ${result.delivered} of ${result.devices} device${result.devices === 1 ? '' : 's'}.`,
  }
}

/** Check the targets against the latest close now, rather than waiting for the daily job. */
export async function checkTargetsNow(): Promise<PushResult> {
  if (!(await hasSession())) return NOT_SIGNED_IN
  const r = await runTargetAlerts()
  revalidatePath('/portfolio/targets')
  if (r.alerted === 0 && r.note) return { ok: false, message: r.note }
  return {
    ok: true,
    message:
      r.alerted > 0
        ? `Alerted ${r.alerted} newly reached target${r.alerted === 1 ? '' : 's'}.`
        : 'Nothing newly reached — every reached target has already alerted.',
  }
}
