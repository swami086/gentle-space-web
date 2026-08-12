BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON context.twenty_connections;
DROP POLICY IF EXISTS tenant_isolation  ON context.twenty_connections;
DROP TABLE IF EXISTS context.twenty_connections;
COMMIT;
