/**
 * End-to-end exercise of the verification path against the local database.
 *
 * Runs on a sentinel fiscal year no real period can occupy, and cleans up
 * after itself.
 *
 *   npx tsx scripts/smoke-verify.ts
 */

import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local', quiet: true })

import Module from 'node:module'

const require_ = Module.createRequire(import.meta.url)

function stub(specifier: string, exports: unknown) {
  const path = require_.resolve(specifier)
  require_.cache[path] = { id: path, filename: path, loaded: true, exports } as NodeJS.Module
}

stub('next/cache', { revalidatePath: () => {}, revalidateTag: () => {} })
stub('server-only', {})

const SENTINEL_FISCAL_YEAR = 1901

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.append(key, value)
  return data
}

const BASE = {
  symbol: 'MARICO',
  fiscalYear: String(SENTINEL_FISCAL_YEAR),
  basis: 'consolidated',
  scale: 'million',
}

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`   ${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!condition) failures += 1
}

async function run() {
  const { saveAnnualEntry, verifyAnnualEntry } = await import('../app/actions')
  const { db } = await import('../db/client')
  const { companies, fiscalPeriods } = await import('../db/schema')
  const { and, eq } = await import('drizzle-orm')

  const [company] = await db.select().from(companies).where(eq(companies.dseSymbol, 'MARICO'))

  // Start clean, in case a previous run died mid-way.
  await db
    .delete(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, company.id),
        eq(fiscalPeriods.fiscalYear, SENTINEL_FISCAL_YEAR),
      ),
    )

  console.log('\n1. seed a year, as the importer would')
  await saveAnnualEntry(
    null,
    form({
      ...BASE,
      auditStatus: 'audited',
      docTitle: 'Annual Report (verify smoke test)',
      value__revenue: '20,712',
      value__net_profit: '6,492',
      value__eps_basic: '206.09',
    }),
  )

  const [period] = await db
    .select()
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, company.id),
        eq(fiscalPeriods.fiscalYear, SENTINEL_FISCAL_YEAR),
      ),
    )

  async function state() {
    const res = await db.execute(
      `SELECT l.tag, f.value_reported, f.revision, f.is_current, f.verification, f.source_page
         FROM financial_facts f JOIN line_item_defs l ON l.id = f.line_item_id
        WHERE f.period_id = ${period.id}
        ORDER BY l.tag, f.revision`,
    )
    return res.rows as {
      tag: string
      value_reported: string
      revision: number
      is_current: boolean
      verification: string
      source_page: string | null
    }[]
  }

  const seeded = await state()
  check('seeded facts are unverified', seeded.every((r) => r.verification === 'unverified'))

  console.log('\n2. report agrees with revenue, disagrees on EPS, says nothing about the rest')
  const result = await verifyAnnualEntry(
    null,
    form({
      ...BASE,
      value__revenue: '20,712',
      page__revenue: '112',
      value__eps_basic: '198.44',
      page__eps_basic: '114',
      value__navps: '92.02',
      value__net_profit: '',
    }),
  )
  console.log('  ', result.message)
  console.log('  ', result.outcomes)

  const after = await state()
  const current = (tag: string) => after.find((r) => r.tag === tag && r.is_current)
  const all = (tag: string) => after.filter((r) => r.tag === tag)

  check('matching figure marked verified', current('revenue')?.verification === 'verified')
  check('page recorded', current('revenue')?.source_page === '112')

  check('differing figure superseded, not overwritten', all('eps_basic').length === 2)
  check(
    'old EPS kept as a non-current revision',
    all('eps_basic').some((r) => !r.is_current && r.value_reported.startsWith('206.09')),
  )
  check(
    'report EPS is now current and verified',
    current('eps_basic')?.value_reported.startsWith('198.44') === true &&
      current('eps_basic')?.verification === 'verified',
    `rev ${current('eps_basic')?.revision}`,
  )

  check('blank left the figure alone', current('net_profit')?.verification === 'unverified')
  check(
    'a line with nothing stored was added, verified',
    current('navps')?.value_reported.startsWith('92.02') === true &&
      current('navps')?.verification === 'verified',
  )

  console.log('\n3. an unreadable entry writes nothing')
  const before = JSON.stringify(await state())
  const bad = await verifyAnnualEntry(null, form({ ...BASE, value__revenue: 'see note 14' }))
  check('rejected', bad.ok === false && Boolean(bad.fieldErrors?.revenue))
  check('database untouched', JSON.stringify(await state()) === before)

  console.log('\n4. an all-blank submission is refused rather than reported as success')
  const empty = await verifyAnnualEntry(null, form({ ...BASE }))
  check('refused', empty.ok === false, empty.message)

  if (period.fiscalYear !== SENTINEL_FISCAL_YEAR) {
    throw new Error(`Refusing to delete FY${period.fiscalYear}.`)
  }
  await db.delete(fiscalPeriods).where(eq(fiscalPeriods.id, period.id))

  const { sourceDocuments } = await import('../db/schema')
  await db
    .delete(sourceDocuments)
    .where(eq(sourceDocuments.title, 'Annual Report (verify smoke test)'))

  console.log('\ncleaned up.\n')
}

run()
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
