-- Replaces ai_action_log, which had three columns, no org_id, and no way to
-- record who acted. ai_action_log is retained in place and unread; it is
-- dropped in a later cleanup once this table is proven, which keeps this
-- migration reversible.
CREATE TABLE IF NOT EXISTS adsagent.audit_log (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('human','agent','system')),
  actor_user_id UUID REFERENCES public.users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  before        JSONB,
  after         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The point of the table: a human action cannot be recorded without naming
-- the human.
ALTER TABLE adsagent.audit_log DROP CONSTRAINT IF EXISTS audit_actor_present;
ALTER TABLE adsagent.audit_log ADD CONSTRAINT audit_actor_present
  CHECK (actor_type <> 'human' OR actor_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS audit_log_org_time_idx
  ON adsagent.audit_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_org_entity_idx
  ON adsagent.audit_log (org_id, entity_type, entity_id);

ALTER TABLE adsagent.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.audit_log FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.audit_log;
CREATE POLICY tenant_isolation ON adsagent.audit_log
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT ON adsagent.audit_log TO adsagent_rw;
GRANT SELECT ON adsagent.audit_log TO agent_ro;
-- Append-only by grant as well as by convention: no UPDATE, no DELETE.
