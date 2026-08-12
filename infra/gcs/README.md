# Raw portal-event bucket

`gs://gs-portal-raw-events-prod` is **transport, not an archive**. Pub/Sub's native
Cloud Storage export subscription writes batches here; ClickHouse's S3Queue engine
consumes them and deletes each file after processing.

Deliberately a different bucket from the DuckDB snapshot bucket: snapshots use
per-tenant prefixes with scoped service accounts (datastore §12.3), this one uses HMAC
keys against the S3-compatible endpoint. One bucket for both would let the coarser
credential reach snapshot data.

Erasure: files are batched and multi-subject, so they are not addressable per subject.
The one-day lifecycle rule plus delete-after-ingest bounds exposure to roughly one
batch interval; per-subject erasure targets the ClickHouse raw table instead.

Rotate the HMAC key with `gcloud storage hmac update ... --deactivate` then
`gcloud storage hmac create ...`, updating `GCS_HMAC_ACCESS_ID` / `GCS_HMAC_SECRET`
and re-running `scripts/clickhouse/migrate.ts` against the cloud target.
