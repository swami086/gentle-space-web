CREATE TABLE adsagent.connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               public.org_ref NOT NULL REFERENCES public.orgs(id),
  platform             TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
  external_account_id  TEXT NOT NULL,
  environment          TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  credentials_sealed   BYTEA NOT NULL,
  can_write            BOOLEAN NOT NULL DEFAULT false,
  can_activate         BOOLEAN NOT NULL DEFAULT false,
  allowlist            TEXT[] NOT NULL DEFAULT '{}',
  currency             TEXT NOT NULL,
  time_zone            TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('current', 'revoked')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX connections_one_current
  ON adsagent.connections (platform, external_account_id)
  WHERE status = 'current';

ALTER TABLE adsagent.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.connections FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.connections;
CREATE POLICY tenant_isolation ON adsagent.connections
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON adsagent.connections TO adsagent_rw;
GRANT SELECT ON adsagent.connections TO agent_ro;
