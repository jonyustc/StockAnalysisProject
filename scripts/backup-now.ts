/**
 * Take a backup right now, by hand.
 *
 *   npm run db:backup             dump the LOCAL database to ./backups/
 *   npm run db:backup:supabase    dump production instead
 *   npm run db:backup -- --out=x.sql   write somewhere specific
 *
 * No flag means local, the same as every other script here.
 *
 * The nightly GitHub Action is the routine copy; this is for the moment before
 * you do something you might regret.
 *
 * Applies the same sanity checks as the workflow, so a truncated dump is
 * reported as a failure rather than written out as if it were fine.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveTarget } from './target'

const REQUIRED_TABLES = [
  'companies',
  'financial_facts',
  'fiscal_periods',
  'line_item_defs',
  'daily_prices',
]

const MIN_BYTES = 20_000

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

function pgDumpPath(): string {
  const dir = process.env.PG_BIN
  if (dir) {
    for (const candidate of [join(dir, 'pg_dump.exe'), join(dir, 'pg_dump')]) {
      if (existsSync(candidate)) return candidate
    }
    throw new Error(`PG_BIN is set to "${dir}" but no pg_dump was found there.`)
  }
  return 'pg_dump'
}

function main() {
  const resolved = resolveTarget()
  console.log(`\ntarget: ${resolved.target} — ${resolved.describe}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    // '.backups', not 'backups': a directory sharing a name with the git branch
  // makes every 'git log backups' ambiguous between a ref and a path.
  const out = arg('out') ?? join('.backups', `${resolved.target}-${stamp}.sql`)

  mkdirSync(join(out, '..'), { recursive: true })

  const sql = execFileSync(
    pgDumpPath(),
    [
      '--no-owner',
      '--no-privileges',
      '--format=plain',
      // Only our schema. A full Supabase dump carries its own extensions
      // (supabase_vault, pgsodium) and schemas (auth, storage, realtime),
      // none of which exist on plain Postgres — so it fails to restore on
      // exactly the machine you would be restoring to in an emergency.
      '--schema=public',
      resolved.connectionString,
    ],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  )

  for (const table of REQUIRED_TABLES) {
    if (!sql.includes(`CREATE TABLE public.${table}`)) {
      console.error(`\nFAILED — dump is missing table "${table}". Nothing written.\n`)
      process.exit(1)
    }
  }

  if (Buffer.byteLength(sql) < MIN_BYTES) {
    console.error(`\nFAILED — dump is only ${Buffer.byteLength(sql)} bytes. Nothing written.\n`)
    process.exit(1)
  }

  writeFileSync(out, sql, 'utf8')
  console.log(`\nwrote ${out} (${statSync(out).size.toLocaleString()} bytes)`)
  console.log('Verify it restores with: npm run db:restore -- --file=' + out + '\n')
}

main()
