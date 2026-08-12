BEGIN;

DROP VIEW IF EXISTS context.v_agent_graph_manifest;
REVOKE SELECT ON context.graph_manifests FROM agent_ro;

REVOKE EXECUTE ON FUNCTION adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER) FROM agent_ro;
DROP FUNCTION IF EXISTS adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER);
DROP INDEX IF EXISTS adsagent.proposals_org_proposed_by_idx;
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_agent_evidence_check;
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN ('create_campaign','pause','budget_change','add_negative_keyword','campaign_strategy'));
ALTER TABLE adsagent.proposals
  DROP COLUMN IF EXISTS cdc_lag_seconds,
  DROP COLUMN IF EXISTS proposed_by;

COMMIT;
