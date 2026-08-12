-- The view is what starts ingestion: with no view attached, the S3Queue engine
-- collects nothing. One view, one source table name, both targets.
CREATE MATERIALIZED VIEW IF NOT EXISTS raw.portal_event_mv TO raw.portal_events AS
SELECT
  toUUIDOrZero(JSONExtractString(raw, 'org_id'))                       AS org_id,
  toUUIDOrZero(JSONExtractString(raw, 'event_id'))                     AS event_id,
  JSONExtractString(raw, 'event')                                      AS event,
  JSONExtractString(raw, 'purpose')                                    AS purpose,
  JSONExtractString(raw, 'session_id')                                 AS session_id,
  toUInt16(JSONExtractUInt(raw, 'taxonomy_version'))                   AS taxonomy_version,
  parseDateTime64BestEffortOrZero(JSONExtractString(raw, 'occurred_at'), 3) AS occurred_at,
  JSONExtractRaw(raw, 'payload')                                       AS payload
FROM raw.portal_event_ingest
WHERE toUUIDOrZero(JSONExtractString(raw, 'org_id')) != toUUID('00000000-0000-0000-0000-000000000000')
  AND JSONExtractString(raw, 'event') != '';
