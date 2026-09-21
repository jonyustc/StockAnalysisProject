--
-- PostgreSQL database dump
--

\restrict 5VZiBeH5r0Y9b1UqINt0N7BMbo1k36ARace8p8xePWLaziGh3Iggfhaurfw0en2

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: audit_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_status AS ENUM (
    'audited',
    'unaudited',
    'provisional',
    'restated'
);


--
-- Name: corporate_action_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.corporate_action_type AS ENUM (
    'cash_dividend',
    'stock_dividend',
    'rights_issue',
    'split',
    'reverse_split',
    'other'
);


--
-- Name: document_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_type AS ENUM (
    'annual_report',
    'quarterly_report',
    'dse_disclosure',
    'cse_disclosure',
    'price_sensitive_info',
    'press_release',
    'company_website',
    'other'
);


--
-- Name: note_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.note_type AS ENUM (
    'thesis',
    'risk',
    'catalyst',
    'management',
    'industry',
    'valuation',
    'review',
    'other'
);


--
-- Name: period_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.period_type AS ENUM (
    'annual',
    'q1',
    'q2',
    'q3',
    'q4',
    'h1',
    'nine_month',
    'ttm'
);


--
-- Name: reporting_basis; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reporting_basis AS ENUM (
    'consolidated',
    'standalone'
);


--
-- Name: statement_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.statement_kind AS ENUM (
    'income',
    'balance',
    'cashflow',
    'per_share',
    'other'
);


--
-- Name: statement_template; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.statement_template AS ENUM (
    'general',
    'bank',
    'nbfi',
    'insurance',
    'mutual_fund'
);


--
-- Name: unit_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.unit_kind AS ENUM (
    'currency',
    'per_share',
    'ratio',
    'percent',
    'count',
    'days'
);


--
-- Name: value_scale; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.value_scale AS ENUM (
    'unit',
    'thousand',
    'lakh',
    'million',
    'crore',
    'billion'
);


--
-- Name: verification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_status AS ENUM (
    'unverified',
    'verified',
    'disputed'
);


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id bigint NOT NULL,
    dse_symbol text NOT NULL,
    alt_symbols text[] DEFAULT '{}'::text[] NOT NULL,
    name text NOT NULL,
    short_name text,
    sector_id smallint,
    statement_template public.statement_template DEFAULT 'general'::public.statement_template NOT NULL,
    fiscal_year_end_month smallint NOT NULL,
    fiscal_year_end_day smallint NOT NULL,
    reporting_currency character(3) DEFAULT 'BDT'::bpchar NOT NULL,
    face_value numeric(12,4) DEFAULT 10 NOT NULL,
    isin text,
    listing_date date,
    is_tracked boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    website text,
    investor_relations_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT companies_fiscal_year_end_day_check CHECK (((fiscal_year_end_day >= 1) AND (fiscal_year_end_day <= 31))),
    CONSTRAINT companies_fiscal_year_end_month_check CHECK (((fiscal_year_end_month >= 1) AND (fiscal_year_end_month <= 12)))
);


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.companies ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.companies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: corporate_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_actions (
    id bigint NOT NULL,
    company_id bigint NOT NULL,
    action_type public.corporate_action_type NOT NULL,
    fiscal_year smallint,
    declaration_date date,
    record_date date,
    ex_date date,
    agm_date date,
    payment_date date,
    cash_dividend_pct numeric(10,4),
    stock_dividend_pct numeric(10,4),
    cash_per_share numeric(18,6),
    rights_new_shares integer,
    rights_per_existing integer,
    rights_price numeric(18,6),
    cum_rights_price numeric(18,6),
    split_from integer,
    split_to integer,
    adjustment_factor numeric(18,12) DEFAULT 1 NOT NULL,
    source_document_id bigint,
    source_page text,
    verification public.verification_status DEFAULT 'unverified'::public.verification_status NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT corporate_actions_factor_positive CHECK ((adjustment_factor > (0)::numeric))
);


--
-- Name: corporate_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.corporate_actions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.corporate_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: daily_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_prices (
    company_id bigint NOT NULL,
    trade_date date NOT NULL,
    open_price numeric(18,4),
    high_price numeric(18,4),
    low_price numeric(18,4),
    close_price numeric(18,4) NOT NULL,
    ycp numeric(18,4),
    volume bigint,
    value_bdt numeric(24,2),
    trade_count integer,
    source text DEFAULT 'manual'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    yearly_high numeric(18,4),
    yearly_low numeric(18,4)
);


--
-- Name: COLUMN daily_prices.yearly_high; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.daily_prices.yearly_high IS '52-week high as reported by the source on trade_date, not computed from this table.';


--
-- Name: financial_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_facts (
    id bigint NOT NULL,
    period_id bigint NOT NULL,
    line_item_id smallint NOT NULL,
    value_reported numeric(24,6) NOT NULL,
    scale public.value_scale DEFAULT 'unit'::public.value_scale NOT NULL,
    value_base numeric(30,6) GENERATED ALWAYS AS ((value_reported *
CASE scale
    WHEN 'unit'::public.value_scale THEN (1)::numeric
    WHEN 'thousand'::public.value_scale THEN (1000)::numeric
    WHEN 'lakh'::public.value_scale THEN (100000)::numeric
    WHEN 'million'::public.value_scale THEN (1000000)::numeric
    WHEN 'crore'::public.value_scale THEN (10000000)::numeric
    WHEN 'billion'::public.value_scale THEN (1000000000)::numeric
    ELSE NULL::numeric
END)) STORED,
    revision smallint DEFAULT 1 NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    restated_reason text,
    source_document_id bigint,
    source_page text,
    verification public.verification_status DEFAULT 'unverified'::public.verification_status NOT NULL,
    verified_at timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: financial_facts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.financial_facts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.financial_facts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fiscal_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_periods (
    id bigint NOT NULL,
    company_id bigint NOT NULL,
    fiscal_year smallint NOT NULL,
    period_type public.period_type DEFAULT 'annual'::public.period_type NOT NULL,
    basis public.reporting_basis DEFAULT 'consolidated'::public.reporting_basis NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    months_covered smallint DEFAULT 12 NOT NULL,
    is_cumulative boolean DEFAULT false NOT NULL,
    audit_status public.audit_status DEFAULT 'audited'::public.audit_status NOT NULL,
    source_document_id bigint,
    source_page text,
    is_complete boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fiscal_periods_dates_ordered CHECK ((period_end > period_start))
);


--
-- Name: fiscal_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fiscal_periods ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fiscal_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id bigint NOT NULL,
    job_name text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    succeeded boolean,
    rows_affected integer,
    message text
);


