BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_leases;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_leases;
DROP TABLE IF EXISTS context.snapshot_leases;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_snapshots;
DROP POLICY IF EXISTS tenant_isolation ON context.graph_snapshots;
DROP TABLE IF EXISTS context.graph_snapshots;
COMMIT;
