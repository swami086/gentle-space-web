DROP INDEX IF EXISTS adsagent.crm_signal_snapshots_org_captured_idx;
DROP INDEX IF EXISTS adsagent.performance_snapshots_org_campaign_idx;
DROP INDEX IF EXISTS adsagent.campaign_draft_messages_org_draft_idx;
DROP INDEX IF EXISTS adsagent.campaign_drafts_org_created_idx;
DROP INDEX IF EXISTS adsagent.proposals_org_status_idx;
DROP INDEX IF EXISTS adsagent.campaigns_org_created_idx;

ALTER TABLE adsagent.crm_signal_snapshots   DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.performance_snapshots  DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.campaign_draft_messages DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.campaign_drafts        DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.proposals              DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.campaigns              DROP COLUMN IF EXISTS org_id;
