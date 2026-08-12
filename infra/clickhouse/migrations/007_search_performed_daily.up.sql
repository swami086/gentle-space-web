-- Replaces the reporting job public.search_queries used to serve. zero_result is a
-- dimension rather than a derivable afterthought: an unmet-demand search is the
-- highest-value row here, and the retired table could not tell it from a good one.
CREATE TABLE IF NOT EXISTS analytics.search_performed_daily
(
  org_id       UUID,
  occurred_on  Date,
  zero_result  UInt8,
  searches     SimpleAggregateFunction(sum, UInt64),
  sessions     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (org_id, occurred_on, zero_result);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.search_performed_daily_mv
TO analytics.search_performed_daily AS
SELECT
  org_id,
  toDate(occurred_at) AS occurred_on,
  toUInt8(JSONExtractUInt(payload, 'result_count') = 0) AS zero_result,
  toUInt64(count())     AS searches,
  uniqState(session_id) AS sessions
FROM raw.portal_events
WHERE event = 'search_performed'
GROUP BY org_id, occurred_on, zero_result;

CREATE ROW POLICY IF NOT EXISTS search_performed_daily_tenant ON analytics.search_performed_daily
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
