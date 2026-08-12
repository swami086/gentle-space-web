DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaigns;
ALTER TABLE adsagent.campaigns NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaigns DISABLE ROW LEVEL SECURITY;
