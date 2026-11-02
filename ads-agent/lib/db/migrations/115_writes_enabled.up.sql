ALTER TABLE adsagent.org_cron_settings
  ADD COLUMN writes_enabled BOOLEAN NOT NULL DEFAULT true;
