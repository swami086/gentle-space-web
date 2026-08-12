BEGIN;

CREATE TABLE adsagent.reminders (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id       public.org_ref NOT NULL REFERENCES public.orgs(id),
  -- Nullable: a broker can set a reminder that is not about one enquiry.
  enquiry_id   UUID REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id),

  due_at       TIMESTAMPTZ NOT NULL,
  note         TEXT,
  state        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending','fired','done','cancelled')),
  fired_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drives the Today feed. Partial, so every fired reminder leaves the index and
-- the query stays small no matter how much history accumulates.
CREATE INDEX reminders_due_idx ON adsagent.reminders (org_id, due_at)
  WHERE state = 'pending';
CREATE INDEX reminders_org_user_idx ON adsagent.reminders (org_id, user_id, due_at)
  WHERE state = 'pending';

ALTER TABLE adsagent.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.reminders FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.reminders
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The reminder scheduler fires for every org.
CREATE POLICY cross_tenant_read ON adsagent.reminders
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
