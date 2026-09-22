/**
 * Drizzle schema — typed mirror of db/migrations/0001_init.sql
 *
 * The SQL files are the source of truth. This file exists so queries are
 * typed; it does not generate migrations. If the two ever drift, regenerate
 * this from the live database with `npm run db:pull` rather than hand-patching.
 */

import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import type { StoredReceivable } from '@/lib/dividends'

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const statementTemplate = pgEnum('statement_template', [
  'general',
  'bank',
  'nbfi',
  'insurance',
  'mutual_fund',
])

export const statementKind = pgEnum('statement_kind', [
  'income',
  'balance',
  'cashflow',
  'per_share',
  'other',
])

export const periodType = pgEnum('period_type', [
  'annual',
  'q1',
  'q2',
  'q3',
  'q4',
  'h1',
  'nine_month',
  'ttm',
])

export const reportingBasis = pgEnum('reporting_basis', ['consolidated', 'standalone'])

export const auditStatus = pgEnum('audit_status', [
  'audited',
  'unaudited',
  'provisional',
  'restated',
])

export const valueScale = pgEnum('value_scale', [
  'unit',
  'thousand',
  'lakh',
  'million',
  'crore',
  'billion',
])

export const unitKind = pgEnum('unit_kind', [
  'currency',
  'per_share',
  'ratio',
  'percent',
  'count',
  'days',
])

export const verificationStatus = pgEnum('verification_status', [
  'unverified',
  'verified',
  'disputed',
])

export const documentType = pgEnum('document_type', [
  'annual_report',
  'quarterly_report',
  'dse_disclosure',
  'cse_disclosure',
  'price_sensitive_info',
  'press_release',
  'company_website',
  'other',
])

export const corporateActionType = pgEnum('corporate_action_type', [
  'cash_dividend',
  'stock_dividend',
  'rights_issue',
  'split',
  'reverse_split',
  'other',
])

export const noteType = pgEnum('note_type', [
  'thesis',
  'risk',
  'catalyst',
  'management',
  'industry',
  'valuation',
  'review',
  'other',
])

/** Multipliers for `value_scale`, mirroring the generated column in SQL. */
export const SCALE_FACTORS: Record<(typeof valueScale.enumValues)[number], number> = {
  unit: 1,
  thousand: 1_000,
  lakh: 100_000,
  million: 1_000_000,
  crore: 10_000_000,
  billion: 1_000_000_000,
}

/* -------------------------------------------------------------------------- */
/* sectors                                                                     */
/* -------------------------------------------------------------------------- */

export const sectors = pgTable('sectors', {
  id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* -------------------------------------------------------------------------- */
/* companies                                                                   */
/* -------------------------------------------------------------------------- */

export const companies = pgTable(
  'companies',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),

    dseSymbol: text('dse_symbol').notNull().unique(),
    altSymbols: text('alt_symbols').array().notNull().default(sql`'{}'`),
    name: text('name').notNull(),
    shortName: text('short_name'),

    sectorId: smallint('sector_id').references(() => sectors.id),
    statementTemplate: statementTemplate('statement_template').notNull().default('general'),

    /** FY<N> is the fiscal year ENDING in calendar year N. */
    fiscalYearEndMonth: smallint('fiscal_year_end_month').notNull(),
    fiscalYearEndDay: smallint('fiscal_year_end_day').notNull(),

    reportingCurrency: char('reporting_currency', { length: 3 }).notNull().default('BDT'),
    faceValue: numeric('face_value', { precision: 12, scale: 4 }).notNull().default('10'),
    isin: text('isin'),
    listingDate: date('listing_date'),

    isTracked: boolean('is_tracked').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    website: text('website'),
    investorRelationsUrl: text('investor_relations_url'),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('companies_sector_idx').on(t.sectorId),
    index('companies_tracked_idx').on(t.isTracked).where(sql`is_tracked`),
  ],
)

/* -------------------------------------------------------------------------- */
/* source_documents                                                            */
/* -------------------------------------------------------------------------- */

