-- Data model §0: org_id on every domain table, no exceptions -- a table without
-- it cannot carry an RLS policy, and a child table reachable by a query that
-- names it directly is not protected by its parent's policy. This overrides
-- tenancy spec §2a, which left the three child tables without the column.
-- Order matters: add nullable, backfill, then constrain.
ALTER TABLE adsagent.campaigns              ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.proposals              ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.campaign_drafts        ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.campaign_draft_messages ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.performance_snapshots  ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.crm_signal_snapshots   ADD COLUMN IF NOT EXISTS org_id public.org_ref;

-- The seeded internal org owns every existing row.
UPDATE adsagent.campaigns       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE adsagent.proposals       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE adsagent.campaign_drafts SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- Children inherit from their parent, which is the authoritative owner.
UPDATE adsagent.campaign_draft_messages m
   SET org_id = d.org_id
  FROM adsagent.campaign_drafts d
 WHERE d.id = m.draft_id AND m.org_id IS NULL;
UPDATE adsagent.performance_snapshots s
   SET org_id = c.org_id
  FROM adsagent.campaigns c
 WHERE c.id = s.campaign_id AND s.org_id IS NULL;
UPDATE adsagent.crm_signal_snapshots s
   SET org_id = c.org_id
  FROM adsagent.campaigns c
 WHERE c.id = s.campaign_id AND s.org_id IS NULL;

-- crm_signal_snapshots.campaign_id is nullable, so an orphan cannot inherit.
UPDATE adsagent.crm_signal_snapshots
   SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

ALTER TABLE adsagent.campaigns              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.proposals              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.campaign_drafts        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.campaign_draft_messages ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.performance_snapshots  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.crm_signal_snapshots   ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE adsagent.campaigns              ADD CONSTRAINT campaigns_org_fk              FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.proposals              ADD CONSTRAINT proposals_org_fk              FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.campaign_drafts        ADD CONSTRAINT campaign_drafts_org_fk        FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.campaign_draft_messages ADD CONSTRAINT campaign_draft_messages_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.performance_snapshots  ADD CONSTRAINT performance_snapshots_org_fk  FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.crm_signal_snapshots   ADD CONSTRAINT crm_signal_snapshots_org_fk   FOREIGN KEY (org_id) REFERENCES public.orgs(id);

-- Every index leads with org_id. A missing leading-edge tenant index quietly
-- destroys customer-facing query latency at scale (data model §0).
CREATE INDEX IF NOT EXISTS campaigns_org_created_idx
  ON adsagent.campaigns (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS proposals_org_status_idx
  ON adsagent.proposals (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_drafts_org_created_idx
  ON adsagent.campaign_drafts (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_draft_messages_org_draft_idx
  ON adsagent.campaign_draft_messages (org_id, draft_id, created_at ASC);
CREATE INDEX IF NOT EXISTS performance_snapshots_org_campaign_idx
  ON adsagent.performance_snapshots (org_id, campaign_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS crm_signal_snapshots_org_captured_idx
  ON adsagent.crm_signal_snapshots (org_id, captured_at DESC);
