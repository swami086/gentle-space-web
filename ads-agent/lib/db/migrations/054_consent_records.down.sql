BEGIN;
DROP TRIGGER IF EXISTS consent_records_notify ON context.consent_records;
DROP TRIGGER IF EXISTS consent_records_append_only ON context.consent_records;
DROP FUNCTION IF EXISTS context.notify_consent_change();
DROP FUNCTION IF EXISTS context.reject_consent_mutation();
DROP POLICY IF EXISTS tenant_isolation ON context.consent_records;
DROP TABLE IF EXISTS context.consent_records;
COMMIT;
