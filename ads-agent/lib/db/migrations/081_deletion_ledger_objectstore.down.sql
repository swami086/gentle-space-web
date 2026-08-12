BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_propagations;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_propagations;
DROP TABLE IF EXISTS context.deletion_propagations;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_requests;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_requests;
DROP TABLE IF EXISTS context.deletion_requests;
COMMIT;
