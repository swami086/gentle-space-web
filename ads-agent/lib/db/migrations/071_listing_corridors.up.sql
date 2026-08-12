BEGIN;

CREATE TABLE IF NOT EXISTS listings.listing_corridors (
  listing_id   UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  corridor_id  UUID NOT NULL REFERENCES public.corridors(id),
  confidence   NUMERIC(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (listing_id, corridor_id)
);

CREATE INDEX IF NOT EXISTS listing_corridors_corridor_idx
  ON listings.listing_corridors (corridor_id, listing_id);

INSERT INTO listings.listing_corridors (listing_id, corridor_id, confidence)
SELECT l.id, c.id, 1.00
  FROM listings.listings l
  JOIN public.corridors c
    ON lower(btrim(l.area)) = lower(c.display_name)
ON CONFLICT (listing_id, corridor_id) DO NOTHING;

INSERT INTO listings.listing_corridors (listing_id, corridor_id, confidence)
SELECT l.id, c.id, 0.70
  FROM listings.listings l
  JOIN public.corridors c
    ON EXISTS (
         SELECT 1 FROM unnest(c.aliases) AS a
          WHERE l.area <> '' AND lower(l.area) LIKE '%' || lower(a) || '%'
       )
ON CONFLICT (listing_id, corridor_id) DO NOTHING;

COMMENT ON COLUMN listings.listing_corridors.confidence IS
  '1.0 exact display-name match, 0.7 alias substring match. A listing whose area matches nothing gets no row and is counted as residual.';

COMMIT;
