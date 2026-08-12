BEGIN;
DROP POLICY IF EXISTS relay_read_deletions ON context.deletion_requests;
REVOKE INSERT ON context.outbox_events FROM outbox_relay;
REVOKE SELECT ON context.deletion_requests FROM outbox_relay;
REVOKE SELECT, UPDATE ON context.deletion_propagations FROM outbox_relay;
DROP INDEX IF EXISTS context.deletion_propagations_pending_idx;
ALTER TABLE context.deletion_propagations DROP COLUMN IF EXISTS last_published_at;
COMMIT;
