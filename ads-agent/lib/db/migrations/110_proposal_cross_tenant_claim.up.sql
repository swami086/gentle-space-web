-- The proposal undo worker selects due scheduled rows across every org.
CREATE POLICY cross_tenant_read ON adsagent.proposals
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');
