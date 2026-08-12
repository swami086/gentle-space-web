BEGIN;

-- Control plane. One row per reconciliation run so "it matched once" is
-- distinguishable from "it matches".
CREATE TABLE IF NOT EXISTS context.reconciliation_runs (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  source_table  TEXT NOT NULL,
  cutoff_at     TIMESTAMPTZ NOT NULL,
  lag_seconds   INTEGER NOT NULL,
  ok            BOOLEAN NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}',
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_recent_idx
  ON context.reconciliation_runs (source_table, ran_at DESC);

COMMIT;
