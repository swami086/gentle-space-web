CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('meta','google')),
  external_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','paused','removed')),
  daily_budget NUMERIC,
  corridor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  spend NUMERIC NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  impressions INT NOT NULL DEFAULT 0,
  conversions INT NOT NULL DEFAULT 0,
  cpl NUMERIC,
  raw JSONB
);

CREATE TABLE IF NOT EXISTS crm_signal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hot_count INT NOT NULL DEFAULT 0,
  warm_count INT NOT NULL DEFAULT 0,
  cold_count INT NOT NULL DEFAULT 0,
  unscored_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('create_campaign','pause','budget_change','add_negative_keyword')),
  campaign_id UUID REFERENCES campaigns(id),
  payload JSONB NOT NULL,
  triggered_rule TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cron_settings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMPTZ,
  CHECK (id = 1)
);

INSERT INTO cron_settings (id, enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS campaign_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'chatting' CHECK (status IN ('chatting','ready','converted')),
  corridor TEXT,
  daily_budget_inr NUMERIC,
  ad_group_name TEXT,
  keywords JSONB NOT NULL DEFAULT '[]',
  headlines JSONB NOT NULL DEFAULT '[]',
  descriptions JSONB NOT NULL DEFAULT '[]',
  final_url TEXT NOT NULL DEFAULT 'https://www.gentlespacesolutions.com/spaces',
  proposal_id UUID REFERENCES proposals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_draft_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES campaign_drafts(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'external' CHECK (kind IN ('internal','external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_balances (
  org_id UUID PRIMARY KEY REFERENCES orgs(id),
  balance_credits NUMERIC NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES orgs(id),
  balance_credits NUMERIC NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID REFERENCES users(id),
  amount_credits NUMERIC NOT NULL CHECK (amount_credits > 0),
  granted_by TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  cost_usd NUMERIC NOT NULL,
  credits_debited NUMERIC NOT NULL,
  request_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL CHECK (domain IN ('marketing','crm')),
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dev seed: no auth system exists yet, so every metered call runs as this one fixed org/user
-- until a real login flow is built (see design spec Non-goals). Fixed literal ids everywhere so
-- re-running this file (npm run migrate) never duplicates a row.
INSERT INTO orgs (id, name, kind) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Gentle Space (internal)', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, org_id, email, display_name, role) VALUES
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'dev@gentlespacesolutions.com', 'Dev User', 'admin')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org_balances (org_id, balance_credits) VALUES
  ('00000000-0000-0000-0000-000000000001', 1000)
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO credit_grants (id, org_id, user_id, amount_credits, granted_by, note) VALUES
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', NULL, 1000,
   'seed', 'Initial dev seed grant')
ON CONFLICT (id) DO NOTHING;
