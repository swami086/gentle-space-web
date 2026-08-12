-- ENABLE is not enough: table owners ignore row security unless it is FORCEd
-- (validation F-20). WITH CHECK matters as much as USING: without it a tenant
-- can write rows carrying another tenant's org_id.
ALTER TABLE adsagent.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.proposals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.proposals;
CREATE POLICY tenant_isolation ON adsagent.proposals
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.campaign_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_drafts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_drafts;
CREATE POLICY tenant_isolation ON adsagent.campaign_drafts
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.campaign_draft_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_draft_messages FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_draft_messages;
CREATE POLICY tenant_isolation ON adsagent.campaign_draft_messages
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());
