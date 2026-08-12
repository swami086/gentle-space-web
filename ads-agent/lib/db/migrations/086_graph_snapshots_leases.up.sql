-- Per-tenant DuckDB snapshot inventory and reader leases.
-- Data model §9, datastore §12.2 generation-based collection.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.graph_snapshots (
  id     UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.graph_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_id      UUID,
  ADD COLUMN IF NOT EXISTS generation       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bucket           TEXT,
  ADD COLUMN IF NOT EXISTS storage_key      TEXT,
  ADD COLUMN IF NOT EXISTS byte_size        BIGINT,
  ADD COLUMN IF NOT EXISTS checksum         TEXT,
  ADD COLUMN IF NOT EXISTS built_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A compliance control, not housekeeping: these files outlive deletion by
  -- construction (datastore §11.2), so every one has a hard TTL.
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ,
  -- Carries CDC lag forward so an agent can tell how stale its context is
  -- (validation F-5, datastore §12.1).
  ADD COLUMN IF NOT EXISTS source_watermark TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cdc_lag_seconds  INTEGER,
  ADD COLUMN IF NOT EXISTS collected_at     TIMESTAMPTZ;

ALTER TABLE context.graph_snapshots
  ALTER COLUMN snapshot_id SET NOT NULL,
  ALTER COLUMN bucket      SET NOT NULL,
  ALTER COLUMN storage_key SET NOT NULL,
  ALTER COLUMN expires_at  SET NOT NULL;

ALTER TABLE context.graph_snapshots DROP CONSTRAINT IF EXISTS graph_snapshots_unique;
ALTER TABLE context.graph_snapshots
  ADD CONSTRAINT graph_snapshots_unique UNIQUE (org_id, snapshot_id);

CREATE INDEX IF NOT EXISTS graph_snapshots_generation_idx
  ON context.graph_snapshots (org_id, generation DESC) WHERE collected_at IS NULL;

ALTER TABLE context.graph_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.graph_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.graph_snapshots;
CREATE POLICY tenant_isolation ON context.graph_snapshots
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE TABLE IF NOT EXISTS context.snapshot_leases (
  id     UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.snapshot_leases
  ADD COLUMN IF NOT EXISTS snapshot_id UUID,
  ADD COLUMN IF NOT EXISTS holder      TEXT,
  ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE context.snapshot_leases
  ALTER COLUMN snapshot_id SET NOT NULL,
  ALTER COLUMN holder      SET NOT NULL,
  ALTER COLUMN expires_at  SET NOT NULL;

CREATE INDEX IF NOT EXISTS snapshot_leases_live_idx
  ON context.snapshot_leases (org_id, snapshot_id, expires_at);

ALTER TABLE context.snapshot_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.snapshot_leases FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_leases;
CREATE POLICY tenant_isolation ON context.snapshot_leases
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE, DELETE ON context.graph_snapshots TO context_maintenance;
GRANT SELECT, DELETE ON context.snapshot_leases TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_snapshots;
CREATE POLICY maintenance_cross_tenant ON context.graph_snapshots
  TO context_maintenance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_leases;
CREATE POLICY maintenance_cross_tenant ON context.snapshot_leases
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
