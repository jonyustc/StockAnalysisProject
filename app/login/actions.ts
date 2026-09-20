'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { checkPassword, COOKIE_NAME, createSessionToken, MAX_AGE_SECONDS } from '@/lib/auth'

export interface LoginState {
  error: string | null
}

/** Rejects anything that is not a path on this site, to avoid an open redirect. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))

  if (!password) return { error: 'Enter the password.' }

  let ok: boolean
  try {
    ok = checkPassword(password)
  } catch (error) {
    // A misconfigured server must not look like a wrong password — but the
    // details of why go to the server log, not to whoever is at the form.
    console.error('[auth] sign-in is misconfigured:', error)
    return { error: 'Sign-in is not configured on this server.' }
  }

  if (!ok) return { error: 'Incorrect password.' }

  const store = await cookies()
  store.set(COOKIE_NAME, await createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })

  redirect(next)
}

export async function logout(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
  redirect('/login')
}
