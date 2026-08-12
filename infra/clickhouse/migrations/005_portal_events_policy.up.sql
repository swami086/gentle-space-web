CREATE ROW POLICY IF NOT EXISTS portal_events_tenant ON raw.portal_events
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
