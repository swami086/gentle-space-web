CREATE ROW POLICY IF NOT EXISTS graph_edge_tenant ON gentle_space.graph_edge
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
