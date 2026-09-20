/**
 * Database client.
 *
 * Deliberately a plain `pg` pool rather than supabase-js: the app talks SQL to
 * a connection string, so Supabase, local Postgres, or anything else Postgres
 * are interchangeable. Switching is an env var, not a rewrite.
 */

import 'server-only'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
  )
}

/**
 * Supabase terminates TLS with its own CA. `sslmode=require` in the URL plus
 * rejectUnauthorized:false is what their connection strings expect; a local
 * Postgres needs no TLS at all.
 */
const isLocal =
  connectionString.includes('localhost') || connectionString.includes('127.0.0.1')

function createPool() {
  return new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // Serverless functions are short-lived and Supabase's free tier has a
    // modest connection cap. Keep the per-instance pool small.
    max: process.env.NODE_ENV === 'production' ? 3 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

/**
 * Next.js dev mode re-evaluates modules on every hot reload, which would leak
 * a new pool each time. Cache it on globalThis.
 */
const globalForDb = globalThis as unknown as { __dsePool?: Pool }

const pool = globalForDb.__dsePool ?? createPool()

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__dsePool = pool
}

export const db = drizzle(pool, { schema })

export { pool, schema }
