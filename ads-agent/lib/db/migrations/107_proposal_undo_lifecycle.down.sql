DROP INDEX IF EXISTS adsagent.proposals_org_scheduled_undo_until_idx;

ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending','approved','rejected','executed','failed'));

ALTER TABLE adsagent.proposals
  DROP COLUMN IF EXISTS batch_id,
  DROP COLUMN IF EXISTS undo_until,
  DROP COLUMN IF EXISTS scheduled_for;
