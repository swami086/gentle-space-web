BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON adsagent.enquiries;
DROP POLICY IF EXISTS tenant_isolation  ON adsagent.enquiries;
DROP TABLE IF EXISTS adsagent.enquiries;
COMMIT;
