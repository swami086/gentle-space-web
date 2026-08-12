-- The four billing tables already carried org_id, so they need policies and
-- org_id-leading indexes, not columns.
ALTER TABLE adsagent.org_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.org_balances FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.org_balances;
CREATE POLICY tenant_isolation ON adsagent.org_balances
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.user_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.user_balances FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.user_balances;
CREATE POLICY tenant_isolation ON adsagent.user_balances
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.credit_grants FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.credit_grants;
CREATE POLICY tenant_isolation ON adsagent.credit_grants
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.usage_ledger FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.usage_ledger;
CREATE POLICY tenant_isolation ON adsagent.usage_ledger
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

CREATE INDEX IF NOT EXISTS usage_ledger_org_occurred_idx
  ON adsagent.usage_ledger (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS credit_grants_org_created_idx
  ON adsagent.credit_grants (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_balances_org_idx
  ON adsagent.user_balances (org_id);
