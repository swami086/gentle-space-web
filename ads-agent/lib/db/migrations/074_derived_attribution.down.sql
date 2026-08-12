BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON derived.attribution_reconciliation;
DROP POLICY IF EXISTS tenant_isolation ON derived.corridor_attribution_daily;
DROP INDEX IF EXISTS derived.attribution_reconciliation_org_window_idx;
DROP INDEX IF EXISTS derived.corridor_attribution_org_window_idx;
DROP TABLE IF EXISTS derived.attribution_reconciliation;
DROP TABLE IF EXISTS derived.corridor_attribution_daily;
COMMIT;
