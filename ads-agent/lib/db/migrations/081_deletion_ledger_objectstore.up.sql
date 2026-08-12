-- The deletion ledger, and the objectstore propagation row the artifact store
-- writes. Data model §6.1. Cascading FK deletes prove nothing to a regulator;
-- this table is the evidence.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.deletion_requests (
  id     UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.deletion_requests
  ADD COLUMN IF NOT EXISTS subject_kind  TEXT,
  ADD COLUMN IF NOT EXISTS subject_ref   TEXT,
  ADD COLUMN IF NOT EXISTS requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Access blocked; user-visible "deleted".
  ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ,
  -- requested_at + the DPDP Rule 8(3) retention floor.
  ADD COLUMN IF NOT EXISTS erase_after   DATE,
  ADD COLUMN IF NOT EXISTS erased_at     TIMESTAMPTZ,
  -- Rule 14(3): grievance response within 90 days maximum.
  ADD COLUMN IF NOT EXISTS respond_by    DATE;

ALTER TABLE context.deletion_requests
  ALTER COLUMN subject_kind SET NOT NULL,
  ALTER COLUMN subject_ref  SET NOT NULL,
  ALTER COLUMN erase_after  SET NOT NULL,
  ALTER COLUMN respond_by   SET NOT NULL;

ALTER TABLE context.deletion_requests
  DROP CONSTRAINT IF EXISTS deletion_requests_subject_kind_check;
ALTER TABLE context.deletion_requests
  ADD CONSTRAINT deletion_requests_subject_kind_check
  CHECK (subject_kind IN ('enquirer','user','tenant'));

CREATE INDEX IF NOT EXISTS deletion_requests_open_idx
  ON context.deletion_requests (org_id, erase_after) WHERE erased_at IS NULL;

ALTER TABLE context.deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.deletion_requests FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_requests;
CREATE POLICY tenant_isolation ON context.deletion_requests
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE TABLE IF NOT EXISTS context.deletion_propagations (
  request_id UUID NOT NULL REFERENCES context.deletion_requests(id) ON DELETE CASCADE,
  store      TEXT NOT NULL,
  PRIMARY KEY (request_id, store)
);

-- Data model §6.1 omits org_id here. The global tenancy rule requires it on
-- every domain table, and without it this table cannot be RLS-protected, so it
-- is added and backfilled from the parent request.
ALTER TABLE context.deletion_propagations
  ADD COLUMN IF NOT EXISTS org_id     UUID,
  ADD COLUMN IF NOT EXISTS state      TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS detail     TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE context.deletion_propagations p
   SET org_id = r.org_id
  FROM context.deletion_requests r
 WHERE p.request_id = r.id AND p.org_id IS NULL;

ALTER TABLE context.deletion_propagations ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE context.deletion_propagations
  DROP CONSTRAINT IF EXISTS deletion_propagations_store_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_store_check CHECK (store IN
    ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
     'vector_index','objectstore','langfuse','clickhouse_raw'));

ALTER TABLE context.deletion_propagations
  DROP CONSTRAINT IF EXISTS deletion_propagations_state_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_state_check
  CHECK (state IN ('pending','suppressed','erased','failed'));

-- The reconciling sweeper's query: anything still pending past a threshold.
CREATE INDEX IF NOT EXISTS deletion_propagations_pending_idx
  ON context.deletion_propagations (org_id, store) WHERE state = 'pending';

ALTER TABLE context.deletion_propagations ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.deletion_propagations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_propagations;
CREATE POLICY tenant_isolation ON context.deletion_propagations
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT ON context.deletion_requests TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.deletion_propagations TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_requests;
CREATE POLICY maintenance_cross_tenant ON context.deletion_requests
  TO context_maintenance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_propagations;
CREATE POLICY maintenance_cross_tenant ON context.deletion_propagations
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
