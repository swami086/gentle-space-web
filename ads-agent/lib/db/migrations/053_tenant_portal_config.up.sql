BEGIN;

CREATE TABLE IF NOT EXISTS context.tenant_portal_config (
  org_id           public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  ingest_key       TEXT NOT NULL UNIQUE,        -- public identifier, embedded in a page, not a secret
  allowed_origins  TEXT[] NOT NULL DEFAULT '{}',
  purposes_offered TEXT[] NOT NULL DEFAULT '{}',
  notice_version   INTEGER NOT NULL DEFAULT 1,
  notice_copy      JSONB NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expressed as ALTER: a constraint written inside the CREATE TABLE body above never
-- reaches a database where the table already exists.
ALTER TABLE context.tenant_portal_config
  DROP CONSTRAINT IF EXISTS tenant_portal_config_purposes_in_catalogue;
ALTER TABLE context.tenant_portal_config
  ADD CONSTRAINT tenant_portal_config_purposes_in_catalogue CHECK (
    purposes_offered <@ ARRAY['site_analytics','space_recommendation','enquiry_handling']::TEXT[]
  );

ALTER TABLE context.tenant_portal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.tenant_portal_config FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.tenant_portal_config;
CREATE POLICY tenant_isolation ON context.tenant_portal_config
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The ingest edge resolves an unauthenticated public key to a tenant, so it must read
-- this table before any tenant context exists. That single lookup runs as the
-- platform-scope role and is the only cross-tenant read of this table.
DROP POLICY IF EXISTS ingest_key_lookup ON context.tenant_portal_config;
CREATE POLICY ingest_key_lookup ON context.tenant_portal_config
  FOR SELECT TO adsagent_rw
  USING (public.current_tenant() IS NULL);

COMMIT;
