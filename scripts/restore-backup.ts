/**
 * Restore the nightly backup into local Postgres — and prove it works.
 *
 *   npm run db:restore              verify: restore to a scratch database,
 *                                   report row counts, drop it again
 *   npm run db:restore -- --into=dse_research_mirror --yes
 *                                   keep it: DROP and recreate that database
 *                                   from the backup
 *
 * A dump nobody has ever restored is not a backup, it is a hope. Running the
 * verify mode on a schedule is what turns one into the other.
 *
 * Needs psql on PATH, or PG_BIN pointing at the PostgreSQL bin directory.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'

import '../db/pg-types'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

const SCRATCH_DB = 'dse_research_backup_verify'
const BACKUP_REF = 'origin/backups'
const BACKUP_FILE = 'dump.sql'

/** Tables whose row counts are worth eyeballing after a restore. */
const COUNTED = [
  'companies',
  'fiscal_periods',
  'financial_facts',
  'daily_prices',
  'corporate_actions',
  'source_documents',
  'research_notes',
]

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found?.split('=').slice(1).join('=')
}

function psqlPath(): string {
  const dir = process.env.PG_BIN
  if (dir) {
    for (const candidate of [join(dir, 'psql.exe'), join(dir, 'psql')]) {
      if (existsSync(candidate)) return candidate
    }
    throw new Error(`PG_BIN is set to "${dir}" but no psql was found there.`)
  }
  return 'psql'
}

/** The local maintenance connection, used to create and drop databases. */
function adminUrl(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DIRECT_URL is not set. See .env.example.')

  const parsed = new URL(url)
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(
      `Refusing to restore into ${parsed.hostname}. This only ever writes to a local database.`,
    )
  }

  parsed.pathname = '/postgres'
  return parsed.toString()
}

function urlForDatabase(name: string): string {
  const parsed = new URL(adminUrl())
  parsed.pathname = `/${name}`
  return parsed.toString()
}

function readBackupSql(): { sql: string; origin: string } {
  const file = arg('file')

  if (file) {
    if (!existsSync(file)) throw new Error(`No such file: ${file}`)
    return { sql: readFileSync(file, 'utf8'), origin: file }
  }

  // Straight from git, so what is verified is exactly what is stored.
  try {
    execFileSync('git', ['fetch', 'origin', 'backups', '--depth=1'], { stdio: 'pipe' })
  } catch {
    // An offline run can still verify whatever was last fetched.
    console.log('  (could not fetch; using the last fetched copy)')
  }

  const sql = execFileSync('git', ['show', `${BACKUP_REF}:${BACKUP_FILE}`], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })

  return { sql, origin: `${BACKUP_REF}:${BACKUP_FILE}` }
}

async function recreateDatabase(name: string) {
  const admin = new Client({ connectionString: adminUrl() })
  await admin.connect()
  try {
    // Identifiers cannot be parameterised, so the name is restricted instead.
    if (!/^[a-z0-9_]+$/.test(name)) {
      throw new Error(`Unsafe database name: ${name}`)
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${name}`)
  } finally {
    await admin.end()
  }

  // The dump begins with CREATE SCHEMA public, but a fresh database already
  // has one, so the restore would stop on the first statement. Clearing it
  // lets the dump rebuild the schema exactly as it was on the server.
  const fresh = new Client({ connectionString: urlForDatabase(name) })
  await fresh.connect()
  try {
    await fresh.query('DROP SCHEMA IF EXISTS public CASCADE')
  } finally {
    await fresh.end()
  }
}

async function dropDatabase(name: string) {
  const admin = new Client({ connectionString: adminUrl() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}

async function main() {
  const into = arg('into')
  const keep = into !== undefined
  const target = into ?? SCRATCH_DB

  if (keep && !process.argv.includes('--yes')) {
    console.error(
      `\n  --into=${target} will DROP and recreate that database.\n` +
        `  Add --yes if that is what you want.\n`,
    )
    process.exit(1)
  }

  console.log(`\nrestoring into: ${target}${keep ? '' : ' (scratch, dropped afterwards)'}`)

  const { sql, origin } = readBackupSql()
  console.log(`source: ${origin}  (${sql.length.toLocaleString()} bytes)`)

  const scratchFile = join(mkdtempSync(join(tmpdir(), 'dse-restore-')), BACKUP_FILE)
  writeFileSync(scratchFile, sql, 'utf8')

  await recreateDatabase(target)

  // psql rather than the driver: a plain dump is a script, not a statement.
  execFileSync(
    psqlPath(),
    ['--quiet', '--set', 'ON_ERROR_STOP=1', '--file', scratchFile, urlForDatabase(target)],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )

  const client = new Client({ connectionString: urlForDatabase(target) })
  await client.connect()

  let total = 0
  const counts: Record<string, number> = {}

  try {
    for (const table of COUNTED) {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table}`,
      )
      counts[table] = rows[0].n
      total += rows[0].n
    }
  } finally {
    await client.end()
  }

  console.log()
  console.table(counts)

  if (!keep) await dropDatabase(target)

  if (counts.financial_facts === 0 || counts.companies === 0) {
    console.error('\nFAILED — the restore produced an empty database.\n')
    process.exit(1)
  }

  console.log(
    `\nok — backup restores cleanly, ${total.toLocaleString()} rows across ${COUNTED.length} tables.` +
      (keep ? `\nKept as "${target}".\n` : '\nScratch database dropped.\n'),
  )
}

main().catch((error) => {
  console.error('\n', error instanceof Error ? error.message : error, '\n')
  process.exit(1)
})
