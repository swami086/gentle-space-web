-- cron_settings was a hard global singleton (id INT PRIMARY KEY DEFAULT 1,
-- CHECK (id = 1)), so automation was on or off for every tenant at once. It is
-- left in place, unread, and dropped in a later cleanup once this table is
-- proven -- which is what keeps this migration reversible.
CREATE TABLE IF NOT EXISTS adsagent.org_cron_settings (
  org_id                 public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  cron_enabled           BOOLEAN NOT NULL DEFAULT false,
  last_run_at            TIMESTAMPTZ,
  undo_window_seconds    INT NOT NULL DEFAULT 60
                           CHECK (undo_window_seconds BETWEEN 0 AND 3600),
  -- NULL means operators may approve any amount (tenancy spec Q2 default).
  approval_threshold_inr NUMERIC CHECK (approval_threshold_inr IS NULL OR approval_threshold_inr >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO adsagent.org_cron_settings (org_id, cron_enabled, last_run_at)
SELECT '00000000-0000-0000-0000-000000000001', enabled, last_run_at
  FROM adsagent.cron_settings WHERE id = 1
ON CONFLICT (org_id) DO NOTHING;

ALTER TABLE adsagent.org_cron_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.org_cron_settings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.org_cron_settings;
CREATE POLICY tenant_isolation ON adsagent.org_cron_settings
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON adsagent.org_cron_settings TO adsagent_rw;
GRANT SELECT ON adsagent.org_cron_settings TO agent_ro;
