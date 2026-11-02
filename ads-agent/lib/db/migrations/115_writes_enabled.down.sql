-- Safe only before any production use of writes_enabled.
ALTER TABLE adsagent.org_cron_settings
  DROP COLUMN writes_enabled;
