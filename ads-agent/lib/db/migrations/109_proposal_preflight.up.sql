ALTER TABLE adsagent.proposals
  ADD COLUMN IF NOT EXISTS preflight JSONB;
