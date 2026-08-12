-- GCS through its S3-compatible endpoint, authenticated with the HMAC key from
-- infra/gcs/create-raw-events-bucket.sh. Credentials are substituted by the runner,
-- never committed. after_processing = 'delete' keeps the bucket as transport.
-- Keeper tracks processed files; the two bounds below stop that state growing without limit.
CREATE TABLE IF NOT EXISTS raw.portal_event_ingest (raw String)
ENGINE = S3Queue(
  'https://storage.googleapis.com/${GCS_RAW_EVENTS_BUCKET}/portal-event/*.json',
  '${GCS_HMAC_ACCESS_ID}',
  '${GCS_HMAC_SECRET}',
  'LineAsString'
)
SETTINGS
  mode = 'unordered',
  after_processing = 'delete',
  keeper_path = '/clickhouse/s3queue/portal_events',
  tracked_files_limit = 10000,
  tracked_file_ttl_sec = 604800,
  polling_min_timeout_ms = 1000,
  polling_max_timeout_ms = 10000;
