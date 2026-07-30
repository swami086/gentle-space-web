CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS embedding vector(768);

CREATE INDEX IF NOT EXISTS listings_embedding_ivfflat
  ON listings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
