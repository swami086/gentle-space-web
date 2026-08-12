DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_draft_messages;
ALTER TABLE adsagent.campaign_draft_messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_draft_messages DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_drafts;
ALTER TABLE adsagent.campaign_drafts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_drafts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.proposals;
ALTER TABLE adsagent.proposals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.proposals DISABLE ROW LEVEL SECURITY;
