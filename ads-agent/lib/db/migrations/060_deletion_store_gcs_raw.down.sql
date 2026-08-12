BEGIN;
DELETE FROM context.deletion_propagations WHERE store = 'gcs_raw';
ALTER TABLE context.deletion_propagations DROP CONSTRAINT IF EXISTS deletion_propagations_store_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_store_check CHECK (store IN
    ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
     'vector_index','objectstore','langfuse','clickhouse_raw'));
COMMIT;
