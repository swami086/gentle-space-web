BEGIN;

CREATE TABLE context.twenty_connections (
  org_id               public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  base_url             TEXT NOT NULL,

  -- A pointer into the secret store, never the key itself, so this table is
  -- safe to back up and read and open question B4 can be settled later
  -- without a schema change (tenancy spec §5).
  api_key_ref          TEXT NOT NULL,

  coolify_service_uuid TEXT NOT NULL UNIQUE,

  -- N instances drift. The client must know what it is talking to.
  twenty_version       TEXT NOT NULL,

  state                TEXT NOT NULL CHECK (state IN
                         ('provisioning','active','suspended','deprovisioned','failed')),
  provisioned_at       TIMESTAMPTZ,
  last_sync_at         TIMESTAMPTZ,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX twenty_connections_state_idx ON context.twenty_connections (state)
  WHERE state <> 'active';

ALTER TABLE context.twenty_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.twenty_connections FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.twenty_connections
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The coverage check and the projection worker read every org's row. Read-only
-- and audited, same declared-actor pattern as adsagent.contacts.
CREATE POLICY cross_tenant_read ON context.twenty_connections
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
