CREATE TABLE adsagent.listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          public.org_ref NOT NULL REFERENCES public.orgs(id),
  approver_phone  TEXT NOT NULL,
  market          TEXT NOT NULL CHECK (market IN ('IN', 'AU')),
  sector          TEXT NOT NULL CHECK (sector IN ('residential', 'commercial_office')),
  facts           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE adsagent.listing_ceilings (
  listing_id     UUID NOT NULL REFERENCES adsagent.listings(id),
  platform       TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
  ceiling_minor  BIGINT NOT NULL CHECK (ceiling_minor >= 0),
  PRIMARY KEY (listing_id, platform)
);

CREATE TABLE adsagent.listing_shares (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            UUID NOT NULL REFERENCES adsagent.listings(id),
  platform              TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
  external_campaign_id  TEXT,
  external_ad_set_id    TEXT,
  budget_minor          BIGINT NOT NULL CHECK (budget_minor >= 0),
  spend_minor           BIGINT NOT NULL DEFAULT 0 CHECK (spend_minor >= 0),
  lead_count            INT NOT NULL DEFAULT 0 CHECK (lead_count >= 0),
  last_share_move_on    DATE,
  CHECK (platform = 'meta' OR external_ad_set_id IS NULL)
);

CREATE TABLE adsagent.listing_build_steps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id            UUID NOT NULL REFERENCES adsagent.listing_shares(id),
  object_kind         TEXT NOT NULL,
  external_object_id  TEXT NOT NULL
);

ALTER TABLE adsagent.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.listings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.listings;
CREATE POLICY tenant_isolation ON adsagent.listings
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.listing_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.listing_ceilings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.listing_ceilings;
CREATE POLICY tenant_isolation ON adsagent.listing_ceilings
  USING (
    EXISTS (
      SELECT 1
        FROM adsagent.listings l
       WHERE l.id = listing_id
         AND (l.org_id = public.current_tenant() OR public.is_platform_read())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM adsagent.listings l
       WHERE l.id = listing_id
         AND l.org_id = public.current_tenant()
    )
  );

ALTER TABLE adsagent.listing_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.listing_shares FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.listing_shares;
CREATE POLICY tenant_isolation ON adsagent.listing_shares
  USING (
    EXISTS (
      SELECT 1
        FROM adsagent.listings l
       WHERE l.id = listing_id
         AND (l.org_id = public.current_tenant() OR public.is_platform_read())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM adsagent.listings l
       WHERE l.id = listing_id
         AND l.org_id = public.current_tenant()
    )
  );

ALTER TABLE adsagent.listing_build_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.listing_build_steps FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.listing_build_steps;
CREATE POLICY tenant_isolation ON adsagent.listing_build_steps
  USING (
    EXISTS (
      SELECT 1
        FROM adsagent.listing_shares s
        JOIN adsagent.listings l ON l.id = s.listing_id
       WHERE s.id = share_id
         AND (l.org_id = public.current_tenant() OR public.is_platform_read())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM adsagent.listing_shares s
        JOIN adsagent.listings l ON l.id = s.listing_id
       WHERE s.id = share_id
         AND l.org_id = public.current_tenant()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON adsagent.listings TO adsagent_rw;
GRANT SELECT ON adsagent.listings TO agent_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON adsagent.listing_ceilings TO adsagent_rw;
GRANT SELECT ON adsagent.listing_ceilings TO agent_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON adsagent.listing_shares TO adsagent_rw;
GRANT SELECT ON adsagent.listing_shares TO agent_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON adsagent.listing_build_steps TO adsagent_rw;
GRANT SELECT ON adsagent.listing_build_steps TO agent_ro;
