ALTER TABLE adsagent.performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.performance_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.performance_snapshots;
CREATE POLICY tenant_isolation ON adsagent.performance_snapshots
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.crm_signal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.crm_signal_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.crm_signal_snapshots;
CREATE POLICY tenant_isolation ON adsagent.crm_signal_snapshots
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());
