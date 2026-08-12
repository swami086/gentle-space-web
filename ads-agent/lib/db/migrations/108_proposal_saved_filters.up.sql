-- Owner-scoped saved filters for staff proposal list views (S11 E7).
-- Session user mirrors set_tenant/current_tenant (migration 006).
CREATE OR REPLACE FUNCTION public.set_user(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'set_user called with NULL user_id';
  END IF;
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_app_user()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$;

GRANT EXECUTE ON FUNCTION public.set_user(UUID) TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw;
GRANT EXECUTE ON FUNCTION public.current_app_user() TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw, agent_ro;

CREATE TABLE IF NOT EXISTS adsagent.proposal_saved_filters (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  owner_user_id UUID NOT NULL REFERENCES public.users(id),
  name          TEXT NOT NULL,
  query         JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS proposal_saved_filters_owner_idx
  ON adsagent.proposal_saved_filters (owner_user_id, created_at DESC);

ALTER TABLE adsagent.proposal_saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.proposal_saved_filters FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_isolation ON adsagent.proposal_saved_filters;
CREATE POLICY owner_isolation ON adsagent.proposal_saved_filters
  USING      (owner_user_id = public.current_app_user() OR public.is_platform_read())
  WITH CHECK (owner_user_id = public.current_app_user() AND org_id = public.current_tenant());
