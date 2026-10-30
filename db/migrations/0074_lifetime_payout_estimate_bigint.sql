-- lifetime_net_payout_monitoring_estimate was REAL, fed through Go float32:
-- 24 bits of mantissa, so once a merchant's lifetime payouts pass ~16,777 BD
-- each addition rounds and the figure drifts. Integer fils, like every other
-- money column (ADR-0001).
ALTER TABLE merchants
    ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT
    USING round(lifetime_net_payout_monitoring_estimate)::bigint;
