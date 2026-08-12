BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifacts;
DROP POLICY IF EXISTS tenant_isolation ON context.artifacts;
DROP TABLE IF EXISTS context.artifacts;
COMMIT;
