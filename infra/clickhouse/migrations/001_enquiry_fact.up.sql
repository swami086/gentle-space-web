CREATE TABLE IF NOT EXISTS analytics.enquiry_fact
(
  org_id        UUID,
  enquiry_id    UUID,
  listing_id    Nullable(UUID),
  corridor_id   Nullable(UUID),
  reply_state   LowCardinality(String),
  first_seen_at DateTime64(3),
  updated_at    DateTime64(3),
  snapshot_id   UUID,
  occurred_on   Date MATERIALIZED toDate(first_seen_at)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (org_id, occurred_on, enquiry_id);

CREATE ROW POLICY IF NOT EXISTS enquiry_fact_tenant ON analytics.enquiry_fact
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
