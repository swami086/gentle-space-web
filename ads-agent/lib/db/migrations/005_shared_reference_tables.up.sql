-- Data model §0: public owns shared reference data (orgs, users, corridors)
-- with role shared_rw. The pg_dump restore landed them in adsagent along with
-- everything else, so they move out. Foreign keys follow the table.
ALTER TABLE adsagent.orgs  SET SCHEMA public;
ALTER TABLE adsagent.users SET SCHEMA public;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orgs, public.users TO shared_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orgs, public.users TO adsagent_rw;
GRANT SELECT ON public.orgs, public.users TO listings_rw, context_rw, derived_rw, agent_ro;
