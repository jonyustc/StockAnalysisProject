-- =============================================================================
-- Account snapshots: one per BO account per statement date.
--
-- A broker statement's "Account Status Till Today" section carries lifetime
-- totals — money deposited and withdrawn, dividends, realised gain — plus the
-- account's cash and holdings value. From one snapshot that gives a lifetime
-- return with no trade history needed. From a series of them it gives returns
-- per period and per calendar year, with deposits in between separated out.
--
-- Stored as the broker printed them. Returns are computed from these, never
-- stored, for the same reason reported and derived figures are kept apart
-- everywhere else here.
--
-- One row per account per date: re-importing the same day's statement
-- replaces its snapshot rather than adding a duplicate that would count the
-- day twice.
-- =============================================================================

CREATE TABLE account_snapshots (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bo_account_id       smallint NOT NULL REFERENCES bo_accounts(id) ON DELETE CASCADE,
    as_of               date NOT NULL,
    broker              text,

    /* Holdings at market, and what they cost, per the broker. */
    market_value        numeric(20,2) NOT NULL,
    cost_of_holdings    numeric(20,2),
    cash_balance        numeric(20,2) NOT NULL,

    /* Lifetime totals, as printed. */
    deposit             numeric(20,2) NOT NULL DEFAULT 0,
    ipo_refund          numeric(20,2) NOT NULL DEFAULT 0,
    cash_dividend       numeric(20,2) NOT NULL DEFAULT 0,
    share_transfer_in   numeric(20,2) NOT NULL DEFAULT 0,
    withdraw            numeric(20,2) NOT NULL DEFAULT 0,
    ipo_payment         numeric(20,2) NOT NULL DEFAULT 0,
    share_transfer_out  numeric(20,2) NOT NULL DEFAULT 0,
    realised_gain       numeric(20,2) NOT NULL DEFAULT 0,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT account_snapshots_one_per_day UNIQUE (bo_account_id, as_of)
);

CREATE INDEX account_snapshots_account_idx ON account_snapshots (bo_account_id, as_of);

CREATE TRIGGER account_snapshots_set_updated_at
    BEFORE UPDATE ON account_snapshots
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
