-- ads-agent/clickhouse/attribution/attribution.sql
-- Applied with: clickhouse-client --queries-file ads-agent/clickhouse/attribution/attribution.sql
--
-- enquiry_fact is created by S6 (data model §7). spend_fact is S7's own: data model §7 shows
-- enquiry_fact only, and attribution needs the spend side in the same store so the rollup join
-- never crosses systems (datastore spec §3). Conventions follow §7 exactly: tenant leads the
-- ORDER BY, a row policy per table, Nullable only for genuinely optional keys.
CREATE TABLE IF NOT EXISTS spend_fact (
  org_id      UUID,
  campaign_id UUID,
  corridor_id Nullable(UUID),
  captured_on Date,
  spend_inr   Decimal(18, 4),
  clicks      UInt32,
  impressions UInt32,
  conversions UInt32,
  snapshot_id UUID
) ENGINE = MergeTree
ORDER BY (org_id, captured_on, campaign_id);

CREATE ROW POLICY IF NOT EXISTS tenant_policy ON spend_fact
  USING org_id = toUUID(getSetting('SQL_current_tenant_id')) TO ALL;

-- The mirror's own high-water mark, per table. Read by fetchSourceWatermark so an
-- attribution figure always arrives with its age (datastore spec §12.1).
CREATE TABLE IF NOT EXISTS cdc_watermark (
  org_id      UUID,
  source      LowCardinality(String),   -- 'spend_fact' | 'enquiry_fact'
  watermark   DateTime64(3),
  observed_at DateTime64(3)
) ENGINE = ReplacingMergeTree(observed_at)
ORDER BY (org_id, source);

CREATE ROW POLICY IF NOT EXISTS tenant_policy ON cdc_watermark
  USING org_id = toUUID(getSetting('SQL_current_tenant_id')) TO ALL;
