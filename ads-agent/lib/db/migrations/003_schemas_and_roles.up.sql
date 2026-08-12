-- Data model §0: one schema per service, one role per schema, plus the
-- read-only non-owner agent_ro that makes FORCE ROW LEVEL SECURITY meaningful.
-- Ownership of every table stays with the bootstrap role; these roles are
-- granted privileges only and never hold BYPASSRLS.
CREATE SCHEMA IF NOT EXISTS listings;
CREATE SCHEMA IF NOT EXISTS adsagent;
CREATE SCHEMA IF NOT EXISTS context;
CREATE SCHEMA IF NOT EXISTS derived;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- LOGIN with no password; scripts/consolidate/03-set-role-passwords.sh
      -- sets them from the environment so no secret lands in a migration file.
      EXECUTE format('CREATE ROLE %I LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE', r);
    END IF;
  END LOOP;
END $$;

-- ag_catalog must lead: AGE's operators and the _ag_label_* relations are
-- resolved from it and the existing listings graph queries are unqualified.
ALTER ROLE listings_rw SET search_path = ag_catalog, listings, public;
ALTER ROLE adsagent_rw SET search_path = ag_catalog, adsagent, public;
ALTER ROLE context_rw  SET search_path = ag_catalog, context, public;
ALTER ROLE shared_rw   SET search_path = ag_catalog, public;
ALTER ROLE derived_rw  SET search_path = ag_catalog, derived, public;
ALTER ROLE agent_ro    SET search_path = ag_catalog, adsagent, context, listings, public;

GRANT USAGE ON SCHEMA ag_catalog TO listings_rw, adsagent_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT USAGE ON SCHEMA public     TO listings_rw, adsagent_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT USAGE ON SCHEMA listings   TO listings_rw, agent_ro;
GRANT USAGE ON SCHEMA adsagent   TO adsagent_rw, agent_ro;
GRANT USAGE ON SCHEMA context    TO context_rw, agent_ro;
GRANT USAGE ON SCHEMA derived    TO derived_rw, agent_ro;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA listings TO listings_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA adsagent TO adsagent_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA context  TO context_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public   TO shared_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA derived  TO derived_rw;

-- Shared reference data (orgs, users, corridors) is readable by every service
-- and writable only by shared_rw.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO listings_rw, adsagent_rw, context_rw, derived_rw;

-- agent_ro: SELECT only, everywhere, forever. No sequence USAGE either.
GRANT SELECT ON ALL TABLES IN SCHEMA listings, adsagent, context, derived, public TO agent_ro;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA listings TO listings_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA adsagent TO adsagent_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA context  TO context_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO shared_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA derived  TO derived_rw;

ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO listings_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA adsagent GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adsagent_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA context  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO context_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shared_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA derived  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO derived_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA adsagent GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA context  GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA derived  GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public   GRANT SELECT ON TABLES TO agent_ro;