export const sourceDocuments = pgTable(
  'source_documents',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    companyId: bigint('company_id', { mode: 'number' }).references(() => companies.id, {
      onDelete: 'cascade',
    }),

    docType: documentType('doc_type').notNull(),
    title: text('title').notNull(),
    fiscalYear: smallint('fiscal_year'),
    publishedDate: date('published_date'),

    /** Path relative to your StockDoc root. PDFs live in OneDrive, not the DB. */
    onedrivePath: text('onedrive_path'),
    sourceUrl: text('source_url'),
    fileSha256: text('file_sha256'),
    pageCount: smallint('page_count'),

    accessedDate: date('accessed_date').notNull().defaultNow(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('source_documents_company_idx').on(t.companyId, t.fiscalYear),
    // Lets an importer upsert its own document instead of leaving the previous
    // one orphaned on every re-run.
    uniqueIndex('source_documents_company_title_unique').on(t.companyId, t.title),
  ],
)

/* -------------------------------------------------------------------------- */
/* fiscal_periods                                                              */
/* -------------------------------------------------------------------------- */

export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    companyId: bigint('company_id', { mode: 'number' })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    fiscalYear: smallint('fiscal_year').notNull(),
    periodType: periodType('period_type').notNull().default('annual'),
    basis: reportingBasis('basis').notNull().default('consolidated'),

    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    monthsCovered: smallint('months_covered').notNull().default(12),

    /** DSE quarterlies are often cumulative (a Q3 report covers nine months). */
    isCumulative: boolean('is_cumulative').notNull().default(false),

    auditStatus: auditStatus('audit_status').notNull().default('audited'),

    sourceDocumentId: bigint('source_document_id', { mode: 'number' }).references(
      () => sourceDocuments.id,
      { onDelete: 'set null' },
    ),
    sourcePage: text('source_page'),

    isComplete: boolean('is_complete').notNull().default(false),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fiscal_periods_unique').on(t.companyId, t.fiscalYear, t.periodType, t.basis),
    index('fiscal_periods_company_year_idx').on(t.companyId, t.fiscalYear),
    index('fiscal_periods_end_idx').on(t.periodEnd),
  ],
)

/* -------------------------------------------------------------------------- */
/* line_item_defs                                                              */
/* -------------------------------------------------------------------------- */

export const lineItemDefs = pgTable(
  'line_item_defs',
  {
    id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
    /** Stable machine name, e.g. 'net_profit'. Never rename these. */
    tag: text('tag').notNull().unique(),
    label: text('label').notNull(),
    statement: statementKind('statement').notNull(),
    unit: unitKind('unit').notNull().default('currency'),

    /** Which company templates this line applies to. Empty array = all. */
    appliesTo: statementTemplate('applies_to').array().notNull().default(sql`'{}'`),

    displayOrder: smallint('display_order').notNull().default(0),
    isSubtotal: boolean('is_subtotal').notNull().default(false),
    /** The minimum set worth entering on the first pass. */
    isCore: boolean('is_core').notNull().default(false),
    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('line_item_defs_statement_idx').on(t.statement, t.displayOrder)],
)

/* -------------------------------------------------------------------------- */
/* financial_facts                                                             */
/* -------------------------------------------------------------------------- */

