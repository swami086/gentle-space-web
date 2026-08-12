BEGIN;

-- Rejected events are counted, never persisted (portal spec PI2). One row per
-- (org, reason, minute), so an abusive key costs one upsert per minute rather than
-- one write per request. org_id is nullable because a rejection can precede tenant
-- resolution -- that is the whole point of rejecting early.
CREATE TABLE IF NOT EXISTS context.ingest_rejection_counters (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        UUID,
  reason        TEXT NOT NULL,
  minute_bucket TIMESTAMPTZ NOT NULL,
  events        BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE context.ingest_rejection_counters
  DROP CONSTRAINT IF EXISTS ingest_rejection_counters_unique;
ALTER TABLE context.ingest_rejection_counters
  ADD CONSTRAINT ingest_rejection_counters_unique UNIQUE (org_id, reason, minute_bucket);

CREATE INDEX IF NOT EXISTS ingest_rejection_counters_recent_idx
  ON context.ingest_rejection_counters (org_id, minute_bucket DESC);

COMMIT;
