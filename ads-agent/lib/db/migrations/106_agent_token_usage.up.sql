-- The two mandatory GenAI metrics land here as well as on a span, because a
-- ceiling read from the telemetry backend would depend on that backend being up.
-- Cost ceilings are a security control, not an optimisation (agent spec §6).
BEGIN;

CREATE TABLE IF NOT EXISTS context.agent_token_usage (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        UUID NOT NULL REFERENCES public.orgs(id),
  profile       TEXT NOT NULL,
  tool          TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL CHECK (input_tokens  >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cost_usd      NUMERIC(12,6) NOT NULL CHECK (cost_usd >= 0),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_token_usage_org_day_idx
  ON context.agent_token_usage (org_id, occurred_at DESC);

ALTER TABLE context.agent_token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.agent_token_usage FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON context.agent_token_usage
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE TABLE IF NOT EXISTS context.agent_cost_ceilings (
  org_id           UUID PRIMARY KEY REFERENCES public.orgs(id),
  daily_ceiling_usd NUMERIC(12,6) NOT NULL CHECK (daily_ceiling_usd >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.agent_cost_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.agent_cost_ceilings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON context.agent_cost_ceilings
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Every existing org gets a ceiling immediately: assertWithinCeiling halts when
-- no row exists, so an org without one cannot run an agent at all.
INSERT INTO context.agent_cost_ceilings (org_id, daily_ceiling_usd)
SELECT id, 5.000000 FROM public.orgs
ON CONFLICT (org_id) DO NOTHING;

CREATE OR REPLACE VIEW context.v_agent_spend_today
  WITH (security_invoker = true) AS
SELECT c.org_id,
       COALESCE((
         SELECT sum(u.cost_usd) FROM context.agent_token_usage u
          WHERE u.org_id = c.org_id
            AND u.occurred_at >= date_trunc('day', now())
       ), 0) AS spent_usd,
       c.daily_ceiling_usd AS ceiling_usd
  FROM context.agent_cost_ceilings c
 WHERE c.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_spend_today TO agent_ro;

CREATE OR REPLACE FUNCTION context.record_agent_token_usage(
  p_profile       TEXT,
  p_tool          TEXT,
  p_input_tokens  INTEGER,
  p_output_tokens INTEGER,
  p_cost_usd      NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = context, public
AS $$
DECLARE v_org UUID := public.current_tenant();
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'record_agent_token_usage: no tenant in session';
  END IF;
  INSERT INTO context.agent_token_usage
    (org_id, profile, tool, input_tokens, output_tokens, cost_usd)
  VALUES (v_org, p_profile, p_tool, p_input_tokens, p_output_tokens, p_cost_usd);
END
$$;

REVOKE ALL ON FUNCTION context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC) TO agent_ro;

COMMIT;
