BEGIN;

ALTER TABLE adsagent.enquiries ADD COLUMN IF NOT EXISTS corridor_id UUID;
ALTER TABLE adsagent.enquiries ADD COLUMN IF NOT EXISTS listing_id  UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_corridor_id_fkey'
  ) THEN
    ALTER TABLE adsagent.enquiries
      ADD CONSTRAINT enquiries_corridor_id_fkey
      FOREIGN KEY (corridor_id) REFERENCES public.corridors(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_listing_id_fkey'
  ) THEN
    ALTER TABLE adsagent.enquiries
      ADD CONSTRAINT enquiries_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES listings.listings(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS enquiries_org_corridor_seen_idx
  ON adsagent.enquiries (org_id, corridor_id, first_seen_at DESC)
  WHERE lifecycle = 'active';

CREATE INDEX IF NOT EXISTS enquiries_unresolved_listing_idx
  ON adsagent.enquiries (org_id, first_seen_at)
  WHERE listing_id IS NULL AND lifecycle = 'active';

COMMIT;
