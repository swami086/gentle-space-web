BEGIN;

COMMENT ON SCHEMA derived IS
  'Quarantine (dataflow review A-5). Tables projected into Postgres from observational '
  'stores. Every table here is truncatable and rebuildable at any time, is never the '
  'input to another derivation, and must never be the sole justification for a proposal. '
  'A table in derived is a convenience, not a record.';

CREATE TABLE IF NOT EXISTS derived.portal_session_spaces (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  session_id     TEXT NOT NULL,
  listing_ref    TEXT NOT NULL,
  view_count     INTEGER NOT NULL DEFAULT 0,
  dwell_seconds  INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ NOT NULL,
  rebuilt_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- listing_ref is deliberately TEXT with no foreign key into listings.listings: a
-- derived row must never be able to block or cascade a delete in a source of truth.
ALTER TABLE derived.portal_session_spaces
  DROP CONSTRAINT IF EXISTS portal_session_spaces_unique;
ALTER TABLE derived.portal_session_spaces
  ADD CONSTRAINT portal_session_spaces_unique UNIQUE (org_id, session_id, listing_ref);

CREATE INDEX IF NOT EXISTS portal_session_spaces_org_session_idx
  ON derived.portal_session_spaces (org_id, session_id, last_viewed_at DESC);

ALTER TABLE derived.portal_session_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived.portal_session_spaces FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON derived.portal_session_spaces;
CREATE POLICY tenant_isolation ON derived.portal_session_spaces
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
