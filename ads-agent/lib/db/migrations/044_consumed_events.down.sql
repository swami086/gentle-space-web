BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON context.consumed_events;
DROP INDEX IF EXISTS context.consumed_events_org_consumed_idx;
DROP TABLE IF EXISTS context.consumed_events;
COMMIT;
