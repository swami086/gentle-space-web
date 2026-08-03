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
