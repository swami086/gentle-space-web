-- Bookkeeping for the two divergence sweeps (datastore §13.1).
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

-- Cross-tenant maintenance record, deliberately not a domain table and
-- therefore deliberately not org-scoped: one sweep run covers every tenant, in
-- the same way public.corridors is shared reference data.
CREATE TABLE IF NOT EXISTS context.artifact_sweep_runs (
  id UUID PRIMARY KEY DEFAULT uuidv7()
);

ALTER TABLE context.artifact_sweep_runs
  ADD COLUMN IF NOT EXISTS sweep           TEXT,
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS finished_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS objects_scanned INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS objects_deleted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS objects_skipped INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rows_flagged    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unexplained     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE context.artifact_sweep_runs ALTER COLUMN sweep SET NOT NULL;

ALTER TABLE context.artifact_sweep_runs
  DROP CONSTRAINT IF EXISTS artifact_sweep_runs_sweep_check;
ALTER TABLE context.artifact_sweep_runs
  ADD CONSTRAINT artifact_sweep_runs_sweep_check CHECK (sweep IN ('orphan','dangling'));

CREATE TABLE IF NOT EXISTS context.artifact_dangling_flags (
  artifact_id UUID PRIMARY KEY REFERENCES context.artifacts(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.artifact_dangling_flags
  -- mid_erasure is the expected residue of a crash mid-erasure, because bytes
  -- are deleted before the row is tombstoned. unexplained is the one that
  -- indicates a bug or an out-of-band deletion, and the only one that alerts.
  ADD COLUMN IF NOT EXISTS classification TEXT,
  ADD COLUMN IF NOT EXISTS detected_at    TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE context.artifact_dangling_flags ALTER COLUMN classification SET NOT NULL;

ALTER TABLE context.artifact_dangling_flags
  DROP CONSTRAINT IF EXISTS artifact_dangling_flags_classification_check;
ALTER TABLE context.artifact_dangling_flags
  ADD CONSTRAINT artifact_dangling_flags_classification_check
  CHECK (classification IN ('mid_erasure','unexplained'));

CREATE INDEX IF NOT EXISTS artifact_dangling_flags_alerting_idx
  ON context.artifact_dangling_flags (org_id, detected_at DESC)
  WHERE classification = 'unexplained';

ALTER TABLE context.artifact_dangling_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.artifact_dangling_flags FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.artifact_dangling_flags;
CREATE POLICY tenant_isolation ON context.artifact_dangling_flags
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.artifact_sweep_runs      TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.artifact_dangling_flags  TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifact_dangling_flags;
CREATE POLICY maintenance_cross_tenant ON context.artifact_dangling_flags
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
