BEGIN;

-- Derived and rebuildable from adsagent.enquiry_messages. It lives in
-- `adsagent` and not `derived` because its input is a business fact in
-- Postgres, not observational clickstream -- the `derived` quarantine is for
-- data projected back from ClickHouse.
CREATE TABLE adsagent.enquiry_signals (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id       public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id   UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  kind         TEXT NOT NULL CHECK (kind IN
                 ('asked_about_pricing','asked_about_availability',
                  'mentioned_timeline','mentioned_competitor')),
  occurrences  INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  last_seen_at TIMESTAMPTZ NOT NULL,
  derived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT enquiry_signals_unique UNIQUE (org_id, enquiry_id, kind)
);

CREATE INDEX enquiry_signals_org_enquiry_idx
  ON adsagent.enquiry_signals (org_id, enquiry_id, occurrences DESC);

ALTER TABLE adsagent.enquiry_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_signals FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_signals
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
