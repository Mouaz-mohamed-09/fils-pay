-- Additional suspense accounts for future reconciliation lanes.
-- Uses 0007's real columns (id, name, kind); suspense accounts are 'asset',
-- as scheme_rounding_residue is. The original used code/account_type/
-- description and a 'suspense' kind, none of which exist, so it never applied.

INSERT INTO chart_of_accounts (id, name, kind)
VALUES
  ('fx_rounding_difference', 'FX Rounding Difference (suspense)', 'asset'),
  ('chargeback_suspense',    'Chargeback Suspense',               'asset')
ON CONFLICT (id) DO NOTHING;
