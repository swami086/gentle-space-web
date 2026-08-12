BEGIN;
DROP POLICY IF EXISTS cross_tenant_audit ON context.access_log;
DROP POLICY IF EXISTS tenant_isolation   ON context.access_log;
DROP POLICY IF EXISTS cross_tenant_read  ON context.deletion_requests;
DROP POLICY IF EXISTS tenant_isolation   ON context.deletion_requests;
DROP TABLE IF EXISTS context.access_log;
DROP TABLE IF EXISTS context.deletion_propagations;
DROP TABLE IF EXISTS context.deletion_requests;
COMMIT;
