BEGIN;
DROP POLICY IF EXISTS relay_access_log ON context.access_log;
DROP POLICY IF EXISTS relay_cross_tenant ON context.outbox_events;
REVOKE INSERT ON context.access_log FROM outbox_relay;
REVOKE SELECT, UPDATE ON context.outbox_events FROM outbox_relay;
REVOKE USAGE ON SCHEMA context FROM outbox_relay;
-- The role itself is left in place: dropping a role that owns nothing is safe,
-- but a live relay process holding a connection makes DROP ROLE fail, and a
-- failed down migration is worse than a residual role.
COMMIT;
