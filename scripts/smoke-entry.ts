/**
 * End-to-end exercise of the entry save path against the local database.
 *
 * Uses real figures from Marico's FY2026 income statement so the numbers can
 * be eyeballed against the published statement rather than being arbitrary.
 * Cleans up after itself.
 *
 *   npx tsx scripts/smoke-entry.ts
 */

import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local', quiet: true })

// next/cache's revalidatePath needs a request context that a plain script does
// not have. Stub it so the action's database work can be exercised directly.
import Module from 'node:module'

const require_ = Module.createRequire(import.meta.url)

function stub(specifier: string, exports: unknown) {
  const path = require_.resolve(specifier)
  require_.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports,
  } as NodeJS.Module
}

stub('next/cache', { revalidatePath: () => {}, revalidateTag: () => {} })

// Outside a React build there is no "react-server" export condition, so
// server-only resolves to its throwing client entry. Neutralise it.
stub('server-only', {})

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.append(key, value)
  return data
}

const BASE = {
  symbol: 'MARICO',
  fiscalYear: '2026',
  basis: 'consolidated',
  scale: 'million',
  auditStatus: 'audited',
  docTitle: 'Annual Report 2025-26 (smoke test)',
  docPath: 'MARICO/AR-2026.pdf',
}

async function run() {
  // Imported after the next/cache stub is installed.
  const { saveAnnualEntry } = await import('../app/actions')
  const { db } = await import('../db/client')
  const { companies, financialFacts, fiscalPeriods } = await import('../db/schema')
  const { and, eq } = await import('drizzle-orm')

  console.log('\n1. save with real figures')
  const first = await saveAnnualEntry(
    null,
    form({
      ...BASE,
      // As printed in a "Taka in million" statement.
      value__revenue: '20,712',
      page__revenue: '112',
      value__gross_profit: '10,212',
      page__gross_profit: '112',
      value__operating_profit: '7,254',
      value__net_profit: '6,250',
      // Per-share figures must NOT take the million scale.
      value__eps_basic: '198.44',
      page__eps_basic: '114',
      // Accountants' parentheses.
      value__capex: '(1,240)',
      // Blank must mean absent, not zero.
      value__navps: '',
    }),
  )
  console.log('  ', first)

  const [company] = await db.select().from(companies).where(eq(companies.dseSymbol, 'MARICO'))
  const [period] = await db
    .select()
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.companyId, company.id), eq(fiscalPeriods.fiscalYear, 2026)))

  console.log('\n2. stored values')
  const stored = await db.execute(
    `SELECT l.tag, f.value_reported, f.scale, f.value_base, f.source_page
     FROM financial_facts f JOIN line_item_defs l ON l.id = f.line_item_id
     WHERE f.period_id = ${period.id} AND f.is_current
     ORDER BY l.display_order`,
  )
  console.table(stored.rows)

  console.log('\n3. checks')
  const rows = stored.rows as Record<string, string>[]
  const revenue = rows.find((r) => r.tag === 'revenue')
  const eps = rows.find((r) => r.tag === 'eps_basic')
  const capex = rows.find((r) => r.tag === 'capex')
  const navps = rows.find((r) => r.tag === 'navps')

  check('revenue scaled to base', revenue?.value_base === '20712000000.000000')
  check('EPS left unscaled', eps?.scale === 'unit' && eps?.value_base === '198.440000')
  check('parentheses read as negative', capex?.value_reported === '-1240.000000')
  check('blank stored as absent, not zero', navps === undefined)
  check('page number kept', revenue?.source_page === '112')
  check('period dates correct', period.periodStart === '2025-04-01' && period.periodEnd === '2026-03-31')

  console.log('\n4. re-save clearing a value')
  const second = await saveAnnualEntry(
    null,
    form({ ...BASE, value__revenue: '', value__eps_basic: '198.44' }),
  )
  console.log('  ', second)

  const after = await db
    .select()
    .from(financialFacts)
    .where(and(eq(financialFacts.periodId, period.id), eq(financialFacts.isCurrent, true)))
  check('cleared field removed the fact', !after.some((f) => f.lineItemId === revenueItemId(rows)))

  console.log('\n5. rejects a bad number without saving anything')
  const bad = await saveAnnualEntry(null, form({ ...BASE, value__revenue: 'see note 14' }))
  check('bad input rejected', bad.ok === false && Boolean(bad.fieldErrors?.revenue))
  console.log('  ', bad.message, bad.fieldErrors)

  // Clean up.
  await db.delete(fiscalPeriods).where(eq(fiscalPeriods.id, period.id))
  console.log('\ncleaned up.\n')
}

function revenueItemId(rows: Record<string, string>[]): number {
  return Number(rows.find((r) => r.tag === 'revenue')?.line_item_id ?? -1)
}

let failures = 0
function check(label: string, condition: boolean) {
  console.log(`   ${condition ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!condition) failures += 1
}

run()
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
