BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON derived.portal_session_spaces;
DROP TABLE IF EXISTS derived.portal_session_spaces;
COMMENT ON SCHEMA derived IS NULL;
COMMIT;
