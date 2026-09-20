import { NextResponse, type NextRequest } from 'next/server'

import { COOKIE_NAME, verifySessionToken } from '@/lib/auth'

/**
 * Everything is private. This app is a database editor: an unauthenticated
 * visitor could otherwise overwrite hand-entered financial history.
 *
 * Scheduled jobs under /api/cron are excluded here and authenticate
 * themselves with a bearer secret instead, since they arrive without a cookie.
 */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value

  let authenticated = false
  try {
    authenticated = await verifySessionToken(token)
  } catch (error) {
    // Middleware runs on every route, so throwing here would take the whole
    // site down with a 500 rather than showing a login page. Fail closed.
    console.error('[auth] session verification failed:', error)
  }

  if (authenticated) return NextResponse.next()

  const loginUrl = new URL('/login', request.url)

  // Come back to the page that was asked for, but only ever to a path on this
  // site — a full URL here would be an open redirect.
  const { pathname, search } = request.nextUrl
  if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`)

  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   login        the page that issues the cookie
     *   api/cron     scheduled jobs, which use a bearer secret
     *   _next        framework assets
     *   favicon.ico  requested before any redirect can help
     */
    '/((?!login|api/cron|_next/static|_next/image|favicon.ico).*)',
  ],
}
