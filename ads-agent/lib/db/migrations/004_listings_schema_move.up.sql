-- The listings app's four tables move out of public so the schema layout in
-- data model §0 holds and every downstream spec's `listings.listings` resolves.
-- Application SQL stays unqualified and keeps working through listings_rw's
-- search_path, set in 003.
ALTER TABLE public.listings               SET SCHEMA listings;
ALTER TABLE public.sync_runs              SET SCHEMA listings;
ALTER TABLE public.search_queries         SET SCHEMA listings;
ALTER TABLE public.listing_enrichment_log SET SCHEMA listings;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA listings TO listings_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA listings TO agent_ro, adsagent_rw;
