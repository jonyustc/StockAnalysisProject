-- =============================================================================
-- Where each ledger entry came from, and what imports have covered — so that
-- an import only ever replaces what it is entitled to replace, and the
-- stored data can be checked against the broker's own figures.
-- =============================================================================

-- 1. Source of every transaction.
--
-- A ledger import replaces the buys and sells of its period. It may replace
-- rows that an earlier ledger or a statement import wrote — those were only
-- ever stand-ins for the broker's record. It must never silently replace a
-- row typed in by hand: that may be an IPO allotment or a transfer in, which
-- a cash ledger does not list as a trade.
ALTER TABLE portfolio_transactions
    ADD COLUMN source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'statement', 'ledger', 'dividend_report'));

UPDATE portfolio_transactions SET source = 'ledger'
 WHERE notes LIKE 'From the % ledger %';
UPDATE portfolio_transactions SET source = 'dividend_report'
 WHERE notes LIKE 'From the % cash dividend report%';
UPDATE portfolio_transactions SET source = 'statement'
 WHERE notes LIKE 'Opening position from the %'
    OR notes LIKE 'From reconciling the %'
    OR notes LIKE 'Paid between statements%';

-- 2. Record date of a dividend.
--
-- Two dividends from one company can be the same amount — equal interims are
-- common — so "same stock, same amount" does not identify a dividend. The
-- record date does.
ALTER TABLE portfolio_transactions ADD COLUMN record_date date;

UPDATE portfolio_transactions
   SET record_date = substring(notes FROM '(?i)record date (\d{4}-\d{2}-\d{2})')::date
 WHERE txn_type = 'dividend'
   AND notes ~* 'record date \d{4}-\d{2}-\d{2}';

ALTER TABLE portfolio_transactions
    ADD CONSTRAINT portfolio_transactions_record_date_dividend_only
    CHECK (record_date IS NULL OR txn_type = 'dividend');

-- 3. What each statement said the account held, stock by stock, so the
--    ledger's holdings can be checked against it later.
ALTER TABLE account_snapshots
    ADD COLUMN holdings jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(holdings) = 'array');

-- 4. Which periods an account's broker ledger has covered. A check of cash
--    or trades is only meaningful up to the end of the latest ledger, and a
--    full reconciliation needs one that starts at an opening balance of zero.
CREATE TABLE ledger_imports (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bo_account_id    smallint NOT NULL REFERENCES bo_accounts(id) ON DELETE CASCADE,
    period_from      date NOT NULL,
    period_to        date NOT NULL CHECK (period_to >= period_from),
    opening_balance  numeric(20,2) NOT NULL,
    closing_balance  numeric(20,2) NOT NULL,
    trades           integer NOT NULL,
    cash_lines       integer NOT NULL,
    imported_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_imports_account_idx ON ledger_imports (bo_account_id, period_to);
