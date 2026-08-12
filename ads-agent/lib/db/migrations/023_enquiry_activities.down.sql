BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON adsagent.enquiry_activities;
DROP POLICY IF EXISTS tenant_isolation  ON adsagent.enquiry_activities;
DROP TABLE IF EXISTS adsagent.enquiry_activities;
COMMIT;
