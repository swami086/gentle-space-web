BEGIN;

-- The pseudonymity link (portal spec §5). Composite primary key exactly as declared
-- in the spec's §8 DDL: this is a pure link table and the natural key is the
-- uniqueness constraint that matters.
CREATE TABLE IF NOT EXISTS context.session_links (
  org_id     public.org_ref NOT NULL REFERENCES public.orgs(id),
  session_id TEXT NOT NULL,
  enquiry_id UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id, enquiry_id)
);

CREATE INDEX IF NOT EXISTS session_links_org_enquiry_idx
  ON context.session_links (org_id, enquiry_id);

ALTER TABLE context.session_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.session_links FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.session_links;
CREATE POLICY tenant_isolation ON context.session_links
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
