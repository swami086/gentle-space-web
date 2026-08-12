BEGIN;
REVOKE DELETE ON context.outbox_events FROM outbox_relay;
DROP VIEW IF EXISTS context.outbox_health;
COMMIT;
