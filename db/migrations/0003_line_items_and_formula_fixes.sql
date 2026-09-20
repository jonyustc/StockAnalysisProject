-- =============================================================================
-- Two line items the taxonomy was missing, and two formula corrections.
--
-- dividend_per_share: DSE quotes dividends as a percentage of face value, but
-- the per-share amount is what every payout and yield calculation actually
-- needs, and it is what the statements print. Keeping both means neither has
-- to be derived from the other.
--
-- total_debt: some sources publish a single debt figure rather than splitting
-- long- and short-term borrowings. Without this, entering them means either
-- guessing a split or leaving debt out, and the debt/equity metric silently
-- reads zero.
--
-- The FCF correction matters more than it looks. Capital expenditure is
-- printed as a negative in a cash flow statement — "Acquisition of PPE
-- (6,177)" — and the rule everywhere here is to store figures as printed. So
-- free cash flow is OCF PLUS capex, not minus. The original definition would
-- have doubled the capex deduction and understated FCF on every company.
-- =============================================================================

INSERT INTO line_item_defs (tag, label, statement, unit, applies_to, display_order, is_subtotal, is_core, description) VALUES
    ('dividend_per_share', 'Dividend Per Share', 'per_share', 'per_share', '{}', 545, false, true,
     'Cash dividend declared for the year, per share. On DSE this equals face value * cash dividend % / 100.'),
    ('total_debt',         'Total Debt',         'balance',   'currency',  '{}', 345, true,  true,
     'Interest-bearing borrowings, long- and short-term combined. Use when the source does not split them.')
ON CONFLICT (tag) DO NOTHING;

UPDATE metric_defs
SET formula_note = 'net_operating_cash_flow + capex. Capex is stored as printed in the cash flow statement, i.e. negative for an outflow, so this adds rather than subtracts.',
    calc_version = 2
WHERE code = 'fcf';

UPDATE metric_defs
SET formula_note = '(long_term_borrowings + short_term_borrowings) / total_equity, falling back to total_debt / total_equity when the source does not split borrowings.',
    calc_version = 2
WHERE code = 'debt_to_equity';

UPDATE metric_defs
SET formula_note = 'dividend_per_share / eps_basic — the dividend DECLARED for the year against that year''s earnings. Note this differs from dividends-paid / net-profit, which lags by a year because the cash goes out in the following year; stockanalysis.com uses the latter.',
    calc_version = 2
WHERE code = 'payout_ratio';
