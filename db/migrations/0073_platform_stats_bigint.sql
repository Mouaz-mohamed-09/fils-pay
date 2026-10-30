-- total_processed_fils was INTEGER (max 2,147,483,647 fils) while the
-- volume-tier threshold is 2,000,000,000 fils, so the counter would overflow
-- shortly after the tier flips. Money columns are BIGINT (ADR-0001).
ALTER TABLE platform_stats
    ALTER COLUMN total_processed_fils TYPE BIGINT;
