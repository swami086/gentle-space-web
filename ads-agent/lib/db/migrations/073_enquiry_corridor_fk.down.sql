BEGIN;
DROP INDEX IF EXISTS adsagent.enquiries_unresolved_listing_idx;
DROP INDEX IF EXISTS adsagent.enquiries_org_corridor_seen_idx;
ALTER TABLE adsagent.enquiries DROP CONSTRAINT IF EXISTS enquiries_listing_id_fkey;
ALTER TABLE adsagent.enquiries DROP CONSTRAINT IF EXISTS enquiries_corridor_id_fkey;
COMMIT;
