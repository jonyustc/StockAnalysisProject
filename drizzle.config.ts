import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit is used for `studio` (a browser DB viewer) and `pull`
 * (regenerate db/schema.ts from the live database). It is NOT used to generate
 * migrations — those are hand-written SQL in db/migrations, applied by
 * scripts/migrate.ts.
 */
export default defineConfig({
  schema: './db/schema.ts',
  out: './db/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
})
