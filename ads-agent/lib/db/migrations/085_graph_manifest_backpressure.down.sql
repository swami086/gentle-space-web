BEGIN;
DROP TABLE IF EXISTS context.rebuild_slots;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_manifests;
DROP POLICY IF EXISTS tenant_isolation ON context.graph_manifests;
DROP INDEX IF EXISTS context.graph_manifests_claimable_idx;
ALTER TABLE context.graph_manifests
  DROP COLUMN IF EXISTS cdc_lag_seconds,
  DROP COLUMN IF EXISTS source_watermark,
  DROP COLUMN IF EXISTS last_user_activity_at,
  DROP COLUMN IF EXISTS generation,
  DROP COLUMN IF EXISTS attempts;
COMMIT;
