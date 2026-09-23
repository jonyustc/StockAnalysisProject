-- =============================================================================
-- One corporate action per company, type and ex-date.
--
-- A company does not declare two cash dividends with the same ex-date, nor
-- two bonus issues. Importing a dividend history is meant to be repeatable —
-- paste a longer table next year and it extends what is stored — and that
-- rests on being able to recognise a row already held. Until now nothing
-- stopped a second copy being written beside the first, which would have
-- double-counted the dividend record and, for a bonus issue, restated every
-- earlier per-share figure twice.
--
-- Actions recorded by fiscal year alone have no ex-date; NULLs stay distinct
-- under a unique index, so those are unaffected.
-- =============================================================================

CREATE UNIQUE INDEX corporate_actions_one_per_ex_date
    ON corporate_actions (company_id, action_type, ex_date);
