BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifact_dangling_flags;
DROP POLICY IF EXISTS tenant_isolation ON context.artifact_dangling_flags;
DROP TABLE IF EXISTS context.artifact_dangling_flags;
DROP TABLE IF EXISTS context.artifact_sweep_runs;
COMMIT;
