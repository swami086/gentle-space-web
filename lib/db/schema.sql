CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('coworker','myhq','cofynd','gofloaters')),
  source_id TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  short_teaser TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Bengaluru',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  amenities JSONB NOT NULL DEFAULT '[]',
  images JSONB NOT NULL DEFAULT '[]',
  pricing_hint TEXT,
  property_type TEXT,
  source_url TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  missing_runs INT NOT NULL DEFAULT 0,
  content_hash TEXT,
  embed_hash TEXT,
  extracted_entities JSONB,
  entities_hash TEXT,
  structured_embedding vector(768),
  description_embedding vector(768),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS listings_structured_embedding_ivfflat
  ON listings USING ivfflat (structured_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS listings_description_embedding_ivfflat
  ON listings USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS listings_source_missing_idx
  ON listings (source, missing_runs);

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  count INT,
  error TEXT,
  sources JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Apache AGE graph bootstrap (requires gentle-space-pg:pg16-age image)
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
ALTER DATABASE gentle_space_listings SET search_path TO ag_catalog, "$user", public;
SET search_path TO ag_catalog, "$user", public;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'gentle_space') THEN
    PERFORM ag_catalog.create_graph('gentle_space');
  END IF;
END
$$;
