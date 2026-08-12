BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.notifications;
DROP TABLE IF EXISTS adsagent.notifications;
COMMIT;
