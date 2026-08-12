BEGIN;

-- A-2 complete: first-party searches now flow through the portal pipeline, and
-- analytics.search_performed_daily is the reader. The code graph confirmed one
-- writer (lib/search/query-log.ts, deleted) and zero readers.
--
-- RENAME, not DROP. A rename is reversible in one statement and keeps the rows,
-- which the Rule 8(3) retention floor requires of anything that may be personal
-- data. The physical drop is a scheduled hard-erase after the floor passes.
ALTER TABLE IF EXISTS public.search_queries RENAME TO search_queries_retired_20260812;

ALTER INDEX IF EXISTS public.search_queries_created_at_idx
  RENAME TO search_queries_retired_20260812_created_at_idx;

COMMENT ON TABLE public.search_queries_retired_20260812 IS
  'RETIRED 2026-08-12 (dataflow review A-2). Replaced by the portal ingestion '
  'pipeline and analytics.search_performed_daily. Retained access-blocked for the '
  'DPDP Rule 8(3) one-year floor; hard-erase no earlier than 2027-08-12.';

REVOKE ALL ON public.search_queries_retired_20260812 FROM PUBLIC;

COMMIT;
