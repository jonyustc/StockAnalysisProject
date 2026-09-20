/**
 * Single-user authentication.
 *
 * A signed cookie, not Supabase Auth — the whole point of the data layer is
 * that the app runs unchanged against Supabase or a local Postgres, and an
 * auth provider tied to one of them would break that. It is also less
 * machinery than a provider for an app with exactly one user.
 *
 * Uses Web Crypto rather than node:crypto so the same code runs in Next.js
 * middleware (Edge runtime) and in route handlers (Node).
 */

const COOKIE_NAME = 'dse_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export { COOKIE_NAME, MAX_AGE_SECONDS }

function encoder() {
  return new TextEncoder()
}

function requireSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or shorter than 32 characters. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  return secret
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder().encode(requireSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder().encode(payload))
  return toBase64Url(signature)
}

/**
 * Compares without leaking, through timing, how much of the value matched.
 * Written by hand because node:crypto's timingSafeEqual is not available on
 * the Edge runtime.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/** A session token is `expiry.signature`, with the expiry covered by the signature. */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + MAX_AGE_SECONDS
  const payload = String(expiresAt)
  return `${payload}.${await sign(payload)}`
}

export async function verifySessionToken(
  token: string | undefined | null,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return false

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt)) return false

  // Check the signature even when expired, so an expired token and a forged
  // one take the same path.
  const expected = await sign(payload)
  const signatureValid = constantTimeEqual(signature, expected)

  return signatureValid && expiresAt * 1000 > now
}

/** Verifies the login password against AUTH_PASSWORD. */
export function checkPassword(candidate: string): boolean {
  const expected = process.env.AUTH_PASSWORD

  if (!expected || expected.length < 8) {
    throw new Error(
      'AUTH_PASSWORD is not set, or is shorter than 8 characters. The app refuses ' +
        'to accept a login rather than run unprotected.',
    )
  }

  return constantTimeEqual(candidate, expected)
}
