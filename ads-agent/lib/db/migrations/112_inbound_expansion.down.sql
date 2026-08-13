BEGIN;

-- Restore artifact content type CHECK (080)
ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_content_type_check;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_content_type_check CHECK (content_type IN
    ('talking_points','draft','context_pack','trace_payload','call_recording'));

-- Restore outbox topic CHECK (040)
ALTER TABLE context.outbox_events DROP CONSTRAINT IF EXISTS outbox_events_topic_check;
ALTER TABLE context.outbox_events
  ADD CONSTRAINT outbox_events_topic_check CHECK (topic IN (
    'enquiry.received','enquiry.activity_logged','graph.tenant_stale',
    'agent.task_requested','reminder.due','deletion.requested',
    'portal.event'));

DROP POLICY IF EXISTS tenant_isolation ON adsagent.inbound_events;
DROP TABLE IF EXISTS adsagent.inbound_events;

DROP INDEX IF EXISTS adsagent.enquiries_org_inbound_reply_token_uidx;
ALTER TABLE adsagent.enquiries DROP COLUMN IF EXISTS inbound_reply_token;

COMMIT;
