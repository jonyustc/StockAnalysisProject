/**
 * Migration runner.
 *
 * Applies db/migrations/*.sql in filename order, once each, inside a
 * transaction, recording what ran in a _migrations table.
 *
 *   npm run db:migrate          apply pending migrations
 *   npm run db:migrate -- --seed   apply migrations, then re-run the seed files
 *   npm run db:status           list applied and pending, apply nothing
 *
 * Raw SQL rather than drizzle-kit generate, because the schema uses generated
 * columns, partial unique indexes and CHECK constraints that a generator
 * handles unreliably. The SQL files are the source of truth.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import 'dotenv/config'
import { Client } from 'pg'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')
const SEED_DIR = join(process.cwd(), 'db', 'seed')

/**
 * Migrations run against the direct connection, not the pooler: DDL and
 * advisory locks do not behave under transaction-mode pooling.
 */
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL

if (!connectionString) {
  console.error('DIRECT_URL / DATABASE_URL is not set. See .env.example.')
  process.exit(1)
}

const isLocal =
  connectionString.includes('localhost') || connectionString.includes('127.0.0.1')

const args = new Set(process.argv.slice(2))
const withSeed = args.has('--seed')
const statusOnly = args.has('--status')

function sqlFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  } catch {
    return []
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function main() {
  const client = new Client({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  })

  await client.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `)

    const { rows: applied } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM _migrations',
    )
    const appliedByName = new Map(applied.map((r) => [r.name, r.checksum]))

    const files = sqlFiles(MIGRATIONS_DIR)
    if (files.length === 0) {
      console.log('No migration files found in db/migrations.')
    }

    const pending: string[] = []

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      const checksum = sha256(sql)
      const previous = appliedByName.get(file)

      if (previous === undefined) {
        pending.push(file)
        continue
      }

      if (previous !== checksum) {
        // An applied migration was edited after the fact. Silently re-running
        // it would not restore consistency, so refuse and let a human decide.
        console.error(
          `\n  ${file} has changed since it was applied.\n` +
            `  Applied checksum: ${previous}\n` +
            `  Current checksum: ${checksum}\n\n` +
            `  Write a new migration instead of editing an applied one.\n`,
        )
        process.exit(1)
      }

      console.log(`  already applied  ${file}`)
    }

    if (statusOnly) {
      if (pending.length === 0) {
        console.log('\nUp to date. Nothing pending.')
      } else {
        console.log(`\nPending (${pending.length}):`)
        for (const file of pending) console.log(`  ${file}`)
      }
      return
    }

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      process.stdout.write(`  applying        ${file} ... `)

      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(
          'INSERT INTO _migrations (name, checksum) VALUES ($1, $2)',
          [file, sha256(sql)],
        )
        await client.query('COMMIT')
        console.log('ok')
      } catch (error) {
        await client.query('ROLLBACK')
        console.log('failed')
        throw error
      }
    }

    if (pending.length === 0) {
      console.log('\nNo pending migrations.')
    } else {
      console.log(`\nApplied ${pending.length} migration(s).`)
    }

    if (withSeed) {
      const seeds = sqlFiles(SEED_DIR)
      console.log(`\nSeeding (${seeds.length} file(s)):`)

      for (const file of seeds) {
        const sql = readFileSync(join(SEED_DIR, file), 'utf8')
        process.stdout.write(`  seeding         ${file} ... `)
        try {
          await client.query('BEGIN')
          await client.query(sql)
          await client.query('COMMIT')
          console.log('ok')
        } catch (error) {
          await client.query('ROLLBACK')
          console.log('failed')
          throw error
        }
      }
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('\n', error instanceof Error ? error.message : error, '\n')
  process.exit(1)
})
