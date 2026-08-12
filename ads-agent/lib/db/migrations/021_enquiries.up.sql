BEGIN;

CREATE TABLE adsagent.enquiries (
  id                    UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id                public.org_ref NOT NULL REFERENCES public.orgs(id),

  -- The enquiry references the local contact row, never a Twenty person id:
  -- Twenty's dedup can merge a person and invalidate its ids, and that
  -- breakage must stay in one table (TW5).
  contact_id            UUID REFERENCES adsagent.contacts(id),

  -- A projection reference, not a key. Unique per org, not globally: every org
  -- has its own Twenty instance issuing its own ids.
  twenty_opportunity_id TEXT,
  CONSTRAINT enquiries_twenty_opportunity_unique UNIQUE (org_id, twenty_opportunity_id),

  listing_id            UUID REFERENCES listings.listings(id),
  listing_url           TEXT,   -- as captured, before resolution

  -- No FK: public.corridors arrives at S7. The column exists now so S7 is one
  -- ADD CONSTRAINT rather than a table rewrite.
  corridor_id           UUID,

  -- Deliberately separate from Twenty's pipeline stage: that is a deal stage,
  -- this is "does this need me today".
  reply_state           TEXT NOT NULL DEFAULT 'waiting'
                          CHECK (reply_state IN ('waiting','called','closed')),

  -- The immutable as-captured submission. adsagent.contacts holds the
  -- Twenty-reconciled cache; these two are not duplicates of each other.
  -- Encryption at rest is owed (data model §6.3, open question 12.1).
  contact_name          TEXT,
  contact_phone         TEXT,
  contact_email         TEXT,

  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  lifecycle             public.lifecycle_state NOT NULL DEFAULT 'active',
  suppressed_at         TIMESTAMPTZ,
  erase_after           DATE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX enquiries_org_activity_idx
  ON adsagent.enquiries (org_id, last_activity_at DESC)
  WHERE lifecycle = 'active';

CREATE INDEX enquiries_org_state_idx
  ON adsagent.enquiries (org_id, reply_state, last_activity_at DESC)
  WHERE lifecycle = 'active';

CREATE INDEX enquiries_org_listing_idx ON adsagent.enquiries (org_id, listing_id);

CREATE INDEX enquiries_org_contact_idx ON adsagent.enquiries (org_id, contact_id);

CREATE INDEX enquiries_erase_idx ON adsagent.enquiries (org_id, erase_after)
  WHERE lifecycle = 'suppressed';

ALTER TABLE adsagent.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiries FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiries
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY cross_tenant_read ON adsagent.enquiries
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
