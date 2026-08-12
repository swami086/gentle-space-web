DROP INDEX IF EXISTS adsagent.user_balances_org_idx;
DROP INDEX IF EXISTS adsagent.credit_grants_org_created_idx;
DROP INDEX IF EXISTS adsagent.usage_ledger_org_occurred_idx;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.usage_ledger;
ALTER TABLE adsagent.usage_ledger NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.usage_ledger DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.credit_grants;
ALTER TABLE adsagent.credit_grants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.credit_grants DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.user_balances;
ALTER TABLE adsagent.user_balances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.user_balances DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.org_balances;
ALTER TABLE adsagent.org_balances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.org_balances DISABLE ROW LEVEL SECURITY;
