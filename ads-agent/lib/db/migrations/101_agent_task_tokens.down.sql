BEGIN;
REVOKE EXECUTE ON FUNCTION context.verify_agent_task_token(BYTEA) FROM agent_ro;
DROP FUNCTION IF EXISTS context.verify_agent_task_token(BYTEA);
DROP POLICY IF EXISTS token_lookup      ON context.agent_task_tokens;
DROP POLICY IF EXISTS tenant_isolation  ON context.agent_task_tokens;
DROP TABLE IF EXISTS context.agent_task_tokens;
COMMIT;
