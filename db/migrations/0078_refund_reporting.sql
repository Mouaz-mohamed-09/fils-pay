-- FP-300 reporting for refunds.
--
-- 1. merchant_daily_volume gets the refund columns the reporting consumer's
--    refund rollup writes (applyDailySummaryRollup referenced them, but they
--    were never added).
ALTER TABLE merchant_daily_volume
    ADD COLUMN refund_count      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN refund_gross_fils BIGINT  NOT NULL DEFAULT 0;

-- 2. refund_merchant_summary (0072) joined transactions ON t.id = r.id (a
--    refund id against a transaction id), so it was always empty, and nothing
--    refreshed it. It also summed captured_fils once per refund. Replaced by a
--    plain view: always current, no refresh job needed.
DROP MATERIALIZED VIEW IF EXISTS refund_merchant_summary;

CREATE VIEW refund_merchant_summary AS
WITH per_txn AS (
    SELECT r.merchant_id,
           r.transaction_id,
           (r.occurred_at AT TIME ZONE 'Asia/Bahrain')::date AS business_date,
           COUNT(*)                 AS refund_count,
           SUM(r.amount_fils)       AS refunded_fils,
           SUM(r.fee_reversed_fils) AS fee_reversed_fils
      FROM refunds r
     WHERE r.status = 'succeeded'
     GROUP BY r.merchant_id, r.transaction_id, (r.occurred_at AT TIME ZONE 'Asia/Bahrain')::date
)
SELECT p.merchant_id,
       p.business_date,
       SUM(p.refund_count)::bigint AS refund_count,
       SUM(p.refunded_fils)        AS total_refunded_fils,
       SUM(p.fee_reversed_fils)    AS total_fee_reversed_fils,
       SUM(t.captured_fils)        AS original_captured_fils
  FROM per_txn p
  JOIN transactions t ON t.id = p.transaction_id
 GROUP BY p.merchant_id, p.business_date;
