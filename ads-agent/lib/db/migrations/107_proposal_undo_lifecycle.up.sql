ALTER TABLE adsagent.proposals
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undo_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS batch_id UUID;

ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending','approved','rejected','executed','failed','scheduled','executing'));

CREATE INDEX IF NOT EXISTS proposals_org_scheduled_undo_until_idx
  ON adsagent.proposals (org_id, status, undo_until)
  WHERE status = 'scheduled';
