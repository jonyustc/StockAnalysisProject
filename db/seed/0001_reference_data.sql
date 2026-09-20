-- =============================================================================
-- Reference data: sectors, line item taxonomy, metric definitions, companies
-- Safe to re-run (every insert is idempotent).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- DSE sectors
-- -----------------------------------------------------------------------------

INSERT INTO sectors (name, slug) VALUES
    ('Bank',                        'bank'),
    ('Cement',                      'cement'),
    ('Ceramics Sector',             'ceramics'),
    ('Engineering',                 'engineering'),
    ('Financial Institutions',      'financial-institutions'),
    ('Food & Allied',               'food-allied'),
    ('Fuel & Power',                'fuel-power'),
    ('General Insurance',           'general-insurance'),
    ('IT Sector',                   'it'),
    ('Jute',                        'jute'),
    ('Life Insurance',              'life-insurance'),
    ('Miscellaneous',               'miscellaneous'),
    ('Mutual Funds',                'mutual-funds'),
    ('Paper & Printing',            'paper-printing'),
    ('Pharmaceuticals & Chemicals', 'pharmaceuticals-chemicals'),
    ('Services & Real Estate',      'services-real-estate'),
    ('Tannery Industries',          'tannery'),
    ('Telecommunication',           'telecommunication'),
    ('Textile',                     'textile'),
    ('Travel & Leisure',            'travel-leisure')
ON CONFLICT (slug) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Line item taxonomy — 'general' template
--
-- is_core = the minimum set worth entering on the first pass. Enter those for
-- all ten years before going back for the rest; a complete core history is far
-- more useful than one perfect year.
-- -----------------------------------------------------------------------------

INSERT INTO line_item_defs (tag, label, statement, unit, applies_to, display_order, is_subtotal, is_core) VALUES
    -- Income statement
    ('revenue',                  'Revenue',                        'income',    'currency',  '{general}', 10,  false, true),
    ('cost_of_revenue',          'Cost of Revenue',                'income',    'currency',  '{general}', 20,  false, false),
    ('gross_profit',             'Gross Profit',                   'income',    'currency',  '{general}', 30,  true,  true),
    ('sga_expenses',             'Selling, General & Admin',       'income',    'currency',  '{general}', 40,  false, false),
    ('other_operating_expenses', 'Other Operating Expenses',       'income',    'currency',  '{general}', 50,  false, false),
    ('operating_profit',         'Operating Profit',               'income',    'currency',  '{general}', 60,  true,  true),
    ('finance_cost',             'Finance Cost',                   'income',    'currency',  '{general}', 70,  false, false),
    ('other_income',             'Other Income',                   'income',    'currency',  '{general}', 80,  false, false),
    ('share_of_associates',      'Share of Associates',            'income',    'currency',  '{general}', 90,  false, false),
    ('profit_before_tax',        'Profit Before Tax',              'income',    'currency',  '{general}', 100, true,  true),
    ('income_tax',               'Income Tax Expense',             'income',    'currency',  '{general}', 110, false, false),
    ('net_profit',               'Net Profit After Tax',           'income',    'currency',  '{general}', 120, true,  true),
    ('net_profit_parent',        'Net Profit — Owners of Parent',  'income',    'currency',  '{general}', 130, false, false),

    -- Balance sheet
    ('ppe',                      'Property, Plant & Equipment',    'balance',   'currency',  '{general}', 200, false, false),
    ('intangible_assets',        'Intangible Assets',              'balance',   'currency',  '{general}', 210, false, false),
    ('non_current_assets',       'Total Non-Current Assets',       'balance',   'currency',  '{general}', 220, true,  false),
    ('inventory',                'Inventory',                      'balance',   'currency',  '{general}', 230, false, false),
    ('trade_receivables',        'Trade & Other Receivables',      'balance',   'currency',  '{general}', 240, false, false),
    ('short_term_investments',   'Short-Term Investments',         'balance',   'currency',  '{general}', 250, false, false),
    ('cash_and_equivalents',     'Cash & Cash Equivalents',        'balance',   'currency',  '{general}', 260, false, true),
    ('current_assets',           'Total Current Assets',           'balance',   'currency',  '{general}', 270, true,  true),
    ('total_assets',             'Total Assets',                   'balance',   'currency',  '{general}', 280, true,  true),
    ('share_capital',            'Share Capital',                  'balance',   'currency',  '{general}', 290, false, true),
    ('reserves_and_surplus',     'Reserves & Surplus',             'balance',   'currency',  '{general}', 300, false, false),
    ('total_equity',             'Total Shareholders'' Equity',    'balance',   'currency',  '{general}', 310, true,  true),
    ('long_term_borrowings',     'Long-Term Borrowings',           'balance',   'currency',  '{general}', 320, false, true),
    ('non_current_liabilities',  'Total Non-Current Liabilities',  'balance',   'currency',  '{general}', 330, true,  false),
    ('short_term_borrowings',    'Short-Term Borrowings',          'balance',   'currency',  '{general}', 340, false, true),
    ('trade_payables',           'Trade & Other Payables',         'balance',   'currency',  '{general}', 350, false, false),
    ('current_liabilities',      'Total Current Liabilities',      'balance',   'currency',  '{general}', 360, true,  true),
    ('total_liabilities',        'Total Liabilities',              'balance',   'currency',  '{general}', 370, true,  false),

    -- Cash flow
    ('cash_from_operations',     'Cash Generated from Operations', 'cashflow',  'currency',  '{general}', 400, false, false),
    ('interest_paid',            'Interest Paid',                  'cashflow',  'currency',  '{general}', 410, false, false),
    ('tax_paid',                 'Income Tax Paid',                'cashflow',  'currency',  '{general}', 420, false, false),
    ('net_operating_cash_flow',  'Net Operating Cash Flow',        'cashflow',  'currency',  '{general}', 430, true,  true),
    ('capex',                    'Capital Expenditure',            'cashflow',  'currency',  '{general}', 440, false, true),
    ('net_investing_cash_flow',  'Net Investing Cash Flow',        'cashflow',  'currency',  '{general}', 450, true,  false),
    ('dividends_paid',           'Dividends Paid',                 'cashflow',  'currency',  '{general}', 460, false, true),
    ('net_borrowings',           'Net Borrowings',                 'cashflow',  'currency',  '{general}', 470, false, false),
    ('net_financing_cash_flow',  'Net Financing Cash Flow',        'cashflow',  'currency',  '{general}', 480, true,  false),
    ('net_change_in_cash',       'Net Change in Cash',             'cashflow',  'currency',  '{general}', 490, true,  false),

    -- Per share and share count (reported figures, not derived)
    ('eps_basic',                'EPS — Basic',                    'per_share', 'per_share', '{}',        500, false, true),
    ('eps_diluted',              'EPS — Diluted',                  'per_share', 'per_share', '{}',        510, false, false),
    ('eps_restated',             'EPS — Restated',                 'per_share', 'per_share', '{}',        520, false, false),
    ('navps',                    'NAVPS',                          'per_share', 'per_share', '{}',        530, false, true),
    ('nocfps',                   'NOCFPS',                         'per_share', 'per_share', '{}',        540, false, true),
    ('shares_outstanding',       'Shares Outstanding',             'other',     'count',     '{}',        550, false, true),
    ('dividend_cash_pct',        'Cash Dividend %',                'other',     'percent',   '{}',        560, false, true),
    ('dividend_stock_pct',       'Stock Dividend %',               'other',     'percent',   '{}',        570, false, true)
