-- Roll back Task 3 views and the base-table grants 102 added.
-- evidence column lifecycle stays with migration 104 (IF NOT EXISTS up).
BEGIN;

DROP VIEW IF EXISTS context.v_agent_campaigns;
DROP VIEW IF EXISTS context.v_agent_proposals;
DROP VIEW IF EXISTS context.v_agent_spaces;
DROP VIEW IF EXISTS context.v_agent_enquiry_activity;
DROP VIEW IF EXISTS context.v_agent_enquiries;

REVOKE EXECUTE ON FUNCTION context._agent_spaces_scan() FROM agent_ro;
DROP FUNCTION IF EXISTS context._agent_spaces_scan();

REVOKE SELECT ON
  adsagent.campaigns,
  adsagent.proposals,
  adsagent.enquiry_activities,
  adsagent.enquiries
FROM agent_ro;

REVOKE USAGE ON SCHEMA adsagent FROM agent_ro;

COMMIT;
