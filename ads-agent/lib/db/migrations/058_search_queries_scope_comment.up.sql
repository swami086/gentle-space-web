BEGIN;

-- Dataflow review A-2. Until first-party searches route through the portal pipeline,
-- this table and analytics.search_performed_daily measure the same concept with
-- neither aware of the other. Say so on the object, so nobody compares the counts.
COMMENT ON TABLE public.search_queries IS
  'RETIRING (dataflow review A-2). Covers ONLY the first-party Gentle Space site, '
  'with no tenant, session, or consent context. Not comparable with the '
  'search_performed event stream or analytics.search_performed_daily. '
  'Superseded by the portal ingestion pipeline; do not add columns or new writers.';

COMMIT;