--
-- Name: job_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.job_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.job_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: line_item_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_item_defs (
    id smallint NOT NULL,
    tag text NOT NULL,
    label text NOT NULL,
    statement public.statement_kind NOT NULL,
    unit public.unit_kind DEFAULT 'currency'::public.unit_kind NOT NULL,
    applies_to public.statement_template[] DEFAULT '{}'::public.statement_template[] NOT NULL,
    display_order smallint DEFAULT 0 NOT NULL,
    is_subtotal boolean DEFAULT false NOT NULL,
    is_core boolean DEFAULT false NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: line_item_defs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.line_item_defs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.line_item_defs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: metric_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_defs (
    id smallint NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    unit public.unit_kind DEFAULT 'ratio'::public.unit_kind NOT NULL,
    formula_note text NOT NULL,
    calc_version smallint DEFAULT 1 NOT NULL,
    display_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN metric_defs.formula_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metric_defs.formula_note IS 'Write the definition down. ROCE and FCF are defined differently by different sources; three years from now you will not remember which one you used.';


--
-- Name: metric_defs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.metric_defs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.metric_defs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: metric_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_values (
    id bigint NOT NULL,
    company_id bigint NOT NULL,
    period_id bigint,
    metric_id smallint NOT NULL,
    value numeric(24,8),
    calc_version smallint DEFAULT 1 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    inputs_note text
);


--
-- Name: metric_values_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.metric_values ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.metric_values_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: research_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_notes (
    id bigint NOT NULL,
    company_id bigint NOT NULL,
    note_type public.note_type DEFAULT 'thesis'::public.note_type NOT NULL,
    title text NOT NULL,
    body text,
    fair_value numeric(18,4),
    entry_price numeric(18,4),
    target_horizon text,
    conviction smallint,
    price_at_writing numeric(18,4),
    reviewed_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_notes_conviction_check CHECK (((conviction >= 1) AND (conviction <= 5)))
);


--
-- Name: research_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.research_notes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.research_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sectors (
    id smallint NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE sectors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sectors IS 'DSE sector classification.';


--
-- Name: sectors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sectors ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sectors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: share_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_history (
    id bigint NOT NULL,
    company_id bigint NOT NULL,
    effective_date date NOT NULL,
    shares_outstanding numeric(24,2) NOT NULL,
    corporate_action_id bigint,
    source_document_id bigint,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT share_history_shares_outstanding_check CHECK ((shares_outstanding > (0)::numeric))
);


--
-- Name: share_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.share_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.share_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: source_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_documents (
    id bigint NOT NULL,
    company_id bigint,
    doc_type public.document_type NOT NULL,
    title text NOT NULL,
    fiscal_year smallint,
    published_date date,
    onedrive_path text,
    source_url text,
    file_sha256 text,
    page_count smallint,
    accessed_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN source_documents.onedrive_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.source_documents.onedrive_path IS 'Where the file actually is. Leave null until it is filed — never invent a path, because a path that points at nothing reads as provenance.';


--
-- Name: source_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.source_documents ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.source_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Data for Name: _migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._migrations (name, checksum, applied_at) FROM stdin;
0001_init.sql	3bb3c20ed001f651d5eff2e8e9160396eb897e95d4d28b9b52db8738448f1432	2026-09-20 10:04:10.938502+00
0002_verify_company_reference.sql	19b11e1c50e1de8697921c006c9c771f5ef2424bc56d2d052ce4af3fcd4954c7	2026-09-20 10:10:24.468331+00
0003_line_items_and_formula_fixes.sql	1edbde57c0e8fe893895624dedb21325f7af13c140f48312c6e71cc483852c97	2026-09-20 10:38:31.321276+00
0004_price_yearly_range.sql	57e54488902cc4aa3b3c148ddba771643f30065e818dfa3228b00f704ca47a17	2026-09-20 12:05:18.13055+00
0005_source_document_hygiene.sql	ce691771fd0c2f4528a576d384a9a8f0585a8106ff1a51e8eb16639aa9f93857	2026-09-21 05:40:09.551623+00
0006_corporate_actions_and_disputed_facts.sql	d9ed4e889e150e48786e0805ed18d358bbaf47fe09cb931f0c4a64b32d9be99d	2026-09-21 05:55:17.28508+00
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.companies (id, dse_symbol, alt_symbols, name, short_name, sector_id, statement_template, fiscal_year_end_month, fiscal_year_end_day, reporting_currency, face_value, isin, listing_date, is_tracked, is_active, website, investor_relations_url, notes, created_at, updated_at) FROM stdin;
7	LHB	{LHBL}	LafargeHolcim Bangladesh PLC	LafargeHolcim	2	general	12	31	BDT	10.0000	\N	\N	t	t	\N	\N	FYE 31 December (Jan-Dec), confirmed. DSE trading code is LHB; LHBL returns no company on dsebd.org.	2026-09-20 10:04:11.339805+00	2026-09-20 10:10:24.468331+00
1	SQURPHARMA	{SQUARE}	Square Pharmaceuticals PLC	Square Pharma	15	general	6	30	BDT	10.0000	\N	\N	t	t	\N	https://www.squarepharma.com.bd/annual-reports.php	FYE 30 June (Jul-Jun), confirmed against published financial statements.	2026-09-20 10:04:11.339805+00	2026-09-20 10:10:24.468331+00
4	RENATA	{}	Renata PLC	Renata	15	general	6	30	BDT	10.0000	\N	\N	t	t	\N	\N	FYE 30 June (Jul-Jun), confirmed against published financial statements.	2026-09-20 10:04:11.339805+00	2026-09-20 10:10:24.468331+00
5	OLYMPIC	{}	Olympic Industries PLC	Olympic	6	general	6	30	BDT	10.0000	\N	\N	t	t	\N	\N	FYE 30 June (Jul-Jun), confirmed against published financial statements.	2026-09-20 10:04:11.339805+00	2026-09-20 10:10:24.468331+00
6	BSRMSTEEL	{BSRM}	BSRM Steels Limited	BSRM Steels	4	general	6	30	BDT	10.0000	\N	\N	t	t	\N	\N	FYE 30 June (Jul-Jun), confirmed against published financial statements.	2026-09-20 10:04:11.339805+00	2026-09-20 10:10:24.468331+00
2	MARICO	{}	Marico Bangladesh Limited	Marico	15	general	3	31	BDT	10.0000	\N	\N	t	t	\N	https://marico.com/bangladesh/investors	FYE 31 March (Apr-Mar), confirmed against published financial statements.	2026-09-20 10:04:11.339805+00	2026-09-20 10:10:24.468331+00
3	BERGERPBL	{BERGER}	Berger Paints Bangladesh Limited	Berger	12	general	3	31	BDT	10.0000	\N	\N	t	t	\N	\N	FYE 31 March (Apr-Mar), confirmed. 1-for-17 rights issue in FY2026 (see corporate_actions); per-share figures before FY2026 need that adjustment to be comparable.	2026-09-20 10:04:11.339805+00	2026-09-21 05:55:17.28508+00
14	BSRMLTD	{}	Bangladesh Steel Re-Rolling Mills Limited	BSRM Ltd	4	general	6	30	BDT	10.0000	\N	\N	t	t	\N	\N	FYE 30 June (Jul-Jun), confirmed. Separate listing from BSRMSTEEL; both are tracked. Share count unchanged at 298,584,626 since the 2018 bonus issue, so the FY2021 EPS/net profit mismatch is a source data error, not a corporate action — those two facts are marked disputed.	2026-09-20 10:10:24.702186+00	2026-09-21 05:55:17.28508+00
\.


--
-- Data for Name: corporate_actions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.corporate_actions (id, company_id, action_type, fiscal_year, declaration_date, record_date, ex_date, agm_date, payment_date, cash_dividend_pct, stock_dividend_pct, cash_per_share, rights_new_shares, rights_per_existing, rights_price, cum_rights_price, split_from, split_to, adjustment_factor, source_document_id, source_page, verification, notes, created_at, updated_at) FROM stdin;
2	3	rights_issue	2026	\N	\N	2025-04-01	\N	\N	\N	\N	\N	1	17	\N	\N	\N	\N	0.944444444444	\N	\N	unverified	Confirmed from dsebd.org ("Right Issue: 1R:17, 2025") and reconciled against outstanding shares of 49,105,991. EX-DATE IS A LOWER BOUND, not the confirmed date: it is set to the FY2026 period start because the FY2025 balance sheet still shows the pre-issue count. Annual per-share adjustment is unaffected by the exact date within the year; replace it with the real ex-date before using quarterly or daily data. Factor is share-count-only (17/18) because no rights price is recorded; a theoretical-ex-rights factor would be slightly higher.	2026-09-21 05:55:17.28508+00	2026-09-21 05:55:17.28508+00
\.


--
-- Data for Name: daily_prices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.daily_prices (company_id, trade_date, open_price, high_price, low_price, close_price, ycp, volume, value_bdt, trade_count, source, fetched_at, yearly_high, yearly_low) FROM stdin;
3	2026-09-20	1495.2000	1495.2000	1456.1000	1472.8000	1460.2000	1378	2029000.00	180	stocknow.com.bd	2026-09-20 12:05:22.214369+00	1524.0000	1335.9000
14	2026-09-20	97.8000	97.8000	95.6000	96.9000	96.2000	64980	6280000.00	416	stocknow.com.bd	2026-09-20 12:05:22.274966+00	115.0000	71.5000
6	2026-09-20	85.0000	87.8000	85.0000	87.5000	84.7000	195847	16928000.00	773	stocknow.com.bd	2026-09-20 12:05:22.334479+00	102.0000	55.0000
7	2026-09-20	52.8000	54.3000	52.6000	54.0000	52.5000	919566	49159000.00	1413	stocknow.com.bd	2026-09-20 12:05:22.393293+00	62.4000	45.0000
2	2026-09-20	2659.8000	2680.0000	2655.0000	2669.9000	2651.1000	1621	4321000.00	233	stocknow.com.bd	2026-09-20 12:05:22.452484+00	2946.5000	2610.0000
5	2026-09-20	146.7000	146.8000	144.9000	145.2000	145.2000	64176	9348000.00	448	stocknow.com.bd	2026-09-20 12:05:22.511911+00	170.5000	128.0000
4	2026-09-20	452.7000	454.2000	448.0000	453.2000	452.6000	28488	12853000.00	546	stocknow.com.bd	2026-09-20 12:05:22.571278+00	493.9000	372.0000
1	2026-09-20	214.1000	216.4000	213.9000	215.9000	213.8000	253716	54661000.00	1228	stocknow.com.bd	2026-09-20 12:05:22.633371+00	236.0000	198.0000
\.


--
-- Data for Name: financial_facts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.financial_facts (id, period_id, line_item_id, value_reported, scale, revision, is_current, restated_reason, source_document_id, source_page, verification, verified_at, note, created_at, updated_at) FROM stdin;
37	4	35	12875.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
38	4	36	-6183.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
39	4	37	-3970.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
40	4	40	-3754.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
41	4	38	-5302.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
42	4	42	20.480000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
43	4	45	118.680000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
44	4	99	10.000000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
45	5	1	60708.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
46	5	3	28235.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
47	5	6	16690.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
48	5	12	18980.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
49	5	20	50094.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
50	5	21	70487.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
51	5	14	26059.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
52	5	22	121816.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
53	5	30	4229.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
54	5	100	1987.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
55	5	31	6620.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
56	5	25	115197.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
57	5	35	8546.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
58	5	36	-2861.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
59	5	37	787.690000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
60	5	40	-8762.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
61	5	38	-8803.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
62	5	42	21.410000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
63	5	45	129.950000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
64	5	99	10.500000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
65	6	1	70101.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
66	6	3	32553.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
67	6	6	17974.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
68	6	12	20926.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
69	6	20	52013.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
70	6	21	71206.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
71	6	14	27750.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
72	6	22	132637.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
73	6	30	5282.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
74	6	100	1429.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
75	6	31	6716.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
76	6	25	125922.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
77	6	35	18529.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
78	6	36	-4181.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
79	6	37	-7049.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
80	6	40	-9833.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
81	6	38	-9275.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
82	6	42	23.610000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
83	6	45	142.050000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
84	6	99	11.000000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
85	7	1	76288.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
86	7	3	35911.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
87	7	6	19393.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
88	7	12	23968.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
89	7	20	55396.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
90	7	21	74562.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
91	7	14	31687.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
92	7	22	146815.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
93	7	30	5823.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
94	7	100	825.500000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
95	7	31	6860.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
96	7	25	139956.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
97	7	35	17302.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
98	7	36	-6177.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
99	7	37	-3897.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
100	7	40	-10313.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
101	7	38	-9709.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
102	7	42	27.040000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
103	7	45	157.880000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
104	7	99	12.000000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
205	13	1	13032.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
206	13	3	7051.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
207	13	6	4405.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
208	13	12	3554.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
5	3	1	50703.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
6	3	3	25233.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
7	3	6	15269.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
8	3	12	15947.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
9	3	20	43364.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
10	3	21	55076.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
11	3	14	22884.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
12	3	22	95452.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
13	3	30	3179.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
14	3	100	103.710000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
15	3	31	4557.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
16	3	25	90895.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
17	3	35	10976.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
18	3	36	-3798.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
19	3	37	3607.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
20	3	40	-3819.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
21	3	38	-3923.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
22	3	42	17.990000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
23	3	45	102.540000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
24	3	99	6.000000	unit	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
25	4	1	57598.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
26	4	3	28879.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
27	4	6	16860.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
28	4	12	18157.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
29	4	20	48962.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
30	4	21	62348.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
31	4	14	27183.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
32	4	22	111758.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
33	4	30	3662.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
34	4	100	1914.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
35	4	31	6555.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
36	4	25	105203.000000	million	1	t	\N	2	\N	unverified	\N	\N	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
683	38	12	4970.000000	million	1	t	\N	8	\N	disputed	\N	FY2021 EPS and net profit are mutually inconsistent at the source: 4,970mn over the 298.58mn shares DSE reports gives EPS 16.64, not 18.96, and 18.96 would imply profit above that year's operating profit. DSE shows no bonus or rights issue since 2018, so this is not a share-count change. Check the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:55:17.28508+00
696	38	42	18.960000	unit	1	t	\N	8	\N	disputed	\N	FY2021 EPS and net profit are mutually inconsistent at the source: 4,970mn over the 298.58mn shares DSE reports gives EPS 16.64, not 18.96, and 18.96 would imply profit above that year's operating profit. DSE shows no bonus or rights issue since 2018, so this is not a share-count change. Check the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:55:17.28508+00
209	13	20	505.190000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
210	13	21	5673.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
211	13	22	7048.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
212	13	30	4236.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
213	13	100	128.120000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
214	13	31	4359.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
215	13	25	2689.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
216	13	35	3605.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
217	13	36	-313.760000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
218	13	37	-499.120000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
219	13	40	-2997.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
220	13	38	-2520.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
221	13	42	112.820000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
222	13	45	85.370000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
223	13	99	80.000000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
224	14	1	14136.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
225	14	3	7305.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
226	14	6	4872.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
227	14	12	3872.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
228	14	20	2229.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
229	14	21	9970.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
230	14	22	11636.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
231	14	30	7977.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
232	14	100	103.710000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
233	14	31	8050.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
234	14	25	3586.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
235	14	35	5394.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
236	14	36	-517.620000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
237	14	37	-2641.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
238	14	40	-1029.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
239	14	38	-963.570000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
240	14	42	122.930000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
241	14	45	113.850000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
242	14	99	75.000000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
243	15	1	14524.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
244	15	3	8406.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
245	15	6	5831.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
246	15	12	4606.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
247	15	20	1887.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
248	15	21	15014.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
249	15	22	16907.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
250	15	30	8521.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
251	15	100	640.740000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
252	15	31	8697.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
253	15	25	8210.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
254	15	35	6150.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
255	15	36	-243.710000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
256	15	37	-4840.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
257	15	40	-1651.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
258	15	38	-2029.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
259	15	42	146.230000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
260	15	45	260.640000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
261	15	99	20.000000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
262	16	1	16309.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
263	16	3	9714.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
264	16	6	6703.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
265	16	12	5906.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
266	16	20	3092.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
267	16	21	12143.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
268	16	22	13840.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
269	16	30	6104.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
270	16	100	174.820000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
271	16	31	6308.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
272	16	25	7533.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
273	16	35	4606.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
274	16	36	-168.530000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
275	16	37	3698.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
276	16	40	-7100.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
277	16	38	-6584.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
278	16	42	187.490000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
279	16	45	239.130000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
280	16	99	384.000000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
281	17	1	20712.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
282	17	3	10212.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
283	17	6	7254.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
284	17	12	6492.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
285	17	20	1575.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
286	17	21	6631.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
287	17	22	8349.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
288	17	30	5302.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
289	17	100	149.250000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
290	17	31	5451.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
291	17	25	2899.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
292	17	35	5586.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
293	17	36	-229.920000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
294	17	37	4095.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
295	17	40	-11198.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
296	17	38	-11104.000000	million	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
297	17	42	206.090000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
298	17	45	92.020000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
299	17	99	207.500000	unit	1	t	\N	3	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
300	18	1	22195.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
301	18	3	7688.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
302	18	6	3884.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
303	18	12	2907.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
304	18	20	2442.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
305	18	21	9401.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
306	18	22	16947.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
307	18	30	5619.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
308	18	100	567.020000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
309	18	31	6401.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
310	18	25	10546.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
311	18	35	2936.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
312	18	36	-1291.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
313	18	37	-1400.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
314	18	40	-3222.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
315	18	38	-3136.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
316	18	42	62.680000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
317	18	45	227.390000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
318	18	99	40.000000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
319	19	1	25899.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
320	19	3	7582.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
321	19	6	3898.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
322	19	12	3010.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
323	19	20	3877.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
324	19	21	11721.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
325	19	22	20001.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
326	19	30	6287.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
327	19	100	579.490000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
328	19	31	7025.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
329	19	25	12976.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
330	19	35	3446.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
331	19	36	-1398.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
332	19	37	-1480.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
333	19	40	-549.660000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
334	19	38	-465.140000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
335	19	42	64.910000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
336	19	45	279.780000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
337	19	99	40.000000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
338	20	1	26251.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
339	20	3	8384.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
340	20	6	4317.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
341	20	12	3243.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
342	20	20	7665.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
343	20	21	16258.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
344	20	22	25103.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
345	20	30	9677.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
346	20	100	994.610000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
347	20	31	10748.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
348	20	25	14355.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
349	20	35	6476.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
350	20	36	-1153.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
351	20	37	-1093.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
352	20	40	-1666.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
353	20	38	-1857.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
354	20	42	69.920000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
355	20	45	309.530000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
356	20	99	50.000000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
357	21	1	28525.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
358	21	3	8950.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
359	21	6	4440.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
360	21	12	3370.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
361	21	20	5943.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
362	21	21	13996.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
363	21	22	23844.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
364	21	30	7247.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
365	21	100	1086.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
366	21	31	8380.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
367	21	25	15463.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
368	21	35	2734.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
369	21	36	-1855.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
370	21	37	-1748.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
371	21	40	-2725.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
372	21	38	-2320.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
373	21	42	71.200000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
374	21	45	333.420000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
375	21	99	52.500000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
376	22	1	29270.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
377	22	3	9374.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
378	22	6	4576.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
379	22	12	3720.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
380	22	20	6480.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
381	22	21	14244.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
382	22	22	28092.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
383	22	30	7592.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
384	22	100	1681.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
385	22	31	8438.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
386	22	25	19654.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
387	22	35	4335.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
388	22	36	-4828.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
389	22	37	-3730.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
390	22	40	-76.980000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
391	22	38	-2434.000000	million	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
392	22	42	76.830000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
393	22	45	400.240000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
394	22	99	52.500000	unit	1	t	\N	4	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
395	23	1	29971.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
396	23	3	14184.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
397	23	6	6525.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
398	23	12	5062.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
399	23	20	1406.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
400	23	21	17194.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
401	23	22	34773.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
402	23	30	7693.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
403	23	100	4802.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
404	23	31	9062.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
405	23	25	25711.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
406	23	35	4320.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
407	23	36	-4423.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
408	23	37	-4998.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
409	23	40	666.550000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
410	23	38	-1141.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
411	23	42	44.130000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
412	23	45	224.170000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
413	23	99	12.319000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
414	24	1	31071.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
415	24	3	14541.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
416	24	6	6221.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
417	24	12	5111.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
418	24	20	778.570000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
419	24	21	15505.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
420	24	22	42015.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
421	24	30	11189.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
422	24	100	8896.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
423	24	31	12603.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
424	24	25	29412.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
425	24	35	3009.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
426	24	36	-10099.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
427	24	37	-6080.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
428	24	40	2419.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
429	24	38	-1430.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
430	24	42	44.560000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
431	24	45	256.430000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
432	24	99	13.084000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
433	25	1	32971.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
434	25	3	13670.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
435	25	6	3094.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
436	25	12	2339.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
437	25	20	2601.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
438	25	21	17039.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
439	25	22	48827.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
440	25	30	13243.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
441	25	100	14281.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
442	25	31	18218.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
443	25	25	30609.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
444	25	35	2085.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
445	25	36	-5770.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
446	25	37	-4619.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
447	25	40	3887.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
448	25	38	-1498.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
449	25	42	20.400000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
450	25	45	266.870000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
451	25	99	6.250000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
452	26	1	37709.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
453	26	3	16678.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
454	26	6	5100.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
455	26	12	3616.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
456	26	20	976.060000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
457	26	21	19593.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
458	26	22	56474.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
459	26	30	13580.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
460	26	100	17236.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
461	26	31	22574.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
462	26	25	33900.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
463	26	35	2083.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
464	26	36	-5616.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
465	26	37	-5923.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
466	26	40	2257.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
467	26	38	-720.520000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
468	26	42	31.530000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
469	26	45	295.560000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
470	26	99	9.200000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
471	27	1	42892.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
472	27	3	17572.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
473	27	6	4078.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
474	27	12	2221.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
475	27	20	1827.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
476	27	21	19325.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
477	27	22	59021.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
478	27	30	12306.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
479	27	100	18897.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
480	27	31	23983.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
481	27	25	35038.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
482	27	35	4721.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
483	27	36	-4284.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
484	27	37	-4486.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
485	27	40	546.540000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
486	27	38	-1059.000000	million	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
487	27	42	19.360000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
488	27	45	305.490000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
489	27	99	5.500000	unit	1	t	\N	5	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
490	28	1	18033.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
491	28	3	5267.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
492	28	6	2417.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
493	28	12	2037.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
494	28	20	768.930000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
495	28	21	9527.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
496	28	22	14415.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
497	28	30	4648.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
498	28	100	1987.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
499	28	31	5175.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
500	28	25	9239.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
501	28	35	1868.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
502	28	36	-1276.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
503	28	37	-1046.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
504	28	40	-728.850000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
505	28	38	-983.390000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
506	28	42	10.190000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
507	28	45	46.210000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
508	28	99	5.400000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
509	29	1	21439.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
510	29	3	4903.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
511	29	6	1473.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
512	29	12	1205.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
513	29	20	594.500000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
514	29	21	9113.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
515	29	22	14427.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
516	29	30	4616.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
517	29	100	2707.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
518	29	31	5062.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
519	29	25	9365.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
520	29	35	701.060000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
521	29	36	-1317.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
522	29	37	-514.240000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
523	29	40	-1089.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
524	29	38	-1194.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
525	29	42	6.030000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
526	29	45	46.840000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
527	29	99	4.500000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
528	30	1	25785.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
529	30	3	6107.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
530	30	6	2097.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
531	30	12	1556.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
532	30	20	849.430000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
533	30	21	8249.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
534	30	22	14080.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
535	30	30	3609.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
536	30	100	2163.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
537	30	31	4059.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
538	30	25	10021.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
539	30	35	1389.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
540	30	36	-964.120000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
541	30	37	406.640000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
542	30	40	-1002.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
543	30	38	-935.110000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
544	30	42	7.780000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
545	30	45	50.120000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
546	30	99	6.000000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
547	31	1	25929.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
548	31	3	6154.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
549	31	6	2189.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
550	31	12	1834.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
551	31	20	889.520000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
552	31	21	7870.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
553	31	22	14021.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
554	31	30	3325.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
555	31	100	555.930000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
556	31	31	3366.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
557	31	25	10656.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
558	31	35	3752.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
559	31	36	-1300.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
560	31	37	-922.940000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
561	31	40	-2353.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
562	31	38	-1248.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
563	31	42	9.170000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
564	31	45	53.290000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
565	31	99	1.000000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
566	32	1	27721.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
567	32	3	6610.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
568	32	6	2176.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
569	32	12	2010.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
570	32	20	1593.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
571	32	21	9753.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
572	32	22	16178.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
573	32	30	3700.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
574	32	100	51.940000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
575	32	31	3712.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
576	32	25	12466.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
577	32	35	2290.000000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
578	32	36	-870.450000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
579	32	37	-720.480000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
580	32	40	-868.510000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
581	32	38	-251.680000	million	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
582	32	42	10.060000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
583	32	45	62.350000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
584	32	99	3.000000	unit	1	t	\N	6	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
585	33	1	54983.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
586	33	3	7226.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
587	33	6	5335.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
588	33	12	3047.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
589	33	20	16417.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
590	33	21	46711.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
591	33	22	72385.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
592	33	30	40141.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
593	33	100	41535.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
594	33	31	48933.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
595	33	25	23452.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
596	33	35	7846.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
597	33	36	-443.810000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
598	33	37	-1647.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
599	33	40	9273.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
600	33	38	-938.500000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
601	33	42	8.100000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
602	33	45	62.380000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
603	33	99	4.000000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
604	34	1	67121.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
605	34	3	7040.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
606	34	6	5181.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
607	34	12	3278.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
608	34	20	9074.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
609	34	21	55500.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
610	34	22	82021.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
611	34	30	48891.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
612	34	100	49433.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
613	34	31	56086.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
614	34	25	25935.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
615	34	35	3993.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
616	34	36	-2095.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
617	34	37	-2563.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
618	34	40	-8798.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
619	34	38	-1145.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
620	34	42	8.720000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
621	34	45	68.990000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
622	34	99	3.000000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
623	35	1	84525.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
624	35	3	8109.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
625	35	6	6257.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
626	35	12	2979.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
627	35	20	4443.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
628	35	21	41930.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
629	35	22	76899.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
630	35	30	42858.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
631	35	100	40759.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
632	35	31	49335.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
633	35	25	27565.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
634	35	35	10961.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
635	35	36	-9083.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
636	35	37	-7328.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
637	35	40	-8285.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
638	35	38	-1132.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
639	35	42	7.920000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
640	35	45	73.320000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
641	35	99	2.500000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
642	36	1	82706.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
643	36	3	9169.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
644	36	6	6477.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
645	36	12	3797.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
646	36	20	5380.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
647	36	21	55734.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
648	36	22	97169.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
649	36	30	56239.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
650	36	100	59687.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
651	36	31	66741.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
652	36	25	30428.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
653	36	35	6134.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
654	36	36	-11480.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
655	36	37	-11513.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
656	36	40	6320.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
657	36	38	-939.970000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
658	36	42	10.100000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
659	36	45	80.930000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
660	36	99	3.200000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
661	37	1	103665.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
662	37	3	11493.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
663	37	6	8633.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
664	37	12	5176.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
665	37	20	1917.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
666	37	21	43960.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
667	37	22	87824.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
668	37	30	29394.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
669	37	100	45488.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
670	37	31	53791.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
671	37	25	34033.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
672	37	35	7307.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
673	37	36	-16353.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
674	37	37	-818.810000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
675	37	40	-9951.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
676	37	38	-1201.000000	million	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
677	37	42	13.770000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
678	37	45	90.520000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
679	37	99	5.000000	unit	1	t	\N	7	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
680	38	1	59906.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
681	38	3	7100.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
682	38	6	5230.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
684	38	20	1598.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
685	38	21	32999.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
686	38	22	80533.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
687	38	30	37600.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
688	38	100	34670.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
689	38	31	42447.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
690	38	25	38086.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
691	38	35	8741.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
692	38	36	-1276.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
693	38	37	-1626.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
694	38	40	-5756.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
695	38	38	-585.350000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
697	38	45	127.560000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
698	38	99	5.000000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
699	39	1	79953.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
700	39	3	6490.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
701	39	6	4640.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
702	39	12	3088.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
703	39	20	5751.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
704	39	21	70918.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
705	39	22	118617.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
706	39	30	74031.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
707	39	100	70623.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
708	39	31	78522.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
709	39	25	40095.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
710	39	35	6714.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
711	39	36	-963.120000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
712	39	37	-2763.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
713	39	40	91.890000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
714	39	38	-1176.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
715	39	42	10.340000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
716	39	45	134.290000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
717	39	99	3.500000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
718	40	1	115062.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
719	40	3	10320.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
720	40	6	7970.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
721	40	12	2914.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
722	40	20	1874.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
723	40	21	57375.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
724	40	22	104042.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
725	40	30	57719.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
726	40	100	54014.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
727	40	31	62104.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
728	40	25	41938.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
729	40	35	3053.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
730	40	36	-573.420000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
731	40	37	2633.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
732	40	40	-9577.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
733	40	38	-1066.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
734	40	42	9.760000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
735	40	45	140.460000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
736	40	99	2.500000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
737	41	1	83525.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
738	41	3	9610.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
739	41	6	6427.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
740	41	12	4323.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
741	41	20	1212.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
742	41	21	52381.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
743	41	22	99575.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
744	41	30	49444.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
745	41	100	45375.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
746	41	31	54770.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
747	41	25	44804.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
748	41	35	4019.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
749	41	36	-1185.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
750	41	37	-12.760000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
751	41	40	-4674.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
752	41	38	-746.340000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
753	41	42	14.480000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
754	41	45	150.060000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
755	41	99	3.500000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
756	42	1	96638.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
757	42	3	11414.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
758	42	6	8689.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
759	42	12	6142.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
760	42	20	2117.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
761	42	21	45679.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
762	42	22	93743.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
763	42	30	37170.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
764	42	100	32813.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
765	42	31	43942.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
766	42	25	49801.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
767	42	35	13080.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
768	42	36	-1413.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
769	42	37	-558.640000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
770	42	40	-11617.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
771	42	38	-1054.000000	million	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
772	42	42	20.570000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
773	42	45	166.790000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
774	42	99	5.000000	unit	1	t	\N	8	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
775	43	1	20534.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
776	43	3	6640.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
777	43	6	4818.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
778	43	12	3882.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
779	43	20	5277.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
780	43	21	10710.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
781	43	22	29622.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
782	43	30	7153.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
783	43	100	60.330000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
784	43	31	9828.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
785	43	25	19794.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
786	43	35	6077.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
787	43	36	-945.770000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
788	43	37	-910.860000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
789	43	40	-1246.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
790	43	38	-1202.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
791	43	42	3.340000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
792	43	45	17.040000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
793	43	99	2.500000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
794	44	1	23594.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
795	44	3	8334.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
796	44	6	5982.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
797	44	12	4445.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
798	44	20	4844.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
799	44	21	10450.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
800	44	22	28971.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
801	44	30	8917.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
802	44	100	38.100000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
803	44	31	11261.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
804	44	25	17710.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
805	44	35	6694.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
806	44	36	-701.440000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
807	44	37	-633.050000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
808	44	40	-6517.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
809	44	38	-6468.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
810	44	42	3.830000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
811	44	45	15.250000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
812	44	99	4.800000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
813	45	1	28388.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
814	45	3	10269.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
815	45	6	7756.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
816	45	12	5942.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
817	45	20	9346.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
818	45	21	18216.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
819	45	22	36274.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
820	45	30	11847.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
821	45	100	163.410000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
822	45	31	14048.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
823	45	25	22226.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
824	45	35	7926.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
825	45	36	-376.980000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
826	45	37	-221.980000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
827	45	40	-3215.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
828	45	38	-2003.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
829	45	42	5.120000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
830	45	45	19.140000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
831	45	99	5.000000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
832	46	1	27543.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
833	46	3	8245.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
834	46	6	5967.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
835	46	12	3819.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
836	46	20	9601.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
837	46	21	18488.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
838	46	22	36577.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
839	46	30	15855.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
840	46	100	386.820000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
841	46	31	17985.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
842	46	25	18592.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
843	46	35	7923.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
844	46	36	-1228.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
845	46	37	-1006.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
846	46	40	-6757.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
847	46	38	-7848.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
848	46	42	3.290000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
849	46	45	16.010000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
850	46	99	3.800000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
851	47	1	29314.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
852	47	3	8846.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
853	47	6	6551.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
854	47	12	5108.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
855	47	20	9518.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
856	47	21	21664.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
857	47	22	41377.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
858	47	30	20468.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
859	47	100	101.300000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
860	47	31	22313.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
861	47	25	19063.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
862	47	35	8492.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
863	47	36	-4091.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
864	47	37	-3874.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
865	47	40	-4667.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
866	47	38	-4443.000000	million	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
867	47	42	4.400000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
868	47	45	16.410000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
869	47	99	4.000000	unit	1	t	\N	9	\N	unverified	\N	\N	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
\.


--
-- Data for Name: fiscal_periods; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.fiscal_periods (id, company_id, fiscal_year, period_type, basis, period_start, period_end, months_covered, is_cumulative, audit_status, source_document_id, source_page, is_complete, notes, created_at, updated_at) FROM stdin;
3	1	2021	annual	consolidated	2020-07-01	2021-06-30	12	f	audited	2	\N	f	Secondary source; unverified against the annual report.	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
4	1	2022	annual	consolidated	2021-07-01	2022-06-30	12	f	audited	2	\N	f	Secondary source; unverified against the annual report.	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
5	1	2023	annual	consolidated	2022-07-01	2023-06-30	12	f	audited	2	\N	f	Secondary source; unverified against the annual report.	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
6	1	2024	annual	consolidated	2023-07-01	2024-06-30	12	f	audited	2	\N	f	Secondary source; unverified against the annual report.	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
7	1	2025	annual	consolidated	2024-07-01	2025-06-30	12	f	audited	2	\N	f	Secondary source; unverified against the annual report.	2026-09-20 10:38:35.514309+00	2026-09-21 05:40:14.468368+00
13	2	2022	annual	consolidated	2021-04-01	2022-03-31	12	f	audited	3	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
14	2	2023	annual	consolidated	2022-04-01	2023-03-31	12	f	audited	3	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
15	2	2024	annual	consolidated	2023-04-01	2024-03-31	12	f	audited	3	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
16	2	2025	annual	consolidated	2024-04-01	2025-03-31	12	f	audited	3	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
17	2	2026	annual	consolidated	2025-04-01	2026-03-31	12	f	audited	3	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
18	3	2022	annual	consolidated	2021-04-01	2022-03-31	12	f	audited	4	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
19	3	2023	annual	consolidated	2022-04-01	2023-03-31	12	f	audited	4	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
20	3	2024	annual	consolidated	2023-04-01	2024-03-31	12	f	audited	4	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
21	3	2025	annual	consolidated	2024-04-01	2025-03-31	12	f	audited	4	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
22	3	2026	annual	consolidated	2025-04-01	2026-03-31	12	f	audited	4	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
23	4	2021	annual	consolidated	2020-07-01	2021-06-30	12	f	audited	5	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
24	4	2022	annual	consolidated	2021-07-01	2022-06-30	12	f	audited	5	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
25	4	2023	annual	consolidated	2022-07-01	2023-06-30	12	f	audited	5	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
26	4	2024	annual	consolidated	2023-07-01	2024-06-30	12	f	audited	5	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
27	4	2025	annual	consolidated	2024-07-01	2025-06-30	12	f	audited	5	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
28	5	2021	annual	consolidated	2020-07-01	2021-06-30	12	f	audited	6	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
29	5	2022	annual	consolidated	2021-07-01	2022-06-30	12	f	audited	6	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
30	5	2023	annual	consolidated	2022-07-01	2023-06-30	12	f	audited	6	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
31	5	2024	annual	consolidated	2023-07-01	2024-06-30	12	f	audited	6	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
32	5	2025	annual	consolidated	2024-07-01	2025-06-30	12	f	audited	6	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
33	6	2021	annual	consolidated	2020-07-01	2021-06-30	12	f	audited	7	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
34	6	2022	annual	consolidated	2021-07-01	2022-06-30	12	f	audited	7	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
35	6	2023	annual	consolidated	2022-07-01	2023-06-30	12	f	audited	7	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
36	6	2024	annual	consolidated	2023-07-01	2024-06-30	12	f	audited	7	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
37	6	2025	annual	consolidated	2024-07-01	2025-06-30	12	f	audited	7	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
38	14	2021	annual	consolidated	2020-07-01	2021-06-30	12	f	audited	8	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
39	14	2022	annual	consolidated	2021-07-01	2022-06-30	12	f	audited	8	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
40	14	2023	annual	consolidated	2022-07-01	2023-06-30	12	f	audited	8	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
41	14	2024	annual	consolidated	2023-07-01	2024-06-30	12	f	audited	8	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
42	14	2025	annual	consolidated	2024-07-01	2025-06-30	12	f	audited	8	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
43	7	2021	annual	consolidated	2021-01-01	2021-12-31	12	f	audited	9	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
44	7	2022	annual	consolidated	2022-01-01	2022-12-31	12	f	audited	9	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
45	7	2023	annual	consolidated	2023-01-01	2023-12-31	12	f	audited	9	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
46	7	2024	annual	consolidated	2024-01-01	2024-12-31	12	f	audited	9	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
47	7	2025	annual	consolidated	2025-01-01	2025-12-31	12	f	audited	9	\N	f	Secondary source; unverified against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
\.


--
-- Data for Name: job_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.job_runs (id, job_name, started_at, finished_at, succeeded, rows_affected, message) FROM stdin;
1	prices	2026-09-20 12:05:21.860241+00	2026-09-20 12:05:22.692371+00	t	8	Wrote 8 quote(s) for 2026-09-20
\.


--
-- Data for Name: line_item_defs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.line_item_defs (id, tag, label, statement, unit, applies_to, display_order, is_subtotal, is_core, description, created_at) FROM stdin;
1	revenue	Revenue	income	currency	{general}	10	f	t	\N	2026-09-20 10:04:11.339805+00
2	cost_of_revenue	Cost of Revenue	income	currency	{general}	20	f	f	\N	2026-09-20 10:04:11.339805+00
3	gross_profit	Gross Profit	income	currency	{general}	30	t	t	\N	2026-09-20 10:04:11.339805+00
4	sga_expenses	Selling, General & Admin	income	currency	{general}	40	f	f	\N	2026-09-20 10:04:11.339805+00
5	other_operating_expenses	Other Operating Expenses	income	currency	{general}	50	f	f	\N	2026-09-20 10:04:11.339805+00
6	operating_profit	Operating Profit	income	currency	{general}	60	t	t	\N	2026-09-20 10:04:11.339805+00
7	finance_cost	Finance Cost	income	currency	{general}	70	f	f	\N	2026-09-20 10:04:11.339805+00
8	other_income	Other Income	income	currency	{general}	80	f	f	\N	2026-09-20 10:04:11.339805+00
9	share_of_associates	Share of Associates	income	currency	{general}	90	f	f	\N	2026-09-20 10:04:11.339805+00
10	profit_before_tax	Profit Before Tax	income	currency	{general}	100	t	t	\N	2026-09-20 10:04:11.339805+00
11	income_tax	Income Tax Expense	income	currency	{general}	110	f	f	\N	2026-09-20 10:04:11.339805+00
12	net_profit	Net Profit After Tax	income	currency	{general}	120	t	t	\N	2026-09-20 10:04:11.339805+00
13	net_profit_parent	Net Profit — Owners of Parent	income	currency	{general}	130	f	f	\N	2026-09-20 10:04:11.339805+00
14	ppe	Property, Plant & Equipment	balance	currency	{general}	200	f	f	\N	2026-09-20 10:04:11.339805+00
15	intangible_assets	Intangible Assets	balance	currency	{general}	210	f	f	\N	2026-09-20 10:04:11.339805+00
16	non_current_assets	Total Non-Current Assets	balance	currency	{general}	220	t	f	\N	2026-09-20 10:04:11.339805+00
17	inventory	Inventory	balance	currency	{general}	230	f	f	\N	2026-09-20 10:04:11.339805+00
18	trade_receivables	Trade & Other Receivables	balance	currency	{general}	240	f	f	\N	2026-09-20 10:04:11.339805+00
19	short_term_investments	Short-Term Investments	balance	currency	{general}	250	f	f	\N	2026-09-20 10:04:11.339805+00
20	cash_and_equivalents	Cash & Cash Equivalents	balance	currency	{general}	260	f	t	\N	2026-09-20 10:04:11.339805+00
21	current_assets	Total Current Assets	balance	currency	{general}	270	t	t	\N	2026-09-20 10:04:11.339805+00
22	total_assets	Total Assets	balance	currency	{general}	280	t	t	\N	2026-09-20 10:04:11.339805+00
23	share_capital	Share Capital	balance	currency	{general}	290	f	t	\N	2026-09-20 10:04:11.339805+00
24	reserves_and_surplus	Reserves & Surplus	balance	currency	{general}	300	f	f	\N	2026-09-20 10:04:11.339805+00
25	total_equity	Total Shareholders' Equity	balance	currency	{general}	310	t	t	\N	2026-09-20 10:04:11.339805+00
26	long_term_borrowings	Long-Term Borrowings	balance	currency	{general}	320	f	t	\N	2026-09-20 10:04:11.339805+00
27	non_current_liabilities	Total Non-Current Liabilities	balance	currency	{general}	330	t	f	\N	2026-09-20 10:04:11.339805+00
28	short_term_borrowings	Short-Term Borrowings	balance	currency	{general}	340	f	t	\N	2026-09-20 10:04:11.339805+00
29	trade_payables	Trade & Other Payables	balance	currency	{general}	350	f	f	\N	2026-09-20 10:04:11.339805+00
30	current_liabilities	Total Current Liabilities	balance	currency	{general}	360	t	t	\N	2026-09-20 10:04:11.339805+00
31	total_liabilities	Total Liabilities	balance	currency	{general}	370	t	f	\N	2026-09-20 10:04:11.339805+00
32	cash_from_operations	Cash Generated from Operations	cashflow	currency	{general}	400	f	f	\N	2026-09-20 10:04:11.339805+00
33	interest_paid	Interest Paid	cashflow	currency	{general}	410	f	f	\N	2026-09-20 10:04:11.339805+00
34	tax_paid	Income Tax Paid	cashflow	currency	{general}	420	f	f	\N	2026-09-20 10:04:11.339805+00
35	net_operating_cash_flow	Net Operating Cash Flow	cashflow	currency	{general}	430	t	t	\N	2026-09-20 10:04:11.339805+00
36	capex	Capital Expenditure	cashflow	currency	{general}	440	f	t	\N	2026-09-20 10:04:11.339805+00
37	net_investing_cash_flow	Net Investing Cash Flow	cashflow	currency	{general}	450	t	f	\N	2026-09-20 10:04:11.339805+00
38	dividends_paid	Dividends Paid	cashflow	currency	{general}	460	f	t	\N	2026-09-20 10:04:11.339805+00
39	net_borrowings	Net Borrowings	cashflow	currency	{general}	470	f	f	\N	2026-09-20 10:04:11.339805+00
40	net_financing_cash_flow	Net Financing Cash Flow	cashflow	currency	{general}	480	t	f	\N	2026-09-20 10:04:11.339805+00
41	net_change_in_cash	Net Change in Cash	cashflow	currency	{general}	490	t	f	\N	2026-09-20 10:04:11.339805+00
42	eps_basic	EPS — Basic	per_share	per_share	{}	500	f	t	\N	2026-09-20 10:04:11.339805+00
43	eps_diluted	EPS — Diluted	per_share	per_share	{}	510	f	f	\N	2026-09-20 10:04:11.339805+00
44	eps_restated	EPS — Restated	per_share	per_share	{}	520	f	f	\N	2026-09-20 10:04:11.339805+00
45	navps	NAVPS	per_share	per_share	{}	530	f	t	\N	2026-09-20 10:04:11.339805+00
46	nocfps	NOCFPS	per_share	per_share	{}	540	f	t	\N	2026-09-20 10:04:11.339805+00
47	shares_outstanding	Shares Outstanding	other	count	{}	550	f	t	\N	2026-09-20 10:04:11.339805+00
48	dividend_cash_pct	Cash Dividend %	other	percent	{}	560	f	t	\N	2026-09-20 10:04:11.339805+00
49	dividend_stock_pct	Stock Dividend %	other	percent	{}	570	f	t	\N	2026-09-20 10:04:11.339805+00
99	dividend_per_share	Dividend Per Share	per_share	per_share	{}	545	f	t	Cash dividend declared for the year, per share. On DSE this equals face value * cash dividend % / 100.	2026-09-20 10:38:31.321276+00
100	total_debt	Total Debt	balance	currency	{}	345	t	t	Interest-bearing borrowings, long- and short-term combined. Use when the source does not split them.	2026-09-20 10:38:31.321276+00
\.


--
-- Data for Name: metric_defs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.metric_defs (id, code, label, unit, formula_note, calc_version, display_order, created_at) FROM stdin;
1	revenue_growth	Revenue Growth	percent	revenue / prior year revenue - 1	1	10	2026-09-20 10:04:11.339805+00
2	eps_growth	EPS Growth	percent	eps_basic / prior year eps_basic - 1, both adjusted for bonus/rights	1	20	2026-09-20 10:04:11.339805+00
3	revenue_cagr_5y	Revenue CAGR 5Y	percent	(revenue_t / revenue_t-5)^(1/5) - 1	1	30	2026-09-20 10:04:11.339805+00
4	revenue_cagr_10y	Revenue CAGR 10Y	percent	(revenue_t / revenue_t-10)^(1/10) - 1	1	40	2026-09-20 10:04:11.339805+00
5	eps_cagr_5y	EPS CAGR 5Y	percent	(eps_t / eps_t-5)^(1/5) - 1, on bonus-adjusted EPS	1	50	2026-09-20 10:04:11.339805+00
6	eps_cagr_10y	EPS CAGR 10Y	percent	(eps_t / eps_t-10)^(1/10) - 1, on bonus-adjusted EPS	1	60	2026-09-20 10:04:11.339805+00
7	gross_margin	Gross Margin	percent	gross_profit / revenue	1	70	2026-09-20 10:04:11.339805+00
8	operating_margin	Operating Margin	percent	operating_profit / revenue	1	80	2026-09-20 10:04:11.339805+00
9	net_margin	Net Margin	percent	net_profit / revenue	1	90	2026-09-20 10:04:11.339805+00
10	roe	Return on Equity	percent	net_profit / average total_equity (opening + closing) / 2	1	100	2026-09-20 10:04:11.339805+00
11	roce	Return on Capital Employed	percent	operating_profit / (total_assets - current_liabilities), average of opening and closing	1	110	2026-09-20 10:04:11.339805+00
13	current_ratio	Current Ratio	ratio	current_assets / current_liabilities	1	130	2026-09-20 10:04:11.339805+00
15	cash_conversion	Cash Conversion	ratio	nocfps / eps_basic. Below 1 over several years is a warning sign.	1	150	2026-09-20 10:04:11.339805+00
17	pe_ratio	P/E Ratio	ratio	close price / trailing eps_basic	1	170	2026-09-20 10:04:11.339805+00
18	pb_ratio	P/B Ratio	ratio	close price / navps	1	180	2026-09-20 10:04:11.339805+00
19	dividend_yield	Dividend Yield	percent	cash dividend per share / close price	1	190	2026-09-20 10:04:11.339805+00
20	avg_pe_5y	Average P/E 5Y	ratio	mean of year-end P/E over the last five fiscal years	1	200	2026-09-20 10:04:11.339805+00
21	distance_from_52w_low	Distance from 52W Low	percent	close / min(close over trailing 52 weeks) - 1	1	210	2026-09-20 10:04:11.339805+00
14	fcf	Free Cash Flow	currency	net_operating_cash_flow + capex. Capex is stored as printed in the cash flow statement, i.e. negative for an outflow, so this adds rather than subtracts.	2	140	2026-09-20 10:04:11.339805+00
12	debt_to_equity	Debt / Equity	ratio	(long_term_borrowings + short_term_borrowings) / total_equity, falling back to total_debt / total_equity when the source does not split borrowings.	2	120	2026-09-20 10:04:11.339805+00
16	payout_ratio	Payout Ratio	percent	dividend_per_share / eps_basic — the dividend DECLARED for the year against that year's earnings. Note this differs from dividends-paid / net-profit, which lags by a year because the cash goes out in the following year; stockanalysis.com uses the latter.	2	160	2026-09-20 10:04:11.339805+00
\.


--
-- Data for Name: metric_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.metric_values (id, company_id, period_id, metric_id, value, calc_version, computed_at, inputs_note) FROM stdin;
\.


--
-- Data for Name: research_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.research_notes (id, company_id, note_type, title, body, fair_value, entry_price, target_horizon, conviction, price_at_writing, reviewed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: sectors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sectors (id, name, slug, created_at) FROM stdin;
1	Bank	bank	2026-09-20 10:04:11.339805+00
2	Cement	cement	2026-09-20 10:04:11.339805+00
3	Ceramics Sector	ceramics	2026-09-20 10:04:11.339805+00
4	Engineering	engineering	2026-09-20 10:04:11.339805+00
5	Financial Institutions	financial-institutions	2026-09-20 10:04:11.339805+00
6	Food & Allied	food-allied	2026-09-20 10:04:11.339805+00
7	Fuel & Power	fuel-power	2026-09-20 10:04:11.339805+00
8	General Insurance	general-insurance	2026-09-20 10:04:11.339805+00
9	IT Sector	it	2026-09-20 10:04:11.339805+00
10	Jute	jute	2026-09-20 10:04:11.339805+00
11	Life Insurance	life-insurance	2026-09-20 10:04:11.339805+00
12	Miscellaneous	miscellaneous	2026-09-20 10:04:11.339805+00
13	Mutual Funds	mutual-funds	2026-09-20 10:04:11.339805+00
14	Paper & Printing	paper-printing	2026-09-20 10:04:11.339805+00
15	Pharmaceuticals & Chemicals	pharmaceuticals-chemicals	2026-09-20 10:04:11.339805+00
16	Services & Real Estate	services-real-estate	2026-09-20 10:04:11.339805+00
17	Tannery Industries	tannery	2026-09-20 10:04:11.339805+00
18	Telecommunication	telecommunication	2026-09-20 10:04:11.339805+00
19	Textile	textile	2026-09-20 10:04:11.339805+00
20	Travel & Leisure	travel-leisure	2026-09-20 10:04:11.339805+00
\.


--
-- Data for Name: share_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.share_history (id, company_id, effective_date, shares_outstanding, corporate_action_id, source_document_id, note, created_at) FROM stdin;
\.


--
-- Data for Name: source_documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.source_documents (id, company_id, doc_type, title, fiscal_year, published_date, onedrive_path, source_url, file_sha256, page_count, accessed_date, notes, created_at, updated_at) FROM stdin;
2	1	other	stockanalysis.com financial statements (secondary source) — SQURPHARMA	\N	\N	\N	https://stockanalysis.com/quote/dse/SQURPHARMA/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
3	2	other	stockanalysis.com financial statements (secondary source) — MARICO	\N	\N	\N	https://stockanalysis.com/quote/dse/MARICO/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
4	3	other	stockanalysis.com financial statements (secondary source) — BERGERPBL	\N	\N	\N	https://stockanalysis.com/quote/dse/BERGERPBL/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
5	4	other	stockanalysis.com financial statements (secondary source) — RENATA	\N	\N	\N	https://stockanalysis.com/quote/dse/RENATA/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
6	5	other	stockanalysis.com financial statements (secondary source) — OLYMPIC	\N	\N	\N	https://stockanalysis.com/quote/dse/OLYMPIC/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
7	6	other	stockanalysis.com financial statements (secondary source) — BSRMSTEEL	\N	\N	\N	https://stockanalysis.com/quote/dse/BSRMSTEEL/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
8	14	other	stockanalysis.com financial statements (secondary source) — BSRMLTD	\N	\N	\N	https://stockanalysis.com/quote/dse/BSRMLTD/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
9	7	other	stockanalysis.com financial statements (secondary source) — LHB	\N	\N	\N	https://stockanalysis.com/quote/dse/LHB/financials/	\N	\N	2026-09-21	Bootstrap import. Unverified until checked against the annual report.	2026-09-20 12:23:53.321666+00	2026-09-21 05:40:14.468368+00
\.


--
-- Name: companies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.companies_id_seq', 47, true);


--
-- Name: corporate_actions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.corporate_actions_id_seq', 2, true);


--
-- Name: financial_facts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.financial_facts_id_seq', 1634, true);


--
-- Name: fiscal_periods_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fiscal_periods_id_seq', 87, true);


--
-- Name: job_runs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.job_runs_id_seq', 1, true);


--
-- Name: line_item_defs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.line_item_defs_id_seq', 304, true);


--
-- Name: metric_defs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.metric_defs_id_seq', 126, true);


--
-- Name: metric_values_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.metric_values_id_seq', 1, false);


--
-- Name: research_notes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.research_notes_id_seq', 1, false);


--
-- Name: sectors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sectors_id_seq', 120, true);


--
-- Name: share_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.share_history_id_seq', 1, false);


--
-- Name: source_documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.source_documents_id_seq', 17, true);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (name);


--
-- Name: companies companies_dse_symbol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_dse_symbol_key UNIQUE (dse_symbol);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: corporate_actions corporate_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_actions
    ADD CONSTRAINT corporate_actions_pkey PRIMARY KEY (id);


--
-- Name: daily_prices daily_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_prices
    ADD CONSTRAINT daily_prices_pkey PRIMARY KEY (company_id, trade_date);


--
-- Name: financial_facts financial_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_facts
    ADD CONSTRAINT financial_facts_pkey PRIMARY KEY (id);


--
-- Name: financial_facts financial_facts_revision_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_facts
    ADD CONSTRAINT financial_facts_revision_unique UNIQUE (period_id, line_item_id, revision);


--
-- Name: fiscal_periods fiscal_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_pkey PRIMARY KEY (id);


--
-- Name: fiscal_periods fiscal_periods_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_unique UNIQUE (company_id, fiscal_year, period_type, basis);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);


--
-- Name: line_item_defs line_item_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_item_defs
    ADD CONSTRAINT line_item_defs_pkey PRIMARY KEY (id);


--
-- Name: line_item_defs line_item_defs_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_item_defs
    ADD CONSTRAINT line_item_defs_tag_key UNIQUE (tag);


--
-- Name: metric_defs metric_defs_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_defs
    ADD CONSTRAINT metric_defs_code_key UNIQUE (code);


--
-- Name: metric_defs metric_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_defs
    ADD CONSTRAINT metric_defs_pkey PRIMARY KEY (id);


--
-- Name: metric_values metric_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_values
    ADD CONSTRAINT metric_values_pkey PRIMARY KEY (id);


--
-- Name: metric_values metric_values_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_values
    ADD CONSTRAINT metric_values_unique UNIQUE (company_id, period_id, metric_id);


--
-- Name: research_notes research_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_notes
    ADD CONSTRAINT research_notes_pkey PRIMARY KEY (id);


--
-- Name: sectors sectors_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_name_key UNIQUE (name);


--
-- Name: sectors sectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_pkey PRIMARY KEY (id);


--
-- Name: sectors sectors_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_slug_key UNIQUE (slug);


--
-- Name: share_history share_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_history
    ADD CONSTRAINT share_history_pkey PRIMARY KEY (id);


--
-- Name: share_history share_history_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_history
    ADD CONSTRAINT share_history_unique UNIQUE (company_id, effective_date);


--
-- Name: source_documents source_documents_company_title_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_documents
    ADD CONSTRAINT source_documents_company_title_unique UNIQUE (company_id, title);


--
-- Name: source_documents source_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_documents
    ADD CONSTRAINT source_documents_pkey PRIMARY KEY (id);


--
-- Name: companies_sector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_sector_idx ON public.companies USING btree (sector_id);


--
-- Name: companies_tracked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_tracked_idx ON public.companies USING btree (is_tracked) WHERE is_tracked;


--
-- Name: corporate_actions_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corporate_actions_company_idx ON public.corporate_actions USING btree (company_id, ex_date DESC);


--
-- Name: corporate_actions_fy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corporate_actions_fy_idx ON public.corporate_actions USING btree (company_id, fiscal_year DESC);


--
-- Name: daily_prices_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_prices_date_idx ON public.daily_prices USING btree (trade_date DESC);


--
-- Name: financial_facts_line_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_facts_line_item_idx ON public.financial_facts USING btree (line_item_id) WHERE is_current;


--
-- Name: financial_facts_one_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX financial_facts_one_current_idx ON public.financial_facts USING btree (period_id, line_item_id) WHERE is_current;


--
-- Name: financial_facts_unverified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_facts_unverified_idx ON public.financial_facts USING btree (period_id) WHERE (verification = 'unverified'::public.verification_status);


--
-- Name: fiscal_periods_company_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiscal_periods_company_year_idx ON public.fiscal_periods USING btree (company_id, fiscal_year DESC);


--
-- Name: fiscal_periods_end_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiscal_periods_end_idx ON public.fiscal_periods USING btree (period_end DESC);


--
-- Name: job_runs_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_name_idx ON public.job_runs USING btree (job_name, started_at DESC);


--
-- Name: line_item_defs_statement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX line_item_defs_statement_idx ON public.line_item_defs USING btree (statement, display_order);


--
-- Name: metric_values_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metric_values_company_idx ON public.metric_values USING btree (company_id, metric_id);


--
-- Name: research_notes_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_notes_company_idx ON public.research_notes USING btree (company_id, created_at DESC);


--
-- Name: share_history_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX share_history_company_idx ON public.share_history USING btree (company_id, effective_date DESC);


--
-- Name: source_documents_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_documents_company_idx ON public.source_documents USING btree (company_id, fiscal_year);


--
-- Name: companies companies_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER companies_set_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: corporate_actions corporate_actions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER corporate_actions_set_updated_at BEFORE UPDATE ON public.corporate_actions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: financial_facts financial_facts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER financial_facts_set_updated_at BEFORE UPDATE ON public.financial_facts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: fiscal_periods fiscal_periods_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fiscal_periods_set_updated_at BEFORE UPDATE ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: research_notes research_notes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER research_notes_set_updated_at BEFORE UPDATE ON public.research_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: source_documents source_documents_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER source_documents_set_updated_at BEFORE UPDATE ON public.source_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: companies companies_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id);


--
-- Name: corporate_actions corporate_actions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_actions
    ADD CONSTRAINT corporate_actions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: corporate_actions corporate_actions_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_actions
    ADD CONSTRAINT corporate_actions_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.source_documents(id) ON DELETE SET NULL;


--
-- Name: daily_prices daily_prices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_prices
    ADD CONSTRAINT daily_prices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: financial_facts financial_facts_line_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_facts
    ADD CONSTRAINT financial_facts_line_item_id_fkey FOREIGN KEY (line_item_id) REFERENCES public.line_item_defs(id);


--
-- Name: financial_facts financial_facts_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_facts
    ADD CONSTRAINT financial_facts_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.fiscal_periods(id) ON DELETE CASCADE;


--
-- Name: financial_facts financial_facts_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_facts
    ADD CONSTRAINT financial_facts_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.source_documents(id) ON DELETE SET NULL;


--
-- Name: fiscal_periods fiscal_periods_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: fiscal_periods fiscal_periods_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.source_documents(id) ON DELETE SET NULL;


--
-- Name: metric_values metric_values_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_values
    ADD CONSTRAINT metric_values_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: metric_values metric_values_metric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_values
    ADD CONSTRAINT metric_values_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES public.metric_defs(id) ON DELETE CASCADE;


--
-- Name: metric_values metric_values_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_values
    ADD CONSTRAINT metric_values_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.fiscal_periods(id) ON DELETE CASCADE;


--
-- Name: research_notes research_notes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_notes
    ADD CONSTRAINT research_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: share_history share_history_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_history
    ADD CONSTRAINT share_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: share_history share_history_corporate_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_history
    ADD CONSTRAINT share_history_corporate_action_id_fkey FOREIGN KEY (corporate_action_id) REFERENCES public.corporate_actions(id) ON DELETE SET NULL;


--
-- Name: share_history share_history_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_history
    ADD CONSTRAINT share_history_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.source_documents(id) ON DELETE SET NULL;


--
-- Name: source_documents source_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_documents
    ADD CONSTRAINT source_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: _migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: fiscal_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: job_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: line_item_defs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_item_defs ENABLE ROW LEVEL SECURITY;

--
-- Name: metric_defs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metric_defs ENABLE ROW LEVEL SECURITY;

--
-- Name: metric_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metric_values ENABLE ROW LEVEL SECURITY;

--
-- Name: research_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: sectors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

--
-- Name: share_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.share_history ENABLE ROW LEVEL SECURITY;

--
-- Name: source_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict 5VZiBeH5r0Y9b1UqINt0N7BMbo1k36ARace8p8xePWLaziGh3Iggfhaurfw0en2

