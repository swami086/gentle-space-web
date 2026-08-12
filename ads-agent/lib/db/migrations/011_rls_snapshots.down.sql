DROP POLICY IF EXISTS tenant_isolation ON adsagent.crm_signal_snapshots;
ALTER TABLE adsagent.crm_signal_snapshots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.crm_signal_snapshots DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.performance_snapshots;
ALTER TABLE adsagent.performance_snapshots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.performance_snapshots DISABLE ROW LEVEL SECURITY;
