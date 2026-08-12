-- S9 Task 4: tenant-scoped graph views over ClickHouse FDW foreign tables.
-- agent_ro gets SELECT on views only — never on fdw_graph_* (migration 103).
--
-- Default (definer) view security, NOT security_invoker: FDW foreign tables have
-- no Postgres RLS. agent_ro has no SELECT on fdw_graph_* by design; invoker rights
-- would fail at runtime with permission denied. Tenancy is the view WHERE clause
-- (org_id = current_tenant()) plus pg_clickhouse.session_settings per transaction.
-- Mirror Task 3 listings/spaces pattern — definer reads the base, view filters.
BEGIN;

CREATE OR REPLACE VIEW context.v_agent_graph_node AS
SELECT n.org_id, n.snapshot_id, n.node_id, n.node_kind, n.props
  FROM context.fdw_graph_node n
 WHERE n.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_graph_edge AS
SELECT e.org_id, e.snapshot_id, e.source_id, e.source_kind, e.target_id, e.target_kind,
       e.relationship_kind AS relationship
  FROM context.fdw_graph_edge e
 WHERE e.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_graph_node TO agent_ro;
GRANT SELECT ON context.v_agent_graph_edge TO agent_ro;

COMMIT;
