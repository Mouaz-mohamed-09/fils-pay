-- Incident 2026-08-21: EnqueuePayoutNotifications guards with NOT EXISTS
-- and then INSERTs, so two overlapping runs (daemon tick + run-batch) both
-- passed the guard and each enqueued settlement.paid. The unique index the
-- code comment relied on never existed.
--
-- Historical duplicates are already referenced by webhook_deliveries and the
-- reporting cursor, so they are left in place: the index covers only rows
-- after the current maximum id.
DO $$
DECLARE
  floor_id BIGINT;
BEGIN
  SELECT COALESCE(max(id), 0) INTO floor_id FROM outbox_events;
  EXECUTE format(
    'CREATE UNIQUE INDEX uq_outbox_settlement_paid_batch ON outbox_events (aggregate_id) '
    'WHERE event_type = %L AND id > %s',
    'settlement.paid', floor_id);
END $$;
