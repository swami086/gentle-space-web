BEGIN;

-- Reply token on enquiries
ALTER TABLE adsagent.enquiries
  ADD COLUMN IF NOT EXISTS inbound_reply_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS enquiries_org_inbound_reply_token_uidx
  ON adsagent.enquiries (org_id, inbound_reply_token)
  WHERE inbound_reply_token IS NOT NULL;

-- Durable webhook intake
CREATE TABLE adsagent.inbound_events (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  channel       TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
  external_id   TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processed','failed')),
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  CONSTRAINT inbound_events_external_unique UNIQUE (org_id, channel, external_id)
);

CREATE INDEX inbound_events_pending_idx
  ON adsagent.inbound_events (created_at)
  WHERE status = 'pending';

ALTER TABLE adsagent.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.inbound_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.inbound_events
  USING (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Outbox topic vocabulary (must match OUTBOX_TOPICS)
ALTER TABLE context.outbox_events DROP CONSTRAINT IF EXISTS outbox_events_topic_check;
ALTER TABLE context.outbox_events
  ADD CONSTRAINT outbox_events_topic_check CHECK (topic IN (
    'enquiry.received','enquiry.activity_logged','graph.tenant_stale',
    'agent.task_requested','reminder.due','deletion.requested',
    'portal.event','inbound.message_received'));

-- Artifact content type
ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_content_type_check;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_content_type_check CHECK (content_type IN
    ('talking_points','draft','context_pack','trace_payload','call_recording','inbound_media'));

COMMIT;
