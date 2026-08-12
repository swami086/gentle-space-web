BEGIN;
DROP POLICY IF EXISTS ingest_key_lookup ON context.tenant_portal_config;
DROP POLICY IF EXISTS tenant_isolation ON context.tenant_portal_config;
DROP TABLE IF EXISTS context.tenant_portal_config;
COMMIT;
