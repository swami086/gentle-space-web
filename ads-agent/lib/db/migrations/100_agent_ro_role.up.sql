-- S9: harden agent_ro for the MCP context server.
-- Role already exists from 003_schemas_and_roles with broad SELECT on every
-- table. S9 requires views-only SELECT (validation report F-20): revoke table
-- grants, keep schema USAGE + set_tenant, and set read-only session defaults.
-- Password is set out of band (same pattern as outbox_relay).
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_ro') THEN
    CREATE ROLE agent_ro LOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- Defence in depth (agent spec §5). Session defaults are overridable; the
-- real guarantee is the absence of write grants.
ALTER ROLE agent_ro SET default_transaction_read_only = on;
ALTER ROLE agent_ro SET statement_timeout = '5s';
ALTER ROLE agent_ro SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE agent_ro SET search_path = 'context, public';

-- Stop future CREATE TABLE … from auto-granting SELECT to agent_ro (003's
-- ALTER DEFAULT PRIVILEGES). Views are granted explicitly in later migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA listings REVOKE SELECT ON TABLES FROM agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA adsagent REVOKE SELECT ON TABLES FROM agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA context  REVOKE SELECT ON TABLES FROM agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA derived  REVOKE SELECT ON TABLES FROM agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public   REVOKE SELECT ON TABLES FROM agent_ro;

REVOKE ALL ON SCHEMA public   FROM agent_ro;
REVOKE ALL ON SCHEMA context  FROM agent_ro;
REVOKE ALL ON SCHEMA adsagent FROM agent_ro;
REVOKE ALL ON SCHEMA listings FROM agent_ro;
REVOKE ALL ON SCHEMA derived  FROM agent_ro;

REVOKE ALL ON ALL TABLES    IN SCHEMA public, context, adsagent, listings, derived FROM agent_ro;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, context, adsagent, listings, derived FROM agent_ro;

-- USAGE only. Without SELECT on a specific object, USAGE grants nothing.
GRANT USAGE ON SCHEMA context TO agent_ro;
GRANT USAGE ON SCHEMA public  TO agent_ro;

GRANT EXECUTE ON FUNCTION public.set_tenant(UUID)  TO agent_ro;
GRANT EXECUTE ON FUNCTION public.current_tenant()  TO agent_ro;

COMMIT;
