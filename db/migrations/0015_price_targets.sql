-- =============================================================================
-- Price targets: "buy below", "sell above", per stock — for one BO account, or
-- for any. Whether a target has been reached is worked out from the latest
-- close each time it is looked at, never stored, so it cannot go stale.
-- =============================================================================

CREATE TABLE price_targets (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    /* Null: whichever account — a target on the stock itself. */
    bo_account_id   smallint REFERENCES bo_accounts(id) ON DELETE CASCADE,
    buy_below       numeric(18,4) CHECK (buy_below > 0),
    sell_above      numeric(18,4) CHECK (sell_above > 0),
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT price_targets_something_to_watch CHECK (buy_below IS NOT NULL OR sell_above IS NOT NULL),
    CONSTRAINT price_targets_buy_under_sell CHECK (buy_below IS NULL OR sell_above IS NULL OR buy_below < sell_above)
);

-- One target per stock per account, and one for "any account".
CREATE UNIQUE INDEX price_targets_one_per_scope
    ON price_targets (company_id, bo_account_id) NULLS NOT DISTINCT;

CREATE TRIGGER price_targets_set_updated_at
    BEFORE UPDATE ON price_targets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
