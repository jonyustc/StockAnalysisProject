import 'server-only'

import { and, asc, desc, eq, sql } from 'drizzle-orm'

import type { CorporateActionInput } from '@/lib/corporate-actions'

import { db } from './client'
import {
  accountSnapshots,
  cashMovements,
  boAccounts,
  companies,
  corporateActions,
  dailyPrices,
  financialFacts,
  fiscalPeriods,
  jobRuns,
  ledgerImports,
  lineItemDefs,
  portfolioTransactions,
  priceTargets,
  sectors,
  sourceDocuments,
} from './schema'

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
      verifiedCount: sql<number>`(
        SELECT count(*)::int FROM ${financialFacts}
        WHERE ${financialFacts.periodId} = ${fiscalPeriods.id}
          AND ${financialFacts.isCurrent}
          AND ${financialFacts.verification} = 'verified'
      )`,
      disputedCount: sql<number>`(
        SELECT count(*)::int FROM ${financialFacts}
        WHERE ${financialFacts.periodId} = ${fiscalPeriods.id}
          AND ${financialFacts.isCurrent}
          AND ${financialFacts.verification} = 'disputed'
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
      id: financialFacts.id,
      lineItemId: financialFacts.lineItemId,
      revision: financialFacts.revision,
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
  id: number
  lineItemId: number
  revision: number
  valueReported: string
  scale: 'unit' | 'thousand' | 'lakh' | 'million' | 'crore' | 'billion'
  sourcePage: string | null
  verification: 'unverified' | 'verified' | 'disputed'
}

/**
 * Every current annual fact for a company, shaped for the metrics layer.
 *
 * Values come back as `value_base` — canonical BDT for amounts, as-reported
 * for per-share figures, since those are stored with scale 'unit' and so are
 * already base. Parsing to Number happens here, at the edge, rather than
 * letting the driver do it invisibly.
 */
export async function getFactHistory(
  companyId: number,
  basis: 'consolidated' | 'standalone' = 'consolidated',
) {
  const rows = await db
    .select({
      fiscalYear: fiscalPeriods.fiscalYear,
      tag: lineItemDefs.tag,
      valueBase: financialFacts.valueBase,
      verification: financialFacts.verification,
    })
    .from(financialFacts)
    .innerJoin(fiscalPeriods, eq(fiscalPeriods.id, financialFacts.periodId))
    .innerJoin(lineItemDefs, eq(lineItemDefs.id, financialFacts.lineItemId))
    .where(
      and(
        eq(fiscalPeriods.companyId, companyId),
        eq(fiscalPeriods.periodType, 'annual'),
        eq(fiscalPeriods.basis, basis),
        eq(financialFacts.isCurrent, true),
      ),
    )
    .orderBy(asc(fiscalPeriods.fiscalYear))

  const byYear = new Map<number, Record<string, number | null>>()
  let unverified = 0
  let disputed = 0

  for (const row of rows) {
    if (!byYear.has(row.fiscalYear)) byYear.set(row.fiscalYear, {})
    byYear.get(row.fiscalYear)![row.tag] = row.valueBase === null ? null : Number(row.valueBase)
    if (row.verification === 'unverified') unverified += 1
    if (row.verification === 'disputed') disputed += 1
  }

  return {
    years: [...byYear.entries()]
      .map(([fiscalYear, values]) => ({ fiscalYear, values }))
      .sort((a, b) => a.fiscalYear - b.fiscalYear),
    factCount: rows.length,
    unverifiedCount: unverified,
    disputedCount: disputed,
  }
}

/** Most recent quote per company, however stale. */
export async function getLatestQuotes() {
  const rows = await db.execute<{
    dse_symbol: string
    trade_date: string
    close_price: string
    ycp: string | null
    yearly_high: string | null
    yearly_low: string | null
  }>(sql`
    SELECT DISTINCT ON (c.dse_symbol)
           c.dse_symbol, p.trade_date, p.close_price, p.ycp, p.yearly_high, p.yearly_low
      FROM daily_prices p
      JOIN companies c ON c.id = p.company_id
     ORDER BY c.dse_symbol, p.trade_date DESC
  `)

  return new Map(
    rows.rows.map((row) => [
      row.dse_symbol,
      {
        tradeDate: row.trade_date,
        close: Number(row.close_price),
        ycp: row.ycp === null ? null : Number(row.ycp),
        yearlyHigh: row.yearly_high === null ? null : Number(row.yearly_high),
        yearlyLow: row.yearly_low === null ? null : Number(row.yearly_low),
      },
    ]),
  )
}

/**
 * Every tracked company's annual facts in one query.
 *
 * Eight companies at a few hundred rows each — fetching it whole and shaping
 * it in memory is far cheaper than eight round trips to Supabase's pooler.
 */
export async function getAllFactHistories(basis: 'consolidated' | 'standalone' = 'consolidated') {
  const rows = await db
    .select({
      dseSymbol: companies.dseSymbol,
      fiscalYear: fiscalPeriods.fiscalYear,
      tag: lineItemDefs.tag,
      valueBase: financialFacts.valueBase,
    })
    .from(financialFacts)
    .innerJoin(fiscalPeriods, eq(fiscalPeriods.id, financialFacts.periodId))
    .innerJoin(companies, eq(companies.id, fiscalPeriods.companyId))
    .innerJoin(lineItemDefs, eq(lineItemDefs.id, financialFacts.lineItemId))
    .where(
      and(
        eq(fiscalPeriods.periodType, 'annual'),
        eq(fiscalPeriods.basis, basis),
        eq(financialFacts.isCurrent, true),
      ),
    )
    .orderBy(asc(companies.dseSymbol), asc(fiscalPeriods.fiscalYear))

  const bySymbol = new Map<number | string, Map<number, Record<string, number | null>>>()

  for (const row of rows) {
    if (!bySymbol.has(row.dseSymbol)) bySymbol.set(row.dseSymbol, new Map())
    const years = bySymbol.get(row.dseSymbol)!
    if (!years.has(row.fiscalYear)) years.set(row.fiscalYear, {})
    years.get(row.fiscalYear)![row.tag] = row.valueBase === null ? null : Number(row.valueBase)
  }

  return new Map(
    [...bySymbol.entries()].map(([symbol, years]) => [
      symbol as string,
      [...years.entries()]
        .map(([fiscalYear, values]) => ({ fiscalYear, values }))
        .sort((a, b) => a.fiscalYear - b.fiscalYear),
    ]),
  )
}

/**
 * Corporate actions per company symbol, shaped for the adjustment layer.
 *
 * Fetched for every company at once — there are only a handful of rows, and
 * the alternative is a query per company on the screener.
 */
export async function getCorporateActionsBySymbol() {
  const rows = await db
    .select({
      dseSymbol: companies.dseSymbol,
      actionType: corporateActions.actionType,
      exDate: corporateActions.exDate,
      stockDividendPct: corporateActions.stockDividendPct,
      rightsNewShares: corporateActions.rightsNewShares,
      rightsPerExisting: corporateActions.rightsPerExisting,
      rightsPrice: corporateActions.rightsPrice,
      cumRightsPrice: corporateActions.cumRightsPrice,
      splitFrom: corporateActions.splitFrom,
      splitTo: corporateActions.splitTo,
    })
    .from(corporateActions)
    .innerJoin(companies, eq(companies.id, corporateActions.companyId))
    .orderBy(asc(corporateActions.exDate))

  const bySymbol = new Map<string, CorporateActionInput[]>()

  for (const row of rows) {
    const action: CorporateActionInput = {
      actionType: row.actionType,
      exDate: row.exDate,
      stockDividendPct: row.stockDividendPct === null ? null : Number(row.stockDividendPct),
      rightsNewShares: row.rightsNewShares,
      rightsPerExisting: row.rightsPerExisting,
      rightsPrice: row.rightsPrice === null ? null : Number(row.rightsPrice),
      cumRightsPrice: row.cumRightsPrice === null ? null : Number(row.cumRightsPrice),
      splitFrom: row.splitFrom,
      splitTo: row.splitTo,
    }

    if (!bySymbol.has(row.dseSymbol)) bySymbol.set(row.dseSymbol, [])
    bySymbol.get(row.dseSymbol)!.push(action)
  }

  return bySymbol
}

export async function listSourceDocuments(companyId: number) {
  return db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.companyId, companyId))
    .orderBy(asc(sourceDocuments.fiscalYear))
}

/** The whole ledger, newest first, with the company symbol attached. */
export async function listPortfolioTransactions() {
  const rows = await db
    .select({
      id: portfolioTransactions.id,
      accountId: portfolioTransactions.boAccountId,
      accountName: boAccounts.name,
      symbol: companies.dseSymbol,
      companyName: companies.name,
      sector: sectors.name,
      tradeDate: portfolioTransactions.tradeDate,
      txnType: portfolioTransactions.txnType,
      quantity: portfolioTransactions.quantity,
      pricePerShare: portfolioTransactions.pricePerShare,
      grossAmount: portfolioTransactions.grossAmount,
      commission: portfolioTransactions.commission,
      taxWithheld: portfolioTransactions.taxWithheld,
      notes: portfolioTransactions.notes,
      source: portfolioTransactions.source,
      recordDate: portfolioTransactions.recordDate,
    })
    .from(portfolioTransactions)
    .innerJoin(companies, eq(companies.id, portfolioTransactions.companyId))
    .innerJoin(boAccounts, eq(boAccounts.id, portfolioTransactions.boAccountId))
    .leftJoin(sectors, eq(sectors.id, companies.sectorId))
    .orderBy(desc(portfolioTransactions.tradeDate), desc(portfolioTransactions.id))

  // Numeric columns arrive as strings on purpose; convert once, here.
  return rows.map((row) => ({
    ...row,
    quantity: row.quantity === null ? null : Number(row.quantity),
    pricePerShare: row.pricePerShare === null ? null : Number(row.pricePerShare),
    grossAmount: row.grossAmount === null ? null : Number(row.grossAmount),
    commission: Number(row.commission),
    taxWithheld: Number(row.taxWithheld),
  }))
}

/** Active accounts first, then by name. */
export async function listBoAccounts() {
  return db
    .select()
    .from(boAccounts)
    .orderBy(desc(boAccounts.isActive), asc(boAccounts.name))
}

/** The most recent run of a scheduled job, to explain a stale price. */
export async function getLastJobRun(jobName: string) {
  const [run] = await db
    .select({
      startedAt: jobRuns.startedAt,
      succeeded: jobRuns.succeeded,
      message: jobRuns.message,
    })
    .from(jobRuns)
    .where(eq(jobRuns.jobName, jobName))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1)

  return run ?? null
}

/** Every account snapshot, oldest first, shaped for lib/account-return. */
export async function listAccountSnapshots() {
  const rows = await db
    .select({
      accountId: accountSnapshots.boAccountId,
      accountName: boAccounts.name,
      asOf: accountSnapshots.asOf,
      marketValue: accountSnapshots.marketValue,
      costOfHoldings: accountSnapshots.costOfHoldings,
      cashBalance: accountSnapshots.cashBalance,
      deposit: accountSnapshots.deposit,
      shareTransferIn: accountSnapshots.shareTransferIn,
      withdraw: accountSnapshots.withdraw,
      shareTransferOut: accountSnapshots.shareTransferOut,
      cashDividend: accountSnapshots.cashDividend,
      realisedGain: accountSnapshots.realisedGain,
      ipoPayment: accountSnapshots.ipoPayment,
      ipoRefund: accountSnapshots.ipoRefund,
      dividendsReceivable: accountSnapshots.dividendsReceivable,
      holdings: accountSnapshots.holdings,
    })
    .from(accountSnapshots)
    .innerJoin(boAccounts, eq(boAccounts.id, accountSnapshots.boAccountId))
    .orderBy(asc(accountSnapshots.asOf))

  const n = (v: string | null) => (v === null ? null : Number(v))

  return rows.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    asOf: row.asOf,
    marketValue: Number(row.marketValue),
    costOfHoldings: n(row.costOfHoldings),
    cashBalance: Number(row.cashBalance),
    deposit: Number(row.deposit),
    shareTransferIn: Number(row.shareTransferIn),
    withdraw: Number(row.withdraw),
    shareTransferOut: Number(row.shareTransferOut),
    cashDividend: Number(row.cashDividend),
    realisedGain: Number(row.realisedGain),
    ipoPayment: Number(row.ipoPayment),
    ipoRefund: Number(row.ipoRefund),
    dividendsReceivable: row.dividendsReceivable,
    holdings: row.holdings,
  }))
}

/** Name and short name of every company, to match names on broker statements. */
export async function listCompanyNames() {
  return db
    .select({ symbol: companies.dseSymbol, name: companies.name, shortName: companies.shortName })
    .from(companies)
}

/** Every dated cash movement, oldest first. */
export async function listCashMovements() {
  const rows = await db
    .select({
      id: cashMovements.id,
      accountId: cashMovements.boAccountId,
      accountName: boAccounts.name,
      date: cashMovements.movementDate,
      kind: cashMovements.kind,
      amount: cashMovements.amount,
      description: cashMovements.description,
    })
    .from(cashMovements)
    .innerJoin(boAccounts, eq(boAccounts.id, cashMovements.boAccountId))
    .orderBy(asc(cashMovements.movementDate), asc(cashMovements.id))

  return rows.map((row) => ({ ...row, amount: Number(row.amount) }))
}

/** Every broker ledger imported, oldest period first. */
export async function listLedgerImports() {
  const rows = await db
    .select()
    .from(ledgerImports)
    .orderBy(asc(ledgerImports.periodFrom), asc(ledgerImports.id))
  return rows.map((row) => ({
    accountId: row.boAccountId,
    from: row.periodFrom,
    to: row.periodTo,
    openingBalance: Number(row.openingBalance),
    closingBalance: Number(row.closingBalance),
    importedAt: row.importedAt,
  }))
}

/** Every price target, with its stock and account. */
export async function listPriceTargets() {
  const rows = await db
    .select({
      id: priceTargets.id,
      symbol: companies.dseSymbol,
      accountId: priceTargets.boAccountId,
      accountName: boAccounts.name,
      buyBelow: priceTargets.buyBelow,
      sellAbove: priceTargets.sellAbove,
      note: priceTargets.note,
      buyAlertedOn: priceTargets.buyAlertedOn,
      sellAlertedOn: priceTargets.sellAlertedOn,
      updatedAt: priceTargets.updatedAt,
    })
    .from(priceTargets)
    .innerJoin(companies, eq(companies.id, priceTargets.companyId))
    .leftJoin(boAccounts, eq(boAccounts.id, priceTargets.boAccountId))
    .orderBy(asc(companies.dseSymbol))

  return rows.map((row) => ({
    ...row,
    buyBelow: row.buyBelow === null ? null : Number(row.buyBelow),
    sellAbove: row.sellAbove === null ? null : Number(row.sellAbove),
  }))
}

/** Each company's last close on or before a date, e.g. a year end. */
export async function getClosesOnOrBefore(date: string) {
  const rows = await db.execute<{ dse_symbol: string; trade_date: string; close_price: string }>(sql`
    SELECT DISTINCT ON (c.dse_symbol) c.dse_symbol, p.trade_date, p.close_price
      FROM daily_prices p
      JOIN companies c ON c.id = p.company_id
     WHERE p.trade_date <= ${date}
     ORDER BY c.dse_symbol, p.trade_date DESC
  `)
  return new Map(rows.rows.map((r) => [r.dse_symbol, { close: Number(r.close_price), tradeDate: r.trade_date }]))
}

/** Daily closes for one company, oldest first — the history insights read this. */
export async function listPriceHistory(symbol: string) {
  const rows = await db
    .select({ date: dailyPrices.tradeDate, close: dailyPrices.closePrice })
    .from(dailyPrices)
    .innerJoin(companies, eq(companies.id, dailyPrices.companyId))
    .where(eq(companies.dseSymbol, symbol.toUpperCase()))
    .orderBy(asc(dailyPrices.tradeDate))

  return rows.map((row) => ({ date: row.date, close: Number(row.close) }))
}
