BEGIN;

DROP INDEX IF EXISTS listings_embedding_ivfflat;
ALTER TABLE listings DROP COLUMN IF EXISTS embedding;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS structured_embedding vector(768);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS description_embedding vector(768);

CREATE INDEX IF NOT EXISTS listings_structured_embedding_ivfflat
  ON listings USING ivfflat (structured_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS listings_description_embedding_ivfflat
  ON listings USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);

COMMIT;
