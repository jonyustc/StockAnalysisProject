-- =============================================================================
-- System alerts: Web Push notifications when a price target is reached.
--
-- A subscription is one browser on one device that has agreed to receive
-- notifications. Its endpoint is a URL at the browser vendor's push service
-- and its keys encrypt what is sent, so only that browser can read it — the
-- push service sees an opaque blob. None of it is a password or a login.
-- =============================================================================

CREATE TABLE push_subscriptions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpoint        text NOT NULL UNIQUE,
    p256dh          text NOT NULL,
    auth            text NOT NULL,
    /* Which device, in words, so a list of them means something. */
    label           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_sent_at    timestamptz,
    /* Consecutive failures; a subscription the browser has dropped is removed. */
    failures        integer NOT NULL DEFAULT 0
);

-- One alert per crossing, not one a day for as long as a target stays
-- reached: the date an alert went out for each side, cleared when the price
-- moves back so the next crossing alerts again.
ALTER TABLE price_targets
    ADD COLUMN buy_alerted_on  date,
    ADD COLUMN sell_alerted_on date;
