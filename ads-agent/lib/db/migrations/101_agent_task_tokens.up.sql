-- Task tokens bind (task_id, profile, org_id) plus the profile's tool allowlist,
-- so the token scopes intent as well as tenant (validation report F-25).
-- Opaque and server-side, therefore revocable — the resolution of agent spec
-- open question 1 in favour of the revocable option.
BEGIN;

CREATE TABLE IF NOT EXISTS context.agent_task_tokens (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         UUID NOT NULL REFERENCES public.orgs(id),
  task_id        TEXT NOT NULL,
  profile        TEXT NOT NULL,
  -- sha256 of the token. The token itself is never stored and never logged.
  token_sha256   BYTEA NOT NULL,
  tool_allowlist TEXT[] NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ
);

ALTER TABLE context.agent_task_tokens
  ADD CONSTRAINT agent_task_tokens_sha_unique UNIQUE (token_sha256);
ALTER TABLE context.agent_task_tokens
  ADD CONSTRAINT agent_task_tokens_allowlist_nonempty CHECK (cardinality(tool_allowlist) > 0);

CREATE INDEX IF NOT EXISTS agent_task_tokens_org_task_idx
  ON context.agent_task_tokens (org_id, task_id);
CREATE INDEX IF NOT EXISTS agent_task_tokens_org_expiry_idx
  ON context.agent_task_tokens (org_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE context.agent_task_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.agent_task_tokens FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.agent_task_tokens
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Token lookup happens BEFORE a tenant is known -- deriving the tenant is the
-- whole point of the lookup -- so a tenant-scoped policy cannot serve it. This
-- second policy opens the table only while a transaction-local flag is set,
-- and only the SECURITY DEFINER function below sets it. agent_ro is granted no
-- SELECT on this table, so the grant, not the flag, is the boundary.
CREATE POLICY token_lookup ON context.agent_task_tokens
  FOR SELECT
  USING (current_setting('app.token_lookup', true) = 'on');

CREATE OR REPLACE FUNCTION context.verify_agent_task_token(p_token_sha256 BYTEA)
RETURNS TABLE (org_id UUID, task_id TEXT, profile TEXT, tool_allowlist TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = context, public
AS $$
BEGIN
  PERFORM set_config('app.token_lookup', 'on', true);
  RETURN QUERY
    SELECT t.org_id, t.task_id, t.profile, t.tool_allowlist
    FROM context.agent_task_tokens t
    WHERE t.token_sha256 = p_token_sha256
      AND t.revoked_at IS NULL
      AND t.expires_at > now();
END
$$;

REVOKE ALL ON FUNCTION context.verify_agent_task_token(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION context.verify_agent_task_token(BYTEA) TO agent_ro;

COMMIT;
