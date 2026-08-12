-- Reverse the S9 hardening; restore the S3-era agent_ro grants.
-- Do NOT DROP ROLE: agent_ro is owned by 003_schemas_and_roles.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.current_tenant() FROM agent_ro;
REVOKE EXECUTE ON FUNCTION public.set_tenant(UUID) FROM agent_ro;

ALTER ROLE agent_ro RESET default_transaction_read_only;
ALTER ROLE agent_ro RESET statement_timeout;
ALTER ROLE agent_ro RESET idle_in_transaction_session_timeout;
ALTER ROLE agent_ro SET search_path = ag_catalog, adsagent, context, listings, public;

GRANT USAGE ON SCHEMA ag_catalog TO agent_ro;
GRANT USAGE ON SCHEMA public     TO agent_ro;
GRANT USAGE ON SCHEMA listings   TO agent_ro;
GRANT USAGE ON SCHEMA adsagent   TO agent_ro;
GRANT USAGE ON SCHEMA context    TO agent_ro;
GRANT USAGE ON SCHEMA derived    TO agent_ro;

GRANT SELECT ON ALL TABLES IN SCHEMA listings, adsagent, context, derived, public TO agent_ro;

ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA adsagent GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA context  GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA derived  GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public   GRANT SELECT ON TABLES TO agent_ro;

-- 006 granted these; re-apply after the REVOKE above.
GRANT EXECUTE ON FUNCTION public.set_tenant(UUID)  TO agent_ro;
GRANT EXECUTE ON FUNCTION public.current_tenant()  TO agent_ro;

COMMIT;
