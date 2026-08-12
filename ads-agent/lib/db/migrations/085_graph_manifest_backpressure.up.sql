-- Rebuild backpressure and the snapshot control plane (datastore §12.2).
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.graph_manifests (
  org_id UUID PRIMARY KEY REFERENCES public.orgs(id)
);

ALTER TABLE context.graph_manifests
  ADD COLUMN IF NOT EXISTS status                TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS snapshot_id           UUID,
  ADD COLUMN IF NOT EXISTS building_id           UUID,
  ADD COLUMN IF NOT EXISTS last_built_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_since           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message         TEXT,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cdc_lag_seconds       INTEGER,
  ADD COLUMN IF NOT EXISTS source_watermark      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_user_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generation            BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempts              INTEGER NOT NULL DEFAULT 0;

ALTER TABLE context.graph_manifests DROP CONSTRAINT IF EXISTS graph_manifests_status_check;
ALTER TABLE context.graph_manifests
  ADD CONSTRAINT graph_manifests_status_check
  CHECK (status IN ('pending','building','ready','error'));

CREATE INDEX IF NOT EXISTS graph_manifests_claimable_idx
  ON context.graph_manifests (stale_since) WHERE status = 'pending';

ALTER TABLE context.graph_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.graph_manifests FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.graph_manifests;
CREATE POLICY tenant_isolation ON context.graph_manifests
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.graph_manifests TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_manifests;
CREATE POLICY maintenance_cross_tenant ON context.graph_manifests
  TO context_maintenance
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS context.rebuild_slots (
  slot_no      INTEGER PRIMARY KEY,
  org_id       UUID,
  leased_until TIMESTAMPTZ
);

INSERT INTO context.rebuild_slots (slot_no) VALUES (1), (2)
  ON CONFLICT (slot_no) DO NOTHING;

GRANT SELECT, UPDATE ON context.rebuild_slots TO context_maintenance;

COMMIT;
