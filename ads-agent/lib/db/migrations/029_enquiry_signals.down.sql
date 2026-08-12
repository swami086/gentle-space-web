BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_signals;
DROP TABLE IF EXISTS adsagent.enquiry_signals;
COMMIT;
