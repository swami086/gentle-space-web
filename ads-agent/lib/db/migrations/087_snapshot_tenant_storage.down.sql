BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_storage;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_storage;
DROP TABLE IF EXISTS context.snapshot_storage;
COMMIT;
