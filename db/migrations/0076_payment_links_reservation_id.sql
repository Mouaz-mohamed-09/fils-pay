-- Incident 2026-05-14: a reservation had no owner, so a request whose
-- reservation had lapsed and been re-claimed could finalize (or release)
-- the other request's reservation, and both buyers were charged. Each claim
-- now stamps its own reservation_id, and renew/finalize/release match on it.
ALTER TABLE payment_links ADD COLUMN reservation_id UUID;
