BEGIN;
REVOKE EXECUTE ON FUNCTION context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC) FROM agent_ro;
DROP FUNCTION IF EXISTS context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC);
DROP VIEW IF EXISTS context.v_agent_spend_today;
DROP POLICY IF EXISTS tenant_isolation ON context.agent_cost_ceilings;
DROP TABLE IF EXISTS context.agent_cost_ceilings;
DROP POLICY IF EXISTS tenant_isolation ON context.agent_token_usage;
DROP TABLE IF EXISTS context.agent_token_usage;
COMMIT;
