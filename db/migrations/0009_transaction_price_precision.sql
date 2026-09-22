-- =============================================================================
-- More decimals for price per share.
--
-- A quoted price has two decimals, but an opening position imported from a
-- broker statement carries a price DERIVED from the broker's total cost, and
-- four decimals was not enough to reproduce that total:
--
--   183,424.50 / 850 = 215.79352941...   stored as 215.7935
--   215.7935 x 850   = 183,424.475       two paisa short of the statement
--
-- Ten decimals makes quantity x price reproduce any statement total to the
-- paisa. Widening is lossless for every existing row.
-- =============================================================================

ALTER TABLE portfolio_transactions
    ALTER COLUMN price_per_share TYPE numeric(28,10);
