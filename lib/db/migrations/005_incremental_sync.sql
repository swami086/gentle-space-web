BEGIN;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS missing_runs INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS embed_hash TEXT;

UPDATE listings SET last_seen_at = synced_at WHERE last_seen_at IS NULL;
ALTER TABLE listings ALTER COLUMN last_seen_at SET NOT NULL;

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS listings_source_missing_idx
  ON listings (source, missing_runs);

COMMIT;
