BEGIN;

-- Portal spec §8 says this CHECK gains 'bigquery'. It does not: datastore §14.6 and
-- portal PI3 both record that BigQuery was rejected once a self-hosted path with the
-- same zero-code property was confirmed, so 'bigquery' is a leftover from the
-- superseded design. The store portal §7's erasure table actually names is the GCS
-- raw bucket, which is not addressable per subject and is closed out by lifecycle.
ALTER TABLE context.deletion_propagations DROP CONSTRAINT IF EXISTS deletion_propagations_store_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_store_check CHECK (store IN
    ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
     'vector_index','objectstore','langfuse','clickhouse_raw','gcs_raw'));

COMMIT;