ON CONFLICT (tag) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Metric definitions
--
-- The formula_note is not decoration. ROCE, FCF and "capital employed" are
-- defined differently by different sources; write down which one you chose.
-- -----------------------------------------------------------------------------

INSERT INTO metric_defs (code, label, unit, formula_note, display_order) VALUES
    ('revenue_growth',    'Revenue Growth',        'percent', 'revenue / prior year revenue - 1', 10),
    ('eps_growth',        'EPS Growth',            'percent', 'eps_basic / prior year eps_basic - 1, both adjusted for bonus/rights', 20),
    ('revenue_cagr_5y',   'Revenue CAGR 5Y',       'percent', '(revenue_t / revenue_t-5)^(1/5) - 1', 30),
    ('revenue_cagr_10y',  'Revenue CAGR 10Y',      'percent', '(revenue_t / revenue_t-10)^(1/10) - 1', 40),
    ('eps_cagr_5y',       'EPS CAGR 5Y',           'percent', '(eps_t / eps_t-5)^(1/5) - 1, on bonus-adjusted EPS', 50),
    ('eps_cagr_10y',      'EPS CAGR 10Y',          'percent', '(eps_t / eps_t-10)^(1/10) - 1, on bonus-adjusted EPS', 60),
    ('gross_margin',      'Gross Margin',          'percent', 'gross_profit / revenue', 70),
    ('operating_margin',  'Operating Margin',      'percent', 'operating_profit / revenue', 80),
    ('net_margin',        'Net Margin',            'percent', 'net_profit / revenue', 90),
    ('roe',               'Return on Equity',      'percent', 'net_profit / average total_equity (opening + closing) / 2', 100),
    ('roce',              'Return on Capital Employed', 'percent', 'operating_profit / (total_assets - current_liabilities), average of opening and closing', 110),
    ('debt_to_equity',    'Debt / Equity',         'ratio',   '(long_term_borrowings + short_term_borrowings) / total_equity', 120),
    ('current_ratio',     'Current Ratio',         'ratio',   'current_assets / current_liabilities', 130),
    ('fcf',               'Free Cash Flow',        'currency','net_operating_cash_flow - capex', 140),
    ('cash_conversion',   'Cash Conversion',       'ratio',   'nocfps / eps_basic. Below 1 over several years is a warning sign.', 150),
    ('payout_ratio',      'Payout Ratio',          'percent', 'dividend per share / eps_basic', 160),
    ('pe_ratio',          'P/E Ratio',             'ratio',   'close price / trailing eps_basic', 170),
    ('pb_ratio',          'P/B Ratio',             'ratio',   'close price / navps', 180),
    ('dividend_yield',    'Dividend Yield',        'percent', 'cash dividend per share / close price', 190),
    ('avg_pe_5y',         'Average P/E 5Y',        'ratio',   'mean of year-end P/E over the last five fiscal years', 200),
    ('distance_from_52w_low', 'Distance from 52W Low', 'percent', 'close / min(close over trailing 52 weeks) - 1', 210)
