-- =============================================================================
-- Cash movements: money in and out of a BO account, on the day it moved.
--
-- Account snapshots give lifetime totals; a broker's cash ledger gives each
-- deposit, withdrawal and fee with its date. Dates are what a money-weighted
-- return needs, and what "when did I put money in" means.
--
-- Trades are not here — they are portfolio_transactions, with their shares.
-- This holds only the cash that moved without shares: deposits, withdrawals,
-- account fees, dividends received and IPO money.
--
-- Signed: positive into the account, negative out of it.
-- =============================================================================

CREATE TYPE cash_movement_kind AS ENUM ('deposit', 'withdrawal', 'fee', 'dividend', 'ipo', 'other');

CREATE TABLE cash_movements (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bo_account_id   smallint NOT NULL REFERENCES bo_accounts(id) ON DELETE CASCADE,
    movement_date   date NOT NULL,
    kind            cash_movement_kind NOT NULL,
    amount          numeric(20,2) NOT NULL CHECK (amount <> 0),
    description     text,
    /* Where it came from, e.g. "LankaBangla ledger 2025-07-01 to 2026-09-22". */
    source          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    /* A deposit is money in, a withdrawal or fee money out. */
    CONSTRAINT cash_movements_sign CHECK (
        (kind IN ('deposit', 'dividend') AND amount > 0)
        OR (kind IN ('withdrawal', 'fee') AND amount < 0)
        OR kind IN ('ipo', 'other')
    )
);

CREATE INDEX cash_movements_account_idx ON cash_movements (bo_account_id, movement_date);

-- Prices for every company in the ledger, not only the researched ones: a
-- holding in a company with no fundamentals entered still needs a value.
-- (Code change in lib/ingest-prices.ts; recorded here for the history.)