export const financialFacts = pgTable(
  'financial_facts',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    periodId: bigint('period_id', { mode: 'number' })
      .notNull()
      .references(() => fiscalPeriods.id, { onDelete: 'cascade' }),
    lineItemId: smallint('line_item_id')
      .notNull()
      .references(() => lineItemDefs.id),

    /** Exactly the figure printed in the report, in the scale it was printed in. */
    valueReported: numeric('value_reported', { precision: 24, scale: 6 }).notNull(),
    scale: valueScale('scale').notNull().default('unit'),

    /** Derived in Postgres. Never write to this. */
    valueBase: numeric('value_base', { precision: 30, scale: 6 }).generatedAlwaysAs(
      sql`value_reported * (CASE scale
            WHEN 'unit' THEN 1::numeric
            WHEN 'thousand' THEN 1000::numeric
            WHEN 'lakh' THEN 100000::numeric
            WHEN 'million' THEN 1000000::numeric
            WHEN 'crore' THEN 10000000::numeric
            WHEN 'billion' THEN 1000000000::numeric
          END)`,
    ),

    /** Restatements create a new revision; the original row stays. */
    revision: smallint('revision').notNull().default(1),
    isCurrent: boolean('is_current').notNull().default(true),
    restatedReason: text('restated_reason'),

    sourceDocumentId: bigint('source_document_id', { mode: 'number' }).references(
      () => sourceDocuments.id,
      { onDelete: 'set null' },
    ),
    sourcePage: text('source_page'),

    verification: verificationStatus('verification').notNull().default('unverified'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('financial_facts_revision_unique').on(t.periodId, t.lineItemId, t.revision),
    uniqueIndex('financial_facts_one_current_idx')
      .on(t.periodId, t.lineItemId)
      .where(sql`is_current`),
    index('financial_facts_line_item_idx').on(t.lineItemId).where(sql`is_current`),
  ],
)

/* -------------------------------------------------------------------------- */
/* corporate_actions                                                           */
/* -------------------------------------------------------------------------- */

export const corporateActions = pgTable(
  'corporate_actions',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    companyId: bigint('company_id', { mode: 'number' })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    actionType: corporateActionType('action_type').notNull(),
    fiscalYear: smallint('fiscal_year'),

    declarationDate: date('declaration_date'),
    recordDate: date('record_date'),
    /** The date the adjustment applies from. */
    exDate: date('ex_date'),
    agmDate: date('agm_date'),
    paymentDate: date('payment_date'),

    /** DSE quotes dividends as a percentage of face value. */
    cashDividendPct: numeric('cash_dividend_pct', { precision: 10, scale: 4 }),
    stockDividendPct: numeric('stock_dividend_pct', { precision: 10, scale: 4 }),
    cashPerShare: numeric('cash_per_share', { precision: 18, scale: 6 }),

    rightsNewShares: integer('rights_new_shares'),
    rightsPerExisting: integer('rights_per_existing'),
    rightsPrice: numeric('rights_price', { precision: 18, scale: 6 }),
    cumRightsPrice: numeric('cum_rights_price', { precision: 18, scale: 6 }),

    splitFrom: integer('split_from'),
    splitTo: integer('split_to'),

    /** Multiplier applied to prior per-share figures and prices. 1 = no change. */
    adjustmentFactor: numeric('adjustment_factor', { precision: 18, scale: 12 })
      .notNull()
      .default('1'),

    sourceDocumentId: bigint('source_document_id', { mode: 'number' }).references(
      () => sourceDocuments.id,
      { onDelete: 'set null' },
    ),
    sourcePage: text('source_page'),
    verification: verificationStatus('verification').notNull().default('unverified'),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('corporate_actions_company_idx').on(t.companyId, t.exDate),
    index('corporate_actions_fy_idx').on(t.companyId, t.fiscalYear),
  ],
)

/* -------------------------------------------------------------------------- */
/* share_history                                                               */
/* -------------------------------------------------------------------------- */

export const shareHistory = pgTable(
  'share_history',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    companyId: bigint('company_id', { mode: 'number' })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    effectiveDate: date('effective_date').notNull(),
    sharesOutstanding: numeric('shares_outstanding', { precision: 24, scale: 2 }).notNull(),
    corporateActionId: bigint('corporate_action_id', { mode: 'number' }).references(
      () => corporateActions.id,
      { onDelete: 'set null' },
    ),
    sourceDocumentId: bigint('source_document_id', { mode: 'number' }).references(
      () => sourceDocuments.id,
      { onDelete: 'set null' },
    ),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('share_history_unique').on(t.companyId, t.effectiveDate),
    index('share_history_company_idx').on(t.companyId, t.effectiveDate),
  ],
)

/* -------------------------------------------------------------------------- */
/* daily_prices                                                                */
/* -------------------------------------------------------------------------- */

