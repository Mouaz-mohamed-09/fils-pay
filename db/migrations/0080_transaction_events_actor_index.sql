-- payPaymentLink's crash repair looks up a link's committed capture by
-- transaction_events.actor_id (the link id capture records as its actor).
-- Indexed so the lookup on every pay attempt is not a full scan.
CREATE INDEX idx_transaction_events_actor_capture
    ON transaction_events (actor_id)
    WHERE event_type IN ('captured', 'partially_captured');
