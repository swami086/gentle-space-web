-- S5a: the transactional outbox. Data model §5a, datastore spec §14.1.
-- Every object schema-qualified: search_path leads with ag_catalog, so an
-- unqualified CREATE TABLE lands inside the AGE extension's schema.
BEGIN;

CREATE TABLE context.outbox_events (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),   -- also the consumer idempotency key
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),

  topic         TEXT NOT NULL CONSTRAINT outbox_events_topic_check CHECK (topic IN (
                  'enquiry.received','enquiry.activity_logged','graph.tenant_stale',
                  'agent.task_requested','reminder.due','deletion.requested',
                  'portal.event')),
  payload       JSONB NOT NULL,
  ordering_key  TEXT NOT NULL,          -- org_id::text; per-tenant ordering, never global

  published_at  TIMESTAMPTZ,            -- NULL = awaiting the relay
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The relay's only query. Partial index stays small no matter how much history
-- accumulates. Deliberate exception to "every index leads with org_id": the
-- relay is cross-tenant by design and an org_id-leading index cannot serve
-- "oldest unpublished across all tenants".
CREATE INDEX outbox_events_unpublished_idx
  ON context.outbox_events (created_at)
  WHERE published_at IS NULL;

-- Tenant-scoped reads (a broker inspecting their own event history, the
-- retention prune, the health view per org) get the org-leading index.
CREATE INDEX outbox_events_org_created_idx
  ON context.outbox_events (org_id, created_at);

ALTER TABLE context.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.outbox_events FORCE  ROW LEVEL SECURITY;

-- WITH CHECK as well as USING: USING alone lets a tenant write rows carrying
-- another tenant's org_id.
CREATE POLICY tenant_isolation ON context.outbox_events
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

GRANT USAGE ON SCHEMA context TO adsagent_rw, listings_rw, context_rw, shared_rw;
GRANT SELECT, INSERT ON context.outbox_events
  TO adsagent_rw, listings_rw, context_rw, shared_rw;

COMMIT;
