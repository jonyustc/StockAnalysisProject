import { NextResponse, type NextRequest } from 'next/server'

import { getPool } from '@/db/client'
import { runTargetAlerts } from '@/app/portfolio/push'
import { ingestDailyPrices } from '@/lib/ingest-prices'

/**
 * Daily closing prices.
 *
 * This route sits outside the login wall, because a scheduled request carries
 * no cookie — so it authenticates with a bearer secret instead. Without that
 * check it would be a public write path into the database.
 *
 * It also serves as the keep-alive that stops a free Supabase project pausing
 * after a week of inactivity.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET

  // Fail closed. An unset secret must not mean "let everyone in".
  if (!expected || expected.length < 16) return false

  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (presented.length !== expected.length) return false

  let mismatch = 0
  for (let i = 0; i < presented.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return mismatch === 0
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    // Deliberately says nothing about whether the secret is configured.
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  try {
    const summary = await ingestDailyPrices(getPool())

    // With the day's closes in, check price targets and send system alerts.
    // Kept apart from the price job's own result: an alert problem must not
    // make the prices look failed, nor stop them being saved.
    let alerts: Awaited<ReturnType<typeof runTargetAlerts>> | { error: string }
    try {
      alerts = await runTargetAlerts()
    } catch (error) {
      alerts = { error: error instanceof Error ? error.message : String(error) }
      console.error('[cron/prices] target alerts', alerts.error)
    }

    return NextResponse.json({ ...summary, alerts }, { status: summary.ok ? 200 : 502 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron/prices]', message)

    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
