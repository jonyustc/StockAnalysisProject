-- =============================================================================
-- DSE Stock Research Database — initial schema
-- Target: PostgreSQL 15+ (runs identically on Supabase and local Postgres)
-- =============================================================================
--
-- Design decisions worth knowing before you read on:
--
-- 1. Facts are stored LONG, not WIDE. Instead of a table with `revenue`,
--    `eps`, `navps` ... as columns, there is one row per (period, line item).
--    Reason: banks, NBFIs and insurers have completely different statement
--    structures. A wide table dies the day you add a bank; this one does not.
--
-- 2. Nothing is stored "per fiscal year" alone. Every period carries real
--    start/end dates, because your seven companies do not share a year-end
--    (Marico ends 31 Mar, Square 30 Jun, LafargeHolcim 31 Dec).
--
-- 3. Numbers are stored EXACTLY as printed in the report, together with the
--    scale they were printed in ('000, million, crore ...). A generated column
--    derives the canonical BDT value. You can always prove what the report said.
--
-- 4. Restatements never overwrite. A corrected figure is a new revision; the
--    original stays, flagged not-current.
--
-- 5. Corporate actions (bonus shares, rights issues, splits) are first-class
--    from day one. Without them, every per-share history and every CAGR you
--    compute is wrong. This is the single most common way a DSE research
--    database quietly corrupts itself.
--
-- 6. Raw facts and derived metrics are separate. Metrics carry a calc_version
--    so you can change a formula (ROCE definitions vary) and recompute without
--    touching a single reported number.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------

-- Which statement layout a company uses. Drives which line items apply.
CREATE TYPE statement_template AS ENUM (
    'general',      -- manufacturing, pharma, FMCG, cement, telecom ...
    'bank',
    'nbfi',
    'insurance',
    'mutual_fund'
);

CREATE TYPE statement_kind AS ENUM (
    'income',
    'balance',
    'cashflow',
    'per_share',
    'other'
);

CREATE TYPE period_type AS ENUM (
    'annual',
    'q1',
    'q2',
    'q3',
    'q4',
    'h1',
    'nine_month',
    'ttm'
);

-- Square (and others) publish both. Treat it as a dimension, not a footnote.
CREATE TYPE reporting_basis AS ENUM (
    'consolidated',
    'standalone'
);

CREATE TYPE audit_status AS ENUM (
    'audited',
    'unaudited',
    'provisional',
    'restated'
);

-- The scale a figure was printed in. Annual reports are wildly inconsistent
-- about this and it is the easiest way to end up with a 1000x error.
CREATE TYPE value_scale AS ENUM (
    'unit',
    'thousand',
    'lakh',
    'million',
    'crore',
    'billion'
);

CREATE TYPE unit_kind AS ENUM (
    'currency',     -- BDT amounts, subject to scale
    'per_share',    -- EPS, NAVPS, NOCFPS — never scaled
    'ratio',        -- times, e.g. D/E, current ratio
    'percent',      -- already a percentage
    'count',        -- share counts, employee counts
    'days'          -- inventory days, receivable days
);

CREATE TYPE verification_status AS ENUM (
    'unverified',   -- typed in, not yet checked
    'verified',     -- checked against the source document
    'disputed'      -- source is ambiguous or contradicts another source
);

CREATE TYPE document_type AS ENUM (
    'annual_report',
    'quarterly_report',
    'dse_disclosure',
    'cse_disclosure',
    'price_sensitive_info',
    'press_release',
    'company_website',
    'other'
);

CREATE TYPE corporate_action_type AS ENUM (
    'cash_dividend',
    'stock_dividend',   -- bonus shares, quoted as % on DSE
    'rights_issue',
    'split',
    'reverse_split',
    'other'
);

CREATE TYPE note_type AS ENUM (
    'thesis',
    'risk',
    'catalyst',
    'management',
    'industry',
    'valuation',
    'review',
    'other'
);


-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- sectors
-- -----------------------------------------------------------------------------

CREATE TABLE sectors (
    id           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         text NOT NULL UNIQUE,
    slug         text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sectors IS 'DSE sector classification.';


-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------

CREATE TABLE companies (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    dse_symbol             text NOT NULL UNIQUE,
    alt_symbols            text[] NOT NULL DEFAULT '{}',   -- e.g. stockanalysis.com uses LHB for LHBL
    name                   text NOT NULL,
    short_name             text,

    sector_id              smallint REFERENCES sectors(id),
    statement_template     statement_template NOT NULL DEFAULT 'general',

    -- Fiscal year end. Stored as month/day because the seven companies differ.
    -- Convention: FY<N> is the fiscal year ENDING in calendar year N.
    -- So Marico FY2026 = 1 Apr 2025 .. 31 Mar 2026.
    fiscal_year_end_month  smallint NOT NULL CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
    fiscal_year_end_day    smallint NOT NULL CHECK (fiscal_year_end_day BETWEEN 1 AND 31),

    reporting_currency     char(3) NOT NULL DEFAULT 'BDT',
    face_value             numeric(12,4) NOT NULL DEFAULT 10,   -- BDT, DSE standard is 10
    isin                   text,
    listing_date           date,

    is_tracked             boolean NOT NULL DEFAULT true,       -- in your watchlist
    is_active              boolean NOT NULL DEFAULT true,       -- still listed
    website                text,
    investor_relations_url text,
    notes                  text,

    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX companies_sector_idx  ON companies (sector_id);
CREATE INDEX companies_tracked_idx ON companies (is_tracked) WHERE is_tracked;

CREATE TRIGGER companies_set_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- source_documents
--
-- The provenance backbone. Every number should be traceable to a document and
-- a page. PDFs themselves live in OneDrive, not in the database.
-- -----------------------------------------------------------------------------

CREATE TABLE source_documents (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id     bigint REFERENCES companies(id) ON DELETE CASCADE,

    doc_type       document_type NOT NULL,
    title          text NOT NULL,
    fiscal_year    smallint,
    published_date date,

    onedrive_path  text,        -- path relative to your StockDoc root
    source_url     text,        -- where you downloaded it from
    file_sha256    text,        -- optional: detects a silently replaced file
    page_count     smallint,

    accessed_date  date NOT NULL DEFAULT current_date,
    notes          text,

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT source_documents_has_location
        CHECK (onedrive_path IS NOT NULL OR source_url IS NOT NULL)
);

CREATE INDEX source_documents_company_idx ON source_documents (company_id, fiscal_year);

CREATE TRIGGER source_documents_set_updated_at
    BEFORE UPDATE ON source_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- fiscal_periods
--
-- One row per (company, fiscal year, period type, basis). This is what facts
-- hang off. Real dates, not just a year label.
-- -----------------------------------------------------------------------------

CREATE TABLE fiscal_periods (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    fiscal_year         smallint NOT NULL,          -- year in which the FY ends
    period_type         period_type NOT NULL DEFAULT 'annual',
    basis               reporting_basis NOT NULL DEFAULT 'consolidated',

    period_start        date NOT NULL,
    period_end          date NOT NULL,
    months_covered      smallint NOT NULL DEFAULT 12,

    -- DSE quarterlies are frequently cumulative (Q3 report = 9 months).
    -- TTM and quarter-on-quarter maths must know which it is.
    is_cumulative       boolean NOT NULL DEFAULT false,

    audit_status        audit_status NOT NULL DEFAULT 'audited',

    -- Default provenance for every fact in this period; individual facts may
    -- override with their own document/page.
    source_document_id  bigint REFERENCES source_documents(id) ON DELETE SET NULL,
    source_page         text,

    is_complete         boolean NOT NULL DEFAULT false,   -- you have finished entering it
    notes               text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fiscal_periods_dates_ordered CHECK (period_end > period_start),
    CONSTRAINT fiscal_periods_unique
        UNIQUE (company_id, fiscal_year, period_type, basis)
);

CREATE INDEX fiscal_periods_company_year_idx ON fiscal_periods (company_id, fiscal_year DESC);
CREATE INDEX fiscal_periods_end_idx          ON fiscal_periods (period_end DESC);

CREATE TRIGGER fiscal_periods_set_updated_at
    BEFORE UPDATE ON fiscal_periods
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- line_item_defs
--
-- The taxonomy. Add a row here to track a new line; no schema change needed.
-- -----------------------------------------------------------------------------

CREATE TABLE line_item_defs (
    id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tag            text NOT NULL UNIQUE,            -- stable machine name, e.g. 'net_profit'
    label          text NOT NULL,                   -- what you see in the UI
    statement      statement_kind NOT NULL,
    unit           unit_kind NOT NULL DEFAULT 'currency',

    -- Which company templates this line applies to. Empty = all.
    applies_to     statement_template[] NOT NULL DEFAULT '{}',

    display_order  smallint NOT NULL DEFAULT 0,
    is_subtotal    boolean NOT NULL DEFAULT false,  -- e.g. gross profit, total assets
    is_core        boolean NOT NULL DEFAULT false,  -- the minimum set worth entering first
    description    text,

    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX line_item_defs_statement_idx ON line_item_defs (statement, display_order);


-- -----------------------------------------------------------------------------
-- financial_facts
--
-- One reported number. Stored as printed, with its scale.
-- -----------------------------------------------------------------------------

CREATE TABLE financial_facts (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_id           bigint NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
    line_item_id        smallint NOT NULL REFERENCES line_item_defs(id),

    -- Exactly the figure printed in the report, in the scale it was printed in.
    value_reported      numeric(24,6) NOT NULL,
    scale               value_scale NOT NULL DEFAULT 'unit',

    -- Canonical value in base units (BDT for currency lines). Derived, never typed.
    value_base          numeric(30,6) GENERATED ALWAYS AS (
                            value_reported * (CASE scale
                                WHEN 'unit'     THEN 1::numeric
                                WHEN 'thousand' THEN 1000::numeric
                                WHEN 'lakh'     THEN 100000::numeric
                                WHEN 'million'  THEN 1000000::numeric
                                WHEN 'crore'    THEN 10000000::numeric
                                WHEN 'billion'  THEN 1000000000::numeric
                            END)
                        ) STORED,

    -- Restatement handling: corrections create a new revision, originals stay.
    revision            smallint NOT NULL DEFAULT 1,
    is_current          boolean NOT NULL DEFAULT true,
    restated_reason     text,

    -- Overrides the period-level provenance when the figure came from elsewhere
    -- (e.g. a prior-year comparative printed in a later report).
    source_document_id  bigint REFERENCES source_documents(id) ON DELETE SET NULL,
    source_page         text,

    verification        verification_status NOT NULL DEFAULT 'unverified',
    verified_at         timestamptz,
    note                text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT financial_facts_revision_unique
        UNIQUE (period_id, line_item_id, revision)
);

-- At most one current revision per (period, line item).
CREATE UNIQUE INDEX financial_facts_one_current_idx
    ON financial_facts (period_id, line_item_id)
    WHERE is_current;

CREATE INDEX financial_facts_line_item_idx ON financial_facts (line_item_id) WHERE is_current;
CREATE INDEX financial_facts_unverified_idx
    ON financial_facts (period_id)
    WHERE verification = 'unverified';

CREATE TRIGGER financial_facts_set_updated_at
    BEFORE UPDATE ON financial_facts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- corporate_actions
--
-- Bonus shares and rights issues change the share count, which makes historical
-- per-share figures incomparable unless adjusted. adjustment_factor is the
-- multiplier applied to all PRIOR per-share values and prices.
--
--   Stock dividend of X%        -> 1 / (1 + X/100)
--   Split old:new               -> old / new
--   Rights: N new at price P,   -> (M * Pcum + N * P) / ((M + N) * Pcum)
--     against M existing shares    where Pcum is the cum-rights market price
-- -----------------------------------------------------------------------------

CREATE TABLE corporate_actions (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    action_type         corporate_action_type NOT NULL,
    fiscal_year         smallint,           -- the FY the dividend relates to

    declaration_date    date,
    record_date         date,
    ex_date             date,               -- the date the adjustment applies from
    agm_date            date,
    payment_date        date,

    -- DSE quotes dividends as a percentage of face value.
    cash_dividend_pct   numeric(10,4),
    stock_dividend_pct  numeric(10,4),
    cash_per_share      numeric(18,6),      -- = face_value * cash_dividend_pct / 100

    -- Rights issues
    rights_new_shares   integer,
    rights_per_existing integer,
    rights_price        numeric(18,6),
    cum_rights_price    numeric(18,6),

    -- Splits
    split_from          integer,
    split_to            integer,

    -- Multiplier for prior per-share figures and prices. 1.0 = no adjustment
    -- (a pure cash dividend does not change the share count).
    adjustment_factor   numeric(18,12) NOT NULL DEFAULT 1,

    source_document_id  bigint REFERENCES source_documents(id) ON DELETE SET NULL,
    source_page         text,
    verification        verification_status NOT NULL DEFAULT 'unverified',
    notes               text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT corporate_actions_factor_positive CHECK (adjustment_factor > 0)
);

CREATE INDEX corporate_actions_company_idx ON corporate_actions (company_id, ex_date DESC);
CREATE INDEX corporate_actions_fy_idx      ON corporate_actions (company_id, fiscal_year DESC);

CREATE TRIGGER corporate_actions_set_updated_at
    BEFORE UPDATE ON corporate_actions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- share_history
--
-- Shares outstanding over time. Needed for market cap at any past date, which
-- the annual snapshot in financial_facts cannot give you.
-- -----------------------------------------------------------------------------

CREATE TABLE share_history (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id           bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    effective_date       date NOT NULL,
    shares_outstanding   numeric(24,2) NOT NULL CHECK (shares_outstanding > 0),
    corporate_action_id  bigint REFERENCES corporate_actions(id) ON DELETE SET NULL,
    source_document_id   bigint REFERENCES source_documents(id) ON DELETE SET NULL,
    note                 text,
    created_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT share_history_unique UNIQUE (company_id, effective_date)
);

CREATE INDEX share_history_company_idx ON share_history (company_id, effective_date DESC);


-- -----------------------------------------------------------------------------
-- daily_prices
--
-- Populated by the nightly EOD job. The only table that is not hand-entered.
-- -----------------------------------------------------------------------------

CREATE TABLE daily_prices (
    company_id      bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    trade_date      date NOT NULL,

    open_price      numeric(18,4),
    high_price      numeric(18,4),
    low_price       numeric(18,4),
    close_price     numeric(18,4) NOT NULL,
    ycp             numeric(18,4),            -- yesterday's closing price, as DSE reports it

    volume          bigint,
    value_bdt       numeric(24,2),
    trade_count     integer,

    source          text NOT NULL DEFAULT 'manual',
    fetched_at      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (company_id, trade_date)
);

CREATE INDEX daily_prices_date_idx ON daily_prices (trade_date DESC);


-- -----------------------------------------------------------------------------
-- metric_defs / metric_values
--
-- The derived layer. Recomputable, versioned, and entirely separate from
-- reported facts. Change a formula, bump calc_version, recompute — the raw
-- annual report numbers are never touched.
-- -----------------------------------------------------------------------------

CREATE TABLE metric_defs (
    id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,        -- e.g. 'roce', 'eps_cagr_5y'
    label          text NOT NULL,
    unit           unit_kind NOT NULL DEFAULT 'ratio',
    formula_note   text NOT NULL,               -- the exact definition in words
    calc_version   smallint NOT NULL DEFAULT 1, -- bump when the formula changes
    display_order  smallint NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN metric_defs.formula_note IS
    'Write the definition down. ROCE and FCF are defined differently by different sources; three years from now you will not remember which one you used.';

CREATE TABLE metric_values (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id    bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    period_id     bigint REFERENCES fiscal_periods(id) ON DELETE CASCADE,
    metric_id     smallint NOT NULL REFERENCES metric_defs(id) ON DELETE CASCADE,

    value         numeric(24,8),
    calc_version  smallint NOT NULL DEFAULT 1,
    computed_at   timestamptz NOT NULL DEFAULT now(),
    inputs_note   text,       -- which facts fed it, for debugging a surprising number

    CONSTRAINT metric_values_unique UNIQUE (company_id, period_id, metric_id)
);

CREATE INDEX metric_values_company_idx ON metric_values (company_id, metric_id);


-- -----------------------------------------------------------------------------
-- research_notes
--
-- The layer no paid site gives you: why you would buy, and what you thought
-- at the time.
-- -----------------------------------------------------------------------------

CREATE TABLE research_notes (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id       bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    note_type        note_type NOT NULL DEFAULT 'thesis',
    title            text NOT NULL,
    body             text,                   -- markdown

    fair_value       numeric(18,4),
    entry_price      numeric(18,4),
    target_horizon   text,
    conviction       smallint CHECK (conviction BETWEEN 1 AND 5),

    -- Price when you wrote it, so you can judge the call honestly later.
    price_at_writing numeric(18,4),
    reviewed_at      date,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_notes_company_idx ON research_notes (company_id, created_at DESC);

CREATE TRIGGER research_notes_set_updated_at
    BEFORE UPDATE ON research_notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- job_runs
--
-- Audit trail for the nightly price fetch and the backup job, so a silent
-- failure does not go unnoticed for three months.
-- -----------------------------------------------------------------------------

CREATE TABLE job_runs (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_name       text NOT NULL,
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    succeeded      boolean,
    rows_affected  integer,
    message        text
);

CREATE INDEX job_runs_name_idx ON job_runs (job_name, started_at DESC);
