BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON context.session_links;
DROP TABLE IF EXISTS context.session_links;
COMMIT;
