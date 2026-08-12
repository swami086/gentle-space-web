CREATE TABLE IF NOT EXISTS analytics.portal_event_daily
(
  org_id      UUID,
  occurred_on Date,
  event       LowCardinality(String),
  purpose     LowCardinality(String),
  events      SimpleAggregateFunction(sum, UInt64),
  sessions    AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (org_id, occurred_on, event, purpose);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.portal_event_daily_mv
TO analytics.portal_event_daily AS
SELECT
  org_id,
  toDate(occurred_at) AS occurred_on,
  event,
  purpose,
  toUInt64(count())   AS events,
  uniqState(session_id) AS sessions
FROM raw.portal_events
GROUP BY org_id, occurred_on, event, purpose;

CREATE ROW POLICY IF NOT EXISTS portal_event_daily_tenant ON analytics.portal_event_daily
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