ON CONFLICT (code) DO NOTHING;


-- -----------------------------------------------------------------------------
-- The tracked companies
--
-- Every symbol below was checked against dsebd.org and every fiscal year end
-- against the company's published financial statements.
--
-- Note LafargeHolcim is LHB, not LHBL — DSE returns "No company found" for
-- LHBL. The daily price job looks companies up by DSE symbol, so this is not
-- a cosmetic detail.
-- -----------------------------------------------------------------------------

INSERT INTO companies (
    dse_symbol, alt_symbols, name, short_name, sector_id, statement_template,
    fiscal_year_end_month, fiscal_year_end_day, investor_relations_url, notes
)
SELECT v.dse_symbol, v.alt_symbols, v.name, v.short_name, s.id, 'general'::statement_template,
       v.fye_month, v.fye_day, v.ir_url, v.notes
FROM (VALUES
    ('SQURPHARMA', '{SQUARE}'::text[],  'Square Pharmaceuticals PLC',      'Square Pharma', 'pharmaceuticals-chemicals', 6::smallint,  30::smallint, 'https://www.squarepharma.com.bd/annual-reports.php', 'FYE 30 June (Jul-Jun), confirmed.'),
    ('MARICO',     '{}'::text[],        'Marico Bangladesh Limited',       'Marico',        'pharmaceuticals-chemicals', 3::smallint,  31::smallint, 'https://marico.com/bangladesh/investors',            'FYE 31 March (Apr-Mar), confirmed.'),
    ('BERGERPBL',  '{BERGER}'::text[],  'Berger Paints Bangladesh Ltd',    'Berger',        'miscellaneous',             3::smallint,  31::smallint, NULL, 'FYE 31 March (Apr-Mar), confirmed. Sector unverified.'),
    ('RENATA',     '{}'::text[],        'Renata PLC',                      'Renata',        'pharmaceuticals-chemicals', 6::smallint,  30::smallint, NULL, 'FYE 30 June (Jul-Jun), confirmed.'),
    ('OLYMPIC',    '{}'::text[],        'Olympic Industries PLC',          'Olympic',       'food-allied',               6::smallint,  30::smallint, NULL, 'FYE 30 June (Jul-Jun), confirmed.'),
    ('BSRMSTEEL',  '{BSRM}'::text[],    'BSRM Steels Limited',             'BSRM Steels',   'engineering',               6::smallint,  30::smallint, NULL, 'FYE 30 June (Jul-Jun), confirmed.'),
    ('BSRMLTD',    '{}'::text[],        'Bangladesh Steel Re-Rolling Mills Limited', 'BSRM Ltd', 'engineering',          6::smallint,  30::smallint, NULL, 'FYE 30 June (Jul-Jun), confirmed. Separate listing from BSRMSTEEL; both are tracked.'),
    ('LHB',        '{LHBL}'::text[],    'LafargeHolcim Bangladesh PLC',    'LafargeHolcim', 'cement',                   12::smallint,  31::smallint, NULL, 'FYE 31 December (Jan-Dec), confirmed. DSE code is LHB, not LHBL.')
) AS v(dse_symbol, alt_symbols, name, short_name, sector_slug, fye_month, fye_day, ir_url, notes)
LEFT JOIN sectors s ON s.slug = v.sector_slug
ON CONFLICT (dse_symbol) DO NOTHING;
