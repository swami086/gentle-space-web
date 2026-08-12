BEGIN;

-- Control plane, not a domain table: one row per replicated source table, no org_id.
-- The replicator reads across tenants by design, exactly like the S5a relay, and
-- audits itself in context.access_log with actor_kind = 'cross_tenant'.
CREATE TABLE IF NOT EXISTS context.replication_state (
  source_table   TEXT PRIMARY KEY,
  watermark      TIMESTAMPTZ NOT NULL,
  rows_copied    BIGINT NOT NULL DEFAULT 0,
  last_run_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.replication_state
  ADD COLUMN IF NOT EXISTS last_error TEXT;

COMMIT;
