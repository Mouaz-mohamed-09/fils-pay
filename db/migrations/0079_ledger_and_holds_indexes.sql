-- Load testing found every checkout scanning the whole ledger:
-- pg_stat_user_tables showed ledger_entries with ~27k sequential scans
-- reading ~376M rows and zero index scans after ~7k checkouts.
--
-- * 0007's balance trigger runs per inserted leg and sums
--   WHERE entry_group_id = ..., with no index on entry_group_id: four full
--   scans per capture, so checkout cost grew with total ledger size.
-- * discountAdjustment.ts and the refund fee lookup filter ledger_entries by
--   transaction_id; capture/void release holds by transaction_id. Neither
--   column was indexed.
CREATE INDEX idx_ledger_entries_entry_group ON ledger_entries (entry_group_id);
CREATE INDEX idx_ledger_entries_transaction ON ledger_entries (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX idx_holds_transaction ON holds (transaction_id);
