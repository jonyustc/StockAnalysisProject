/**
 * Authentication inside server actions.
 *
 * The proxy gates every page, but the Next.js docs are explicit that render-
 * time gating is not a security boundary: an action is an endpoint, and a
 * request can reach it without ever loading the page that renders its form.
 * So every action that changes data checks the session itself.
 */

import 'server-only'

import { cookies } from 'next/headers'

import { COOKIE_NAME, verifySessionToken } from './auth'

export async function hasSession(): Promise<boolean> {
  try {
    const store = await cookies()
    return await verifySessionToken(store.get(COOKIE_NAME)?.value)
  } catch {
    // Misconfiguration must lock people out, never let them in.
    return false
  }
}

export const NOT_SIGNED_IN = { ok: false as const, message: 'Your session has expired. Sign in again.' }
