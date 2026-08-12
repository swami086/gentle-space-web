BEGIN;

-- Designed here rather than in the data model: backend spec G1 says "table +
-- endpoints" and gives no DDL. In-app only -- G2 (digest email) is deferred and
-- undecided, so nothing here sends anything and BD2 holds.
CREATE TABLE adsagent.notifications (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id      public.org_ref NOT NULL REFERENCES public.orgs(id),
  user_id     UUID NOT NULL REFERENCES public.users(id),

  kind        TEXT NOT NULL CHECK (kind IN
                ('reminder_due','enquiry_received','no_contact','requirement_extracted')),
  enquiry_id  UUID REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,

  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_unread_idx
  ON adsagent.notifications (org_id, user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX notifications_org_user_idx
  ON adsagent.notifications (org_id, user_id, created_at DESC);

ALTER TABLE adsagent.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.notifications FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.notifications
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
