BEGIN;

-- Append-only. This is what Twenty cannot hold: custom timeline events cannot
-- be created through its API, and phone calls specifically cannot be recorded.
CREATE TABLE adsagent.enquiry_activities (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id     UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  kind           TEXT NOT NULL CHECK (kind IN ('call','note','state_change','reminder_set')),
  actor_user_id  UUID REFERENCES public.users(id),

  -- Call fields, NULL for other kinds. A fixed vocabulary, not free text, so
  -- it can drive reporting (C2).
  call_outcome   TEXT CHECK (call_outcome IN
                   ('spoke_interested','spoke_not_interested','no_answer',
                    'voicemail','wrong_number','callback_requested')),
  call_direction TEXT CHECK (call_direction IN ('outgoing','incoming')),
  call_seconds   INTEGER CHECK (call_seconds >= 0),
  occurred_at    TIMESTAMPTZ NOT NULL,

  body           TEXT,
  synced_to_twenty_at TIMESTAMPTZ,   -- Notes API write-back (C7)

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A call row without an outcome would be a call nobody can report on.
  CONSTRAINT enquiry_activities_call_shape CHECK (
    kind <> 'call' OR (call_outcome IS NOT NULL AND call_direction IS NOT NULL)
  )
);

CREATE INDEX enquiry_activities_org_enquiry_idx
  ON adsagent.enquiry_activities (org_id, enquiry_id, occurred_at DESC);

-- The projection worker's only query. Partial, so it stays small as the log grows.
CREATE INDEX enquiry_activities_unsynced_idx
  ON adsagent.enquiry_activities (created_at)
  WHERE synced_to_twenty_at IS NULL AND kind IN ('call','note');

ALTER TABLE adsagent.enquiry_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_activities FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_activities
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY cross_tenant_read ON adsagent.enquiry_activities
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
