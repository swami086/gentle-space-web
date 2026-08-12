BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON adsagent.reminders;
DROP POLICY IF EXISTS tenant_isolation  ON adsagent.reminders;
DROP TABLE IF EXISTS adsagent.reminders;
COMMIT;
