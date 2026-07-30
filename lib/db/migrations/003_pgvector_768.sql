-- Switch embedding dim to Vertex text-embedding-004 (768).
DROP INDEX IF EXISTS listings_embedding_ivfflat;
ALTER TABLE listings DROP COLUMN IF EXISTS embedding;
ALTER TABLE listings ADD COLUMN embedding vector(768);
CREATE INDEX IF NOT EXISTS listings_embedding_ivfflat
  ON listings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
