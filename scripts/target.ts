/**
 * Chooses which database a script runs against.
 *
 *   (no flag)            local     DIRECT_URL
 *   --target=supabase    cloud     SUPABASE_DIRECT_URL
 *
 * Both live in .env.local at once, so there is no swapping a single variable
 * back and forth — and no running a migration against the wrong database
 * because you forgot which way it was pointed. Every script prints the target
 * it resolved before it does anything.
 */

import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

export type Target = 'local' | 'supabase'

export interface ResolvedTarget {
  target: Target
  connectionString: string
  isLocal: boolean
  /** Host and database only — safe to print, no credentials. */
  describe: string
}

/** Strips credentials so a connection can be logged. */
function describeConnection(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`
  } catch {
    return '(unparseable connection string)'
  }
}

/** A misconfigured target is a user error, not a crash — no stack trace. */
function fail(message: string): never {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

export function resolveTarget(argv: string[] = process.argv.slice(2)): ResolvedTarget {
  const flag = argv.find((arg) => arg.startsWith('--target'))
  const requested = flag?.includes('=') ? flag.split('=')[1] : argv[argv.indexOf(flag ?? '') + 1]

  const target: Target = requested === 'supabase' ? 'supabase' : 'local'

  const envVar = target === 'supabase' ? 'SUPABASE_DIRECT_URL' : 'DIRECT_URL'
  const fallbackVar = target === 'supabase' ? 'SUPABASE_DATABASE_URL' : 'DATABASE_URL'

  const connectionString = process.env[envVar] ?? process.env[fallbackVar]

  if (!connectionString || connectionString.includes('<') || connectionString.includes('[')) {
    fail(
      `${envVar} is not set, or still contains a placeholder.\n` +
        `  Add it to .env.local — Supabase dashboard > Connect > Connection string,\n` +
        `  using the Session pooler (port 5432) and replacing [YOUR-PASSWORD].`,
    )
  }

  const isLocal =
    connectionString.includes('localhost') || connectionString.includes('127.0.0.1')

  if (target === 'supabase' && isLocal) {
    fail(
      'SUPABASE_DIRECT_URL points at localhost. Check .env.local — this would\n' +
        '  have run against the wrong database.',
    )
  }

  return {
    target,
    connectionString,
    isLocal,
    describe: describeConnection(connectionString),
  }
}

/** TLS settings for the resolved target. Supabase terminates with its own CA. */
export function sslFor(resolved: ResolvedTarget) {
  return resolved.isLocal ? undefined : { rejectUnauthorized: false }
}
