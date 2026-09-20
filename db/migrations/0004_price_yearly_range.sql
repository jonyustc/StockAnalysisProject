-- =============================================================================
-- 52-week range as reported on the day.
--
-- The range could be computed from accumulated daily_prices, but only after a
-- year of collection. Sources publish it now, and it IS a fact as of that
-- trade date, so it is stored as one — "distance from 52-week low" works from
-- the first day rather than the 366th.
--
-- Nullable because a source may not publish it. Once a year of history exists,
-- the computed range becomes the better figure and this becomes corroboration.
-- =============================================================================

ALTER TABLE daily_prices
    ADD COLUMN IF NOT EXISTS yearly_high numeric(18,4),
    ADD COLUMN IF NOT EXISTS yearly_low  numeric(18,4);

COMMENT ON COLUMN daily_prices.yearly_high IS
    '52-week high as reported by the source on trade_date, not computed from this table.';
