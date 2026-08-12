-- Snapshot storage is a tenancy boundary (datastore §12.3). Garage grants
-- permissions per bucket, not per prefix, so the prefix-per-tenant rule becomes
-- one bucket per tenant with a read-only key that can reach nothing else.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.snapshot_storage (
  org_id UUID PRIMARY KEY REFERENCES public.orgs(id)
);

ALTER TABLE context.snapshot_storage
  ADD COLUMN IF NOT EXISTS bucket               TEXT,
  ADD COLUMN IF NOT EXISTS garage_bucket_id     TEXT,
  ADD COLUMN IF NOT EXISTS reader_access_key_id TEXT,
  -- Sealed under SNAPSHOT_MASTER_KEY, which lives in the environment and not in
  -- this database, so a dump alone does not open it.
  ADD COLUMN IF NOT EXISTS reader_secret_sealed BYTEA,
  -- Per-tenant data key. Destroying it crypto-shreds every snapshot this tenant
  -- ever had, which is what makes §11.2's erasure practical for immutable files.
  ADD COLUMN IF NOT EXISTS data_key_sealed      BYTEA,
  ADD COLUMN IF NOT EXISTS key_destroyed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE context.snapshot_storage ALTER COLUMN bucket SET NOT NULL;

ALTER TABLE context.snapshot_storage DROP CONSTRAINT IF EXISTS snapshot_storage_bucket_unique;
ALTER TABLE context.snapshot_storage
  ADD CONSTRAINT snapshot_storage_bucket_unique UNIQUE (bucket);

ALTER TABLE context.snapshot_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.snapshot_storage FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_storage;
CREATE POLICY tenant_isolation ON context.snapshot_storage
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.snapshot_storage TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_storage;
CREATE POLICY maintenance_cross_tenant ON context.snapshot_storage
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
