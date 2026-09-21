-- =============================================================================
-- Portfolio: what you actually own, and what you actually paid.
--
-- One chronological ledger rather than a holdings table, because a holding is
-- not a fact — it is the result of a sequence of events. Quantity and average
-- cost are derived from this, never stored, for the same reason reported
-- figures and calculated metrics are kept apart everywhere else here: if the
-- cost-basis rule ever changes, no history has to be rewritten.
--
-- Five kinds of event, because on DSE they are genuinely different:
--
--   buy       shares in, cash out (price x quantity, plus commission)
--   sell      shares out, cash in (less commission)
--   bonus     shares in, NO cash. Quantity rises, total cost does not, so
--             average cost falls. This is the one every generic portfolio
--             tracker gets wrong for DSE.
--   rights    shares in, cash out at the subscription price — real money, so
--             it raises total cost
--   dividend  no share movement, cash in. Recorded gross with the tax
--             withheld separately, because DSE dividends arrive net and
--             yield-on-cost computed from the net figure understates it.
--
-- Commission matters more than it looks: DSE brokerage runs around 0.4-0.5%
-- each way, so a round trip starts about 1% down before the price moves.
-- =============================================================================

CREATE TYPE transaction_type AS ENUM ('buy', 'sell', 'bonus', 'rights', 'dividend');

CREATE TABLE portfolio_transactions (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          bigint NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

    trade_date          date NOT NULL,
    txn_type            transaction_type NOT NULL,

    /* Shares moved. Null for a cash dividend, which moves none. */
    quantity            numeric(20,4),

    /* Per share. Zero for a bonus issue — the shares cost nothing. */
    price_per_share     numeric(18,4),

    /* Cash dividend before tax. Only used by 'dividend'. */
    gross_amount        numeric(24,4),

    commission          numeric(18,4) NOT NULL DEFAULT 0,
    tax_withheld        numeric(18,4) NOT NULL DEFAULT 0,

    /* Ties a bonus or rights entry to the action that caused it. */
    corporate_action_id bigint REFERENCES corporate_actions(id) ON DELETE SET NULL,

    notes               text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    /* A share movement needs a quantity; a dividend needs an amount. */
    CONSTRAINT portfolio_transactions_shape CHECK (
        (txn_type = 'dividend' AND gross_amount IS NOT NULL AND quantity IS NULL)
        OR (txn_type <> 'dividend' AND quantity IS NOT NULL AND quantity > 0)
    ),

    CONSTRAINT portfolio_transactions_price CHECK (
        txn_type = 'dividend' OR (price_per_share IS NOT NULL AND price_per_share >= 0)
    ),

    CONSTRAINT portfolio_transactions_costs CHECK (
        commission >= 0 AND tax_withheld >= 0
    )
);

CREATE INDEX portfolio_transactions_company_idx
    ON portfolio_transactions (company_id, trade_date);

CREATE INDEX portfolio_transactions_date_idx
    ON portfolio_transactions (trade_date DESC);

CREATE TRIGGER portfolio_transactions_set_updated_at
    BEFORE UPDATE ON portfolio_transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE portfolio_transactions IS
    'Chronological ledger of holdings events. Quantity and average cost are derived from it, never stored.';

COMMENT ON COLUMN portfolio_transactions.tax_withheld IS
    'Tax deducted at source on a dividend. Kept separate so yield on cost can be shown gross or net rather than silently understated.';
