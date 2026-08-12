-- S5a: the relay's role. Data model §5a: "the relay connects as its own role
-- and reads across tenants by design, since it is publishing everyone's
-- events. That makes the relay role a deliberate cross-tenant actor and it
-- must write to context.access_log with actor_kind = 'cross_tenant'."
BEGIN;

-- No password here: it is set out of band from the deploy secret
--   ALTER ROLE outbox_relay PASSWORD '…';
-- because this file is in a public repository.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'outbox_relay') THEN
    CREATE ROLE outbox_relay LOGIN NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA context TO outbox_relay;
GRANT SELECT, UPDATE ON context.outbox_events TO outbox_relay;
GRANT INSERT ON context.access_log TO outbox_relay;
GRANT EXECUTE ON FUNCTION public.set_tenant(uuid) TO outbox_relay;
GRANT EXECUTE ON FUNCTION public.set_platform() TO outbox_relay;

-- The one deliberate exception to tenant isolation on this table. Scoped to
-- this role by TO, so no other role inherits it, and carrying WITH CHECK as
-- well as USING because the relay writes published_at.
CREATE POLICY relay_cross_tenant ON context.outbox_events
  FOR ALL TO outbox_relay
  USING      (true)
  WITH CHECK (true);

-- Relay audit rows carry each tenant's org_id while connected as a cross-tenant
-- actor; tenant_isolation would reject org_id != current_tenant().
CREATE POLICY relay_access_log ON context.access_log
  FOR INSERT TO outbox_relay
  WITH CHECK (actor_kind = 'cross_tenant' AND actor_ref = 'outbox-relay');

COMMIT;
