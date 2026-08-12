-- ads-agent/lib/db/migrations/020_contacts.up.sql
BEGIN;

CREATE TABLE adsagent.contacts (
  id               UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id           public.org_ref NOT NULL REFERENCES public.orgs(id),

  -- Nullable until the first sync lands. Twenty is authoritative for this id.
  twenty_person_id TEXT,

  -- Cache of Twenty-owned fields (tenancy spec §3). Never edited in place by
  -- product code; overwritten wholesale by sync so a dedup merge wins.
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,

  synced_at        TIMESTAMPTZ,
  sync_state       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (sync_state IN ('pending','synced','failed','merged_away')),
  sync_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (sync_attempts >= 0),
  last_sync_error  TEXT,

  -- Set when Twenty merges this person into another. The row survives as a
  -- tombstone so existing enquiry references keep resolving (TW5).
  merged_into      UUID REFERENCES adsagent.contacts(id),

  -- Suppression from birth. Retrofitting deletion semantics after data exists
  -- is materially harder (build sequence, S4 note).
  lifecycle        public.lifecycle_state NOT NULL DEFAULT 'active',
  suppressed_at    TIMESTAMPTZ,
  erase_after      DATE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT contacts_twenty_person_unique UNIQUE (org_id, twenty_person_id)
);

CREATE INDEX contacts_org_sync_idx ON adsagent.contacts (org_id, sync_state)
  WHERE sync_state <> 'synced';
CREATE INDEX contacts_org_created_idx ON adsagent.contacts (org_id, created_at DESC);
CREATE INDEX contacts_erase_idx ON adsagent.contacts (org_id, erase_after)
  WHERE lifecycle = 'suppressed';

ALTER TABLE adsagent.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.contacts FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.contacts
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The projection worker must find pending rows across every org. Declared,
-- read-only, and audited (see lib/db/cross-tenant.ts). FOR SELECT only, so a
-- cross-tenant session can never write another tenant's row.
CREATE POLICY cross_tenant_read ON adsagent.contacts
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
