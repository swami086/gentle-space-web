CREATE TABLE IF NOT EXISTS gentle_space.graph_node
(
  org_id      UUID,
  snapshot_id UUID,
  node_id     UUID,
  node_kind   LowCardinality(String),
  label       String,
  subject_ref Nullable(String),
  props       JSON
)
ENGINE = MergeTree
ORDER BY (org_id, snapshot_id, node_kind, node_id);
