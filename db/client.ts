/**
 * Database client.
 *
 * Deliberately a plain `pg` pool rather than supabase-js: the app talks SQL to
 * a connection string, so Supabase, local Postgres, or anything else Postgres
 * are interchangeable. Switching is an env var, not a rewrite.
 *
 * The connection is created lazily, on first query. Building the app must not
 * require database credentials — Next.js imports every route module while
 * collecting page data, so connecting at import time turns a missing env var
 * into a failed build rather than a clear runtime error.
 */

import 'server-only'

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

// Must come before any connection is opened.
import './pg-types'
import * as schema from './schema'

type Database = NodePgDatabase<typeof schema>

/**
 * Next.js dev mode re-evaluates modules on every hot reload, which would leak
 * a new pool each time. Cache both on globalThis.
 */
const globalForDb = globalThis as unknown as {
  __dsePool?: Pool
  __dseDb?: Database
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Locally, copy .env.example to .env.local. ' +
        'On Vercel, add it under Project Settings > Environment Variables.',
    )
  }

  const isLocal =
    connectionString.includes('localhost') || connectionString.includes('127.0.0.1')

  return new Pool({
    connectionString,
    // Supabase terminates TLS with its own CA; local Postgres needs none.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // Serverless functions are short-lived and the free tier has a modest
    // connection cap, so keep the per-instance pool small.
    max: process.env.NODE_ENV === 'production' ? 3 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

export function getPool(): Pool {
  if (!globalForDb.__dsePool) globalForDb.__dsePool = createPool()
  return globalForDb.__dsePool
}

function getDb(): Database {
  if (!globalForDb.__dseDb) globalForDb.__dseDb = drizzle(getPool(), { schema })
  return globalForDb.__dseDb
}

/**
 * Behaves exactly like a Drizzle instance, but defers connecting until the
 * first property is touched — which is never during a build.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const instance = getDb()
    const value = Reflect.get(instance as object, property, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export { schema }
