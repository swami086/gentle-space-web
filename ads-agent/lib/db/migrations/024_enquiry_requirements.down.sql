BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_requirement_revisions;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_requirements;
DROP TABLE IF EXISTS adsagent.enquiry_requirement_revisions;
DROP TABLE IF EXISTS adsagent.enquiry_requirements;
COMMIT;
