-- context.artifacts: the queryable index over payload bytes held in Garage.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.artifacts (
  id      UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id  UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.artifacts
  ADD COLUMN IF NOT EXISTS storage_key  TEXT,
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS media_type   TEXT NOT NULL DEFAULT 'application/json',
  ADD COLUMN IF NOT EXISTS byte_size    BIGINT,
  ADD COLUMN IF NOT EXISTS checksum     TEXT,
  ADD COLUMN IF NOT EXISTS subject_refs UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS erase_after  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erased_at    TIMESTAMPTZ;

ALTER TABLE context.artifacts
  ALTER COLUMN storage_key  SET NOT NULL,
  ALTER COLUMN content_type SET NOT NULL,
  ALTER COLUMN byte_size    SET NOT NULL,
  ALTER COLUMN checksum     SET NOT NULL,
  ALTER COLUMN erase_after  SET NOT NULL;

ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_storage_key_unique;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_storage_key_unique UNIQUE (storage_key);

ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_content_type_check;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_content_type_check CHECK (content_type IN
    ('talking_points','draft','context_pack','trace_payload','call_recording'));

ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_key_carries_tenant;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_key_carries_tenant CHECK (
    storage_key = 'artifacts/' || org_id::text || '/' || content_type || '/' || id::text);

CREATE INDEX IF NOT EXISTS artifacts_subject_refs_idx
  ON context.artifacts USING GIN (subject_refs);

CREATE INDEX IF NOT EXISTS artifacts_retention_idx
  ON context.artifacts (org_id, erase_after) WHERE erased_at IS NULL;

CREATE INDEX IF NOT EXISTS artifacts_org_kind_created_idx
  ON context.artifacts (org_id, content_type, created_at DESC);

ALTER TABLE context.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.artifacts FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.artifacts;
CREATE POLICY tenant_isolation ON context.artifacts
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.artifacts TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifacts;
CREATE POLICY maintenance_cross_tenant ON context.artifacts
  TO context_maintenance
  USING (true) WITH CHECK (true);

COMMIT;
