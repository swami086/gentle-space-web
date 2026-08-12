BEGIN;
DROP INDEX IF EXISTS adsagent.campaigns_org_corridor_idx;
ALTER TABLE adsagent.campaigns DROP COLUMN IF EXISTS corridor_id;
COMMIT;
