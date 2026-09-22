import 'server-only'

import { desc, eq, sql } from 'drizzle-orm'
import webpush from 'web-push'

import { db } from '@/db/client'
import { priceTargets, pushSubscriptions } from '@/db/schema'
import { planAlerts } from '@/lib/targets'

import { targetStatuses } from './target-data'

/*
 * System alerts, by Web Push. Each notification is encrypted for the one
 * browser that subscribed, and signed with this app's VAPID key so the push
 * service knows who is sending. The keys live in the environment:
 * VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.
 */

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null
}

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null
}

export interface PushPayload {
  title: string
  body: string
  url: string
  /** Notifications with the same tag replace each other instead of piling up. */
  tag: string
}

/** A browser that has stopped accepting is dropped after this many failures in a row. */
const MAX_FAILURES = 5

/** Send to every subscribed device. Returns how many received it. */
export async function sendToAll(payload: PushPayload): Promise<{ delivered: number; devices: number; error?: string }> {
  const keys = vapid()
  if (!keys) return { delivered: 0, devices: 0, error: 'System alerts are not set up: the VAPID keys are missing.' }

  const subs = await db.select().from(pushSubscriptions)
  let delivered = 0

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { vapidDetails: keys, TTL: 12 * 60 * 60, urgency: 'high' },
      )
      delivered += 1
      await db
        .update(pushSubscriptions)
        .set({ lastSentAt: new Date(), failures: 0 })
        .where(eq(pushSubscriptions.id, sub.id))
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      // 404 and 410: the browser has unsubscribed or the subscription expired.
      if (status === 404 || status === 410 || sub.failures + 1 >= MAX_FAILURES) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
      } else {
        await db
          .update(pushSubscriptions)
          .set({ failures: sql`${pushSubscriptions.failures} + 1` })
          .where(eq(pushSubscriptions.id, sub.id))
      }
      console.error('[push] delivery failed', status ?? (error instanceof Error ? error.message : error))
    }
  }

  return { delivered, devices: subs.length }
}

/**
 * Check every target against the latest close and alert on the ones newly
 * reached. Runs after the daily price job; safe to run again — a target
 * already alerted for this crossing is not alerted twice.
 *
 * A target is only marked as alerted when the alert reached at least one
 * device, so turning alerts on later still hears about a crossing that
 * happened while they were off.
 */
export async function runTargetAlerts(): Promise<{ alerted: number; rearmed: number; delivered: number; note?: string }> {
  const { statuses } = await targetStatuses()
  const { send, rearm } = planAlerts(statuses)

  for (const r of rearm) {
    await db
      .update(priceTargets)
      .set(r.side === 'buy' ? { buyAlertedOn: null } : { sellAlertedOn: null })
      .where(eq(priceTargets.id, r.targetId))
  }

  if (send.length === 0) return { alerted: 0, rearmed: rearm.length, delivered: 0 }

  let delivered = 0
  let alerted = 0
  let note: string | undefined
  for (const alert of send) {
    const result = await sendToAll({
      title: alert.title,
      body: alert.body,
      url: alert.url,
      tag: `target-${alert.targetId}-${alert.side}`,
    })
    if (result.error) note = result.error
    else if (result.devices === 0) note = 'No device has system alerts turned on.'
    if (result.delivered > 0) {
      delivered += result.delivered
      alerted += 1
      await db
        .update(priceTargets)
        .set(alert.side === 'buy' ? { buyAlertedOn: alert.date } : { sellAlertedOn: alert.date })
        .where(eq(priceTargets.id, alert.targetId))
    }
  }

  return { alerted, rearmed: rearm.length, delivered, note }
}

/** Devices currently subscribed, newest first. */
export async function listDevices() {
  return db
    .select({ id: pushSubscriptions.id, label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt, lastSentAt: pushSubscriptions.lastSentAt })
    .from(pushSubscriptions)
    .orderBy(desc(pushSubscriptions.createdAt))
}
