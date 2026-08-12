CREATE TABLE IF NOT EXISTS gentle_space.graph_edge
(
  org_id            UUID,
  snapshot_id       UUID,
  source_id         UUID,
  source_kind       LowCardinality(String),
  relationship_kind LowCardinality(String),
  target_id         UUID,
  target_kind       LowCardinality(String),
  meters     Nullable(UInt32),
  weight     Nullable(Float32),
  confidence Nullable(Float32),
  props      JSON
)
ENGINE = MergeTree
ORDER BY (org_id, snapshot_id, source_kind, relationship_kind, source_id);
