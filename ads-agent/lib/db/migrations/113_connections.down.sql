DROP POLICY IF EXISTS tenant_isolation ON adsagent.connections;
DROP INDEX IF EXISTS adsagent.connections_one_current;
DROP TABLE IF EXISTS adsagent.connections;
