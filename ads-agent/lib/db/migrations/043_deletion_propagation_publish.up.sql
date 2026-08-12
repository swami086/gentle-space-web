-- S5a: let the reconciling sweeper know when it last published for a store.
-- Datastore spec §14.4: "The queue is transport; the ledger is truth."
-- Expressed as an explicit ALTER because a change written inside a CREATE TABLE
-- body never reaches a provisioned database.
BEGIN;

ALTER TABLE context.deletion_propagations
  ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;

-- The sweeper's query: pending rows whose last publish is old enough to be
-- presumed lost. Partial, so it stays small as the ledger accumulates.
CREATE INDEX IF NOT EXISTS deletion_propagations_pending_idx
  ON context.deletion_propagations (last_published_at)
  WHERE state = 'pending';

GRANT SELECT, UPDATE ON context.deletion_propagations TO outbox_relay;
GRANT SELECT ON context.deletion_requests TO outbox_relay;
GRANT INSERT ON context.outbox_events TO outbox_relay;

-- Cross-tenant discovery: the reconciler reads every org's pending rows as
-- outbox_relay, same deliberate exception as the relay on outbox_events.
CREATE POLICY relay_read_deletions ON context.deletion_requests
  FOR SELECT TO outbox_relay
  USING (true);

COMMIT;
