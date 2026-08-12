BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON context.outbox_events;
DROP INDEX IF EXISTS context.outbox_events_org_created_idx;
DROP INDEX IF EXISTS context.outbox_events_unpublished_idx;
DROP TABLE IF EXISTS context.outbox_events;
COMMIT;
