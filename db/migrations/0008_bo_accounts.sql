-- =============================================================================
-- BO accounts.
--
-- Every DSE holding sits in a specific Beneficiary Owner account at CDBL, and
-- the account is not a label — it is a boundary. Shares bought in one BO
-- account cannot be sold from another, each account can sit with a different
-- broker at a different commission rate, and a dividend is credited to the
-- account that held the shares on the record date.
--
-- So cost basis is computed per account, per stock. A combined view across
-- accounts is a sum of those, never a single pooled average — pooling would
-- let a sale in one account be matched against cheaper shares in another and
-- report a gain that did not happen.
-- =============================================================================

CREATE TABLE bo_accounts (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    /* What you call it, e.g. "Personal — LankaBangla". */
    name        text NOT NULL UNIQUE,

    /*
     * The 16-digit CDBL BO ID. Optional, and only for reconciling against CDBL
     * statements. Note that anything stored here also goes into the nightly
     * backup on the private repo.
     */
    bo_number   text,
    broker      text,

    is_active   boolean NOT NULL DEFAULT true,
    notes       text,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT bo_accounts_bo_number_format
        CHECK (bo_number IS NULL OR bo_number ~ '^[0-9]{16}$')
);

CREATE UNIQUE INDEX bo_accounts_bo_number_unique
    ON bo_accounts (bo_number)
    WHERE bo_number IS NOT NULL;

CREATE TRIGGER bo_accounts_set_updated_at
    BEFORE UPDATE ON bo_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Attach every transaction to an account. Nullable first so an existing
-- ledger can be backfilled; if any rows already exist they are assigned to a
-- placeholder account you can rename, rather than being rejected.
ALTER TABLE portfolio_transactions
    ADD COLUMN bo_account_id smallint REFERENCES bo_accounts(id) ON DELETE RESTRICT;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM portfolio_transactions WHERE bo_account_id IS NULL) THEN
        INSERT INTO bo_accounts (name, notes)
        VALUES ('Unassigned', 'Created by migration 0008 for transactions recorded before accounts existed. Rename it, or move the transactions.')
        ON CONFLICT (name) DO NOTHING;

        UPDATE portfolio_transactions
           SET bo_account_id = (SELECT id FROM bo_accounts WHERE name = 'Unassigned')
         WHERE bo_account_id IS NULL;
    END IF;
END $$;

ALTER TABLE portfolio_transactions
    ALTER COLUMN bo_account_id SET NOT NULL;

CREATE INDEX portfolio_transactions_account_idx
    ON portfolio_transactions (bo_account_id, company_id, trade_date);
