-- S5a: the consumer idempotency guard. Datastore spec §14.3: "Assume
-- at-least-once and make every consumer idempotent, keyed on the outbox event
-- id." Pub/Sub's exactly-once mode is a configuration with caveats; this table
-- keeps working when that configuration is wrong.
BEGIN;

CREATE TABLE context.consumed_events (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id      public.org_ref NOT NULL REFERENCES public.orgs(id),
  consumer    TEXT NOT NULL,
  event_id    UUID NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The actual guarantee. INSERT … ON CONFLICT on this constraint is what makes
  -- a redelivery a no-op; the surrogate id exists to keep the table's shape
  -- consistent with every other table in the model.
  CONSTRAINT consumed_events_once UNIQUE (consumer, event_id)
);

CREATE INDEX consumed_events_org_consumed_idx
  ON context.consumed_events (org_id, consumed_at);

ALTER TABLE context.consumed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.consumed_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.consumed_events
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT, DELETE ON context.consumed_events
  TO adsagent_rw, listings_rw, context_rw, shared_rw;

COMMIT;
