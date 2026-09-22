-- =============================================================================
-- Declared cash dividends, kept with the snapshot they were printed on.
--
-- A statement lists dividends that are declared but not yet paid. Keeping the
-- list per snapshot does two things:
--
--   - the dividends page can show what is on its way, and when it was due;
--   - the next import can tell which of them have since been paid — gone from
--     the list, with the lifetime "Cash Dividend" total up by about that much —
--     and offer to record them, instead of relying on memory.
--
-- A list rather than a table: it is only ever read and replaced whole,
-- alongside the snapshot it belongs to, and never queried by field. Each entry
-- is {companyName, symbol, holding, rate, entitlement, recordDate}, as printed
-- plus the symbol matched at import (null when no tracked company matched).
-- =============================================================================

ALTER TABLE account_snapshots
    ADD COLUMN dividends_receivable jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE account_snapshots
    ADD CONSTRAINT account_snapshots_receivable_is_list
    CHECK (jsonb_typeof(dividends_receivable) = 'array');
