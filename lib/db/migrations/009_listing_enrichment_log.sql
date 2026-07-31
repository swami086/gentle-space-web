BEGIN;

-- Schema-qualified on purpose: the deployed role has search_path
-- "ag_catalog, $user, public" for Apache AGE, so an unqualified CREATE TABLE
-- lands this app table inside the extension's schema.
CREATE TABLE IF NOT EXISTS public.listing_enrichment_log (
  id BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  pass TEXT NOT NULL CHECK (pass IN ('page', 'web')),
  accepted BOOLEAN NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_enrichment_log_listing_created_idx
  ON public.listing_enrichment_log (listing_id, created_at DESC);

COMMIT;

