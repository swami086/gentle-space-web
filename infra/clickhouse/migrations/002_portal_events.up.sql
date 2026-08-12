CREATE TABLE IF NOT EXISTS raw.portal_events
(
  org_id           UUID,
  event_id         UUID,
  event            LowCardinality(String),
  purpose          LowCardinality(String),
  session_id       String,
  taxonomy_version UInt16,
  occurred_at      DateTime64(3),
  payload          String,
  ingested_at      DateTime64(3) DEFAULT now64(3),
  occurred_on      Date MATERIALIZED toDate(occurred_at)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (purpose, occurred_on)
ORDER BY (org_id, occurred_on, session_id, event_id);
