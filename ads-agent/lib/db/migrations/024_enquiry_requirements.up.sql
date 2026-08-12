BEGIN;

-- Current requirement. Revisions carry the audit trail.
CREATE TABLE adsagent.enquiry_requirements (
  enquiry_id          UUID PRIMARY KEY REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  org_id              public.org_ref NOT NULL REFERENCES public.orgs(id),

  desks_min           INTEGER CHECK (desks_min > 0),
  desks_max           INTEGER CHECK (desks_max >= desks_min),
  budget_per_desk_inr NUMERIC(12,2) CHECK (budget_per_desk_inr >= 0),
  move_in_by          DATE,
  must_haves          TEXT[] NOT NULL DEFAULT '{}',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX enquiry_requirements_org_idx ON adsagent.enquiry_requirements (org_id);

-- Extraction proposes; a human confirms. Never auto-applied (C3).
CREATE TABLE adsagent.enquiry_requirement_revisions (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id    UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  source        TEXT NOT NULL CHECK (source IN ('web_form','call_notes','manual','agent')),
  proposed      JSONB NOT NULL,
  applied       BOOLEAN NOT NULL DEFAULT false,
  confirmed_by  UUID REFERENCES public.users(id),
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT requirement_revision_confirmed CHECK (
    applied = false OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

CREATE INDEX req_revision_pending_idx
  ON adsagent.enquiry_requirement_revisions (org_id, enquiry_id)
  WHERE applied = false;

ALTER TABLE adsagent.enquiry_requirements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_requirements          FORCE  ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_requirement_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_requirement_revisions FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_requirements
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY tenant_isolation ON adsagent.enquiry_requirement_revisions
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
