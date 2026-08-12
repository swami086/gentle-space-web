BEGIN;
DROP POLICY IF EXISTS cross_tenant_read  ON adsagent.contacts;
DROP POLICY IF EXISTS tenant_isolation   ON adsagent.contacts;
DROP TABLE IF EXISTS adsagent.contacts;
COMMIT;
