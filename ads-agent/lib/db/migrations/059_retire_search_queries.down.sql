BEGIN;
ALTER INDEX IF EXISTS public.search_queries_retired_20260812_created_at_idx
  RENAME TO search_queries_created_at_idx;
ALTER TABLE IF EXISTS public.search_queries_retired_20260812 RENAME TO search_queries;
COMMENT ON TABLE public.search_queries IS NULL;
COMMIT;
