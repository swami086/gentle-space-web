BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_messages;
DROP TABLE IF EXISTS adsagent.enquiry_messages;
COMMIT;
