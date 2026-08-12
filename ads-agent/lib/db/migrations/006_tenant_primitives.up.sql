-- Data model §1.1 and §1.3. Every path into the database goes through
-- set_tenant; nothing sets the variable directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_ref'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE DOMAIN public.org_ref AS UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_state'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.lifecycle_state AS ENUM ('active', 'suppressed', 'erased');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_tenant(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'set_tenant called with NULL org_id';
  END IF;
  -- third argument true => transaction-scoped. Without it the setting persists
  -- on the pooled connection and the next request inherits this tenant.
  PERFORM set_config('app.current_tenant_id', p_org_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_tenant()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
$$;

-- Platform staff read across orgs (tenancy spec §1). Transaction-scoped like
-- the tenant itself, and it can only be raised after a tenant is set, so
-- current_tenant() is never NULL while it is on.
CREATE OR REPLACE FUNCTION public.set_platform()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.current_tenant() IS NULL THEN
    RAISE EXCEPTION 'set_platform called before set_tenant';
  END IF;
  PERFORM set_config('app.platform_read', 'on', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_read()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(current_setting('app.platform_read', true), 'off') = 'on';
$$;

GRANT EXECUTE ON FUNCTION public.set_tenant(UUID)  TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT EXECUTE ON FUNCTION public.current_tenant()  TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT EXECUTE ON FUNCTION public.is_platform_read() TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw, agent_ro;
-- agent_ro is deliberately excluded: an agent is always tenant-pinned.
GRANT EXECUTE ON FUNCTION public.set_platform()    TO adsagent_rw;
