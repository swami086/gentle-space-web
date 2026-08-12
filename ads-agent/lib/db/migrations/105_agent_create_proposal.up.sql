-- S9 Task 9: the single write capability of the MCP context server. agent_ro holds no
-- INSERT grant anywhere; it holds EXECUTE on exactly this function. That makes
-- "agents have one write tool" a property of the database rather than of the
-- code that happens to be calling it.
--
-- SECURITY DEFINER is safe here because adsagent.proposals carries FORCE ROW
-- LEVEL SECURITY: the policy applies to the owner too, so the WITH CHECK clause
-- still rejects a row carrying another tenant's org_id.
BEGIN;

ALTER TABLE adsagent.proposals
  ADD COLUMN IF NOT EXISTS proposed_by       TEXT,
  ADD COLUMN IF NOT EXISTS evidence          JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cdc_lag_seconds   INTEGER;

-- Agent-authored rows must cite something. Human rows are unaffected.
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_agent_evidence_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_agent_evidence_check
  CHECK (proposed_by IS NULL OR jsonb_array_length(evidence) > 0);

-- The live CHECK admits only the five snake_case kinds the existing executor
-- uses. The agent vocabulary is dotted (agent spec §5), so widen rather than
-- rename: renaming would break the decision cycle and the executor, which this
-- plan must not touch.
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN (
    'create_campaign','pause','budget_change','add_negative_keyword','campaign_strategy',
    'campaign.create','campaign.budget_change','campaign.pause',
    'enquiry.requirement_update','content.page_update','listing.update','message.draft'
  ));

CREATE INDEX IF NOT EXISTS proposals_org_proposed_by_idx
  ON adsagent.proposals (org_id, proposed_by, created_at DESC);

CREATE OR REPLACE FUNCTION adsagent.agent_create_proposal(
  p_kind            TEXT,
  p_payload         JSONB,
  p_rationale       TEXT,
  p_evidence        TEXT[],
  p_profile         TEXT,
  p_cdc_lag_seconds INTEGER
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = adsagent, public
AS $$
DECLARE
  v_org UUID := public.current_tenant();
  v_id  UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agent_create_proposal: no tenant in session';
  END IF;
  -- Server-side backstop for the same rule the TypeScript layer enforces. Both,
  -- because either one alone is a single point of failure for the gate the whole
  -- product rests on.
  IF p_evidence IS NULL OR cardinality(p_evidence) = 0 THEN
    RAISE EXCEPTION 'agent_create_proposal: evidence must not be empty';
  END IF;

  INSERT INTO adsagent.proposals
    (org_id, kind, payload, triggered_rule, rationale, evidence, proposed_by,
     cdc_lag_seconds, status)
  VALUES
    (v_org, p_kind, p_payload, 'agent:' || p_profile, p_rationale,
     to_jsonb(p_evidence), p_profile, p_cdc_lag_seconds, 'pending')
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER) TO agent_ro;

-- Freshness is read through a view like every other agent read, so an agent
-- cannot obtain data without also obtaining how old it is (datastore §12.1).
GRANT SELECT ON context.graph_manifests TO agent_ro;

CREATE OR REPLACE VIEW context.v_agent_graph_manifest
  WITH (security_invoker = true) AS
SELECT m.org_id,
       m.status,
       m.last_built_at AS built_at,
       m.cdc_lag_seconds
  FROM context.graph_manifests m
 WHERE m.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_graph_manifest TO agent_ro;

COMMIT;