export const dailyPrices = pgTable(
  'daily_prices',
  {
    companyId: bigint('company_id', { mode: 'number' })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    tradeDate: date('trade_date').notNull(),

    openPrice: numeric('open_price', { precision: 18, scale: 4 }),
    highPrice: numeric('high_price', { precision: 18, scale: 4 }),
    lowPrice: numeric('low_price', { precision: 18, scale: 4 }),
    closePrice: numeric('close_price', { precision: 18, scale: 4 }).notNull(),
    /** Yesterday's closing price, as DSE reports it. */
    ycp: numeric('ycp', { precision: 18, scale: 4 }),

    volume: bigint('volume', { mode: 'number' }),
    valueBdt: numeric('value_bdt', { precision: 24, scale: 2 }),
    tradeCount: integer('trade_count'),

    source: text('source').notNull().default('manual'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('daily_prices_date_idx').on(t.tradeDate)],
)

/* -------------------------------------------------------------------------- */
/* metric_defs / metric_values                                                 */
/* -------------------------------------------------------------------------- */

export const metricDefs = pgTable('metric_defs', {
  id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  unit: unitKind('unit').notNull().default('ratio'),
  /** The exact definition, in words. Write it down. */
  formulaNote: text('formula_note').notNull(),
  /** Bump when the formula changes, then recompute. */
  calcVersion: smallint('calc_version').notNull().default(1),
  displayOrder: smallint('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const metricValues = pgTable(
  'metric_values',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    companyId: bigint('company_id', { mode: 'number' })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    periodId: bigint('period_id', { mode: 'number' }).references(() => fiscalPeriods.id, {
      onDelete: 'cascade',
    }),
    metricId: smallint('metric_id')
      .notNull()
      .references(() => metricDefs.id, { onDelete: 'cascade' }),

    value: numeric('value', { precision: 24, scale: 8 }),
    calcVersion: smallint('calc_version').notNull().default(1),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Which facts fed it — for debugging a surprising number. */
    inputsNote: text('inputs_note'),
  },
  (t) => [
    uniqueIndex('metric_values_unique').on(t.companyId, t.periodId, t.metricId),
    index('metric_values_company_idx').on(t.companyId, t.metricId),
  ],
)

/* -------------------------------------------------------------------------- */
/* research_notes                                                              */
/* -------------------------------------------------------------------------- */

export const researchNotes = pgTable(
  'research_notes',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    companyId: bigint('company_id', { mode: 'number' })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    noteType: noteType('note_type').notNull().default('thesis'),
    title: text('title').notNull(),
    body: text('body'),

    fairValue: numeric('fair_value', { precision: 18, scale: 4 }),
    entryPrice: numeric('entry_price', { precision: 18, scale: 4 }),
    targetHorizon: text('target_horizon'),
    conviction: smallint('conviction'),

    /** Price when you wrote it, so you can judge the call honestly later. */
    priceAtWriting: numeric('price_at_writing', { precision: 18, scale: 4 }),
    reviewedAt: date('reviewed_at'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('research_notes_company_idx').on(t.companyId, t.createdAt)],
)

/* -------------------------------------------------------------------------- */
/* job_runs                                                                    */
/* -------------------------------------------------------------------------- */

export const jobRuns = pgTable(
  'job_runs',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    jobName: text('job_name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    succeeded: boolean('succeeded'),
    rowsAffected: integer('rows_affected'),
    message: text('message'),
  },
  (t) => [index('job_runs_name_idx').on(t.jobName, t.startedAt)],
)

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const sectorsRelations = relations(sectors, ({ many }) => ({
  companies: many(companies),
}))

export const companiesRelations = relations(companies, ({ one, many }) => ({
  sector: one(sectors, { fields: [companies.sectorId], references: [sectors.id] }),
  periods: many(fiscalPeriods),
  documents: many(sourceDocuments),
  corporateActions: many(corporateActions),
  shareHistory: many(shareHistory),
  prices: many(dailyPrices),
  metrics: many(metricValues),
  notes: many(researchNotes),
}))

export const sourceDocumentsRelations = relations(sourceDocuments, ({ one, many }) => ({
  company: one(companies, { fields: [sourceDocuments.companyId], references: [companies.id] }),
  periods: many(fiscalPeriods),
  facts: many(financialFacts),
}))

export const fiscalPeriodsRelations = relations(fiscalPeriods, ({ one, many }) => ({
  company: one(companies, { fields: [fiscalPeriods.companyId], references: [companies.id] }),
  sourceDocument: one(sourceDocuments, {
    fields: [fiscalPeriods.sourceDocumentId],
    references: [sourceDocuments.id],
  }),
  facts: many(financialFacts),
}))

export const lineItemDefsRelations = relations(lineItemDefs, ({ many }) => ({
  facts: many(financialFacts),
}))

export const financialFactsRelations = relations(financialFacts, ({ one }) => ({
  period: one(fiscalPeriods, {
    fields: [financialFacts.periodId],
    references: [fiscalPeriods.id],
  }),
  lineItem: one(lineItemDefs, {
    fields: [financialFacts.lineItemId],
    references: [lineItemDefs.id],
  }),
  sourceDocument: one(sourceDocuments, {
    fields: [financialFacts.sourceDocumentId],
    references: [sourceDocuments.id],
  }),
}))

export const corporateActionsRelations = relations(corporateActions, ({ one }) => ({
  company: one(companies, { fields: [corporateActions.companyId], references: [companies.id] }),
}))

export const dailyPricesRelations = relations(dailyPrices, ({ one }) => ({
  company: one(companies, { fields: [dailyPrices.companyId], references: [companies.id] }),
}))

export const metricValuesRelations = relations(metricValues, ({ one }) => ({
  company: one(companies, { fields: [metricValues.companyId], references: [companies.id] }),
  period: one(fiscalPeriods, { fields: [metricValues.periodId], references: [fiscalPeriods.id] }),
  metric: one(metricDefs, { fields: [metricValues.metricId], references: [metricDefs.id] }),
}))

export const researchNotesRelations = relations(researchNotes, ({ one }) => ({
  company: one(companies, { fields: [researchNotes.companyId], references: [companies.id] }),
}))

/* -------------------------------------------------------------------------- */
/* Inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type Company = typeof companies.$inferSelect
export type NewCompany = typeof companies.$inferInsert
export type FiscalPeriod = typeof fiscalPeriods.$inferSelect
export type NewFiscalPeriod = typeof fiscalPeriods.$inferInsert
export type LineItemDef = typeof lineItemDefs.$inferSelect
export type FinancialFact = typeof financialFacts.$inferSelect
export type NewFinancialFact = typeof financialFacts.$inferInsert
export type CorporateAction = typeof corporateActions.$inferSelect
export type NewCorporateAction = typeof corporateActions.$inferInsert
export type DailyPrice = typeof dailyPrices.$inferSelect
export type SourceDocument = typeof sourceDocuments.$inferSelect
export type ResearchNote = typeof researchNotes.$inferSelect

/* -------------------------------------------------------------------------- */
/* bo_accounts                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A CDBL Beneficiary Owner account. A boundary, not a label: shares bought in
 * one account cannot be sold from another, so cost basis is per account.
 */
export const boAccounts = pgTable('bo_accounts', {
  id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
  name: text('name').notNull().unique(),
  /** 16-digit CDBL BO ID. Optional; goes into the nightly backup if set. */
  boNumber: text('bo_number'),
  broker: text('broker'),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type BoAccount = typeof boAccounts.$inferSelect

/* -------------------------------------------------------------------------- */
/* portfolio_transactions                                                      */
/* -------------------------------------------------------------------------- */

export const transactionType = pgEnum('transaction_type', [
  'buy',
  'sell',
  'bonus',
  'rights',
  'dividend',
])

/**
 * A chronological ledger of what you actually did. Quantity and average cost
 * are derived from it in lib/portfolio.ts, never stored — a holding is the
 * outcome of a sequence of events, not a fact in its own right.
 */
export const portfolioTransactions = pgTable(
  'portfolio_transactions',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    companyId: bigint('company_id', { mode: 'number' })
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    boAccountId: smallint('bo_account_id')
      .notNull()
      .references(() => boAccounts.id, { onDelete: 'restrict' }),

    tradeDate: date('trade_date').notNull(),
    txnType: transactionType('txn_type').notNull(),

    /** Null for a cash dividend, which moves no shares. */
    quantity: numeric('quantity', { precision: 20, scale: 4 }),
    /** Zero for a bonus issue — those shares cost nothing. */
    /** Ten decimals, so a price derived from a broker's total reproduces it exactly. */
    pricePerShare: numeric('price_per_share', { precision: 28, scale: 10 }),
    /** Cash dividend before tax. Only used by 'dividend'. */
    grossAmount: numeric('gross_amount', { precision: 24, scale: 4 }),

    commission: numeric('commission', { precision: 18, scale: 4 }).notNull().default('0'),
    taxWithheld: numeric('tax_withheld', { precision: 18, scale: 4 }).notNull().default('0'),

    corporateActionId: bigint('corporate_action_id', { mode: 'number' }).references(
      () => corporateActions.id,
      { onDelete: 'set null' },
    ),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('portfolio_transactions_company_idx').on(t.companyId, t.tradeDate),
    index('portfolio_transactions_date_idx').on(t.tradeDate),
  ],
)

export const portfolioTransactionsRelations = relations(portfolioTransactions, ({ one }) => ({
  company: one(companies, {
    fields: [portfolioTransactions.companyId],
    references: [companies.id],
  }),
  corporateAction: one(corporateActions, {
    fields: [portfolioTransactions.corporateActionId],
    references: [corporateActions.id],
  }),
}))

export type PortfolioTransactionRow = typeof portfolioTransactions.$inferSelect
export type NewPortfolioTransaction = typeof portfolioTransactions.$inferInsert

/* -------------------------------------------------------------------------- */
/* account_snapshots                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A BO account's totals as printed on one broker statement. Returns are
 * computed from a series of these in lib/account-return.ts, never stored.
 */
export const accountSnapshots = pgTable(
  'account_snapshots',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    boAccountId: smallint('bo_account_id')
      .notNull()
      .references(() => boAccounts.id, { onDelete: 'cascade' }),
    asOf: date('as_of').notNull(),
    broker: text('broker'),

    marketValue: numeric('market_value', { precision: 20, scale: 2 }).notNull(),
    costOfHoldings: numeric('cost_of_holdings', { precision: 20, scale: 2 }),
    cashBalance: numeric('cash_balance', { precision: 20, scale: 2 }).notNull(),

    deposit: numeric('deposit', { precision: 20, scale: 2 }).notNull().default('0'),
    ipoRefund: numeric('ipo_refund', { precision: 20, scale: 2 }).notNull().default('0'),
    cashDividend: numeric('cash_dividend', { precision: 20, scale: 2 }).notNull().default('0'),
    shareTransferIn: numeric('share_transfer_in', { precision: 20, scale: 2 }).notNull().default('0'),
    withdraw: numeric('withdraw', { precision: 20, scale: 2 }).notNull().default('0'),
    ipoPayment: numeric('ipo_payment', { precision: 20, scale: 2 }).notNull().default('0'),
    shareTransferOut: numeric('share_transfer_out', { precision: 20, scale: 2 }).notNull().default('0'),
    realisedGain: numeric('realised_gain', { precision: 20, scale: 2 }).notNull().default('0'),

    /** Cash dividends declared but not yet paid, as printed on the statement. */
    dividendsReceivable: jsonb('dividends_receivable').$type<StoredReceivable[]>().notNull().default([]),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('account_snapshots_one_per_day').on(t.boAccountId, t.asOf),
    index('account_snapshots_account_idx').on(t.boAccountId, t.asOf),
  ],
)
