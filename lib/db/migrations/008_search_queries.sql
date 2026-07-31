BEGIN;

-- Schema-qualified on purpose: the deployed role has search_path
-- "ag_catalog, $user, public" for Apache AGE, so an unqualified CREATE TABLE
-- lands this app table inside the extension's schema.
CREATE TABLE IF NOT EXISTS public.search_queries (
  id BIGSERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  interpreted_query TEXT NOT NULL DEFAULT '',
  entities JSONB NOT NULL DEFAULT '{}',
  result_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_queries_created_at_idx
  ON public.search_queries (created_at DESC);

COMMIT;
