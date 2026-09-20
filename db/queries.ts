import 'server-only'

import { and, asc, eq, sql } from 'drizzle-orm'

import { db } from './client'
import { companies, financialFacts, fiscalPeriods, lineItemDefs, sectors, sourceDocuments } from './schema'

export async function listTrackedCompanies() {
  return db
    .select({
      id: companies.id,
      dseSymbol: companies.dseSymbol,
      name: companies.name,
      shortName: companies.shortName,
      sector: sectors.name,
      fiscalYearEndMonth: companies.fiscalYearEndMonth,
      fiscalYearEndDay: companies.fiscalYearEndDay,
      periodCount: sql<number>`(
        SELECT count(*)::int FROM ${fiscalPeriods}
        WHERE ${fiscalPeriods.companyId} = ${companies.id}
      )`,
    })
    .from(companies)
    .leftJoin(sectors, eq(sectors.id, companies.sectorId))
    .where(eq(companies.isTracked, true))
    .orderBy(asc(companies.dseSymbol))
}

export async function getCompanyBySymbol(symbol: string) {
  const [company] = await db
    .select({
      id: companies.id,
      dseSymbol: companies.dseSymbol,
      name: companies.name,
      shortName: companies.shortName,
      sectorId: companies.sectorId,
      statementTemplate: companies.statementTemplate,
      fiscalYearEndMonth: companies.fiscalYearEndMonth,
      fiscalYearEndDay: companies.fiscalYearEndDay,
      faceValue: companies.faceValue,
      notes: companies.notes,
    })
    .from(companies)
    .where(eq(companies.dseSymbol, symbol.toUpperCase()))
    .limit(1)

  return company ?? null
}

/**
 * The core set — the minimum worth entering on a first pass. Ten years of
 * these is far more useful than one exhaustively complete year.
 */
export async function getCoreLineItems() {
  return db
    .select()
    .from(lineItemDefs)
    .where(eq(lineItemDefs.isCore, true))
    .orderBy(asc(lineItemDefs.displayOrder))
}

/** How much is entered for each fiscal year, for the company overview. */
export async function getPeriodSummaries(companyId: number) {
  return db
    .select({
      fiscalYear: fiscalPeriods.fiscalYear,
      basis: fiscalPeriods.basis,
      periodStart: fiscalPeriods.periodStart,
      periodEnd: fiscalPeriods.periodEnd,
      isComplete: fiscalPeriods.isComplete,
      factCount: sql<number>`(
        SELECT count(*)::int FROM ${financialFacts}
        WHERE ${financialFacts.periodId} = ${fiscalPeriods.id}
          AND ${financialFacts.isCurrent}
      )`,
      unverifiedCount: sql<number>`(
        SELECT count(*)::int FROM ${financialFacts}
        WHERE ${financialFacts.periodId} = ${fiscalPeriods.id}
          AND ${financialFacts.isCurrent}
          AND ${financialFacts.verification} = 'unverified'
      )`,
    })
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.companyId, companyId), eq(fiscalPeriods.periodType, 'annual')))
    .orderBy(asc(fiscalPeriods.fiscalYear))
}

export type PeriodSummary = Awaited<ReturnType<typeof getPeriodSummaries>>[number]

/** Existing period and its current facts, keyed by line item id. */
export async function getPeriodWithFacts(
  companyId: number,
  fiscalYear: number,
  basis: 'consolidated' | 'standalone',
) {
  const [period] = await db
    .select()
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, companyId),
        eq(fiscalPeriods.fiscalYear, fiscalYear),
        eq(fiscalPeriods.periodType, 'annual'),
        eq(fiscalPeriods.basis, basis),
      ),
    )
    .limit(1)

  if (!period) return { period: null, facts: new Map<number, FactRow>() }

  const rows = await db
    .select({
      lineItemId: financialFacts.lineItemId,
      valueReported: financialFacts.valueReported,
      scale: financialFacts.scale,
      sourcePage: financialFacts.sourcePage,
      verification: financialFacts.verification,
    })
    .from(financialFacts)
    .where(and(eq(financialFacts.periodId, period.id), eq(financialFacts.isCurrent, true)))

  return { period, facts: new Map(rows.map((row) => [row.lineItemId, row])) }
}

export type FactRow = {
  lineItemId: number
  valueReported: string
  scale: 'unit' | 'thousand' | 'lakh' | 'million' | 'crore' | 'billion'
  sourcePage: string | null
  verification: 'unverified' | 'verified' | 'disputed'
}

export async function listSourceDocuments(companyId: number) {
  return db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.companyId, companyId))
    .orderBy(asc(sourceDocuments.fiscalYear))
}
