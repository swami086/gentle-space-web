ALTER TABLE adsagent.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaigns FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaigns;
CREATE POLICY tenant_isolation ON adsagent.campaigns
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());
