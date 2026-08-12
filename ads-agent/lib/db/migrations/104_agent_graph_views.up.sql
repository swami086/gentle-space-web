-- S9 Task 4: tenant-scoped graph views over ClickHouse FDW foreign tables.
-- agent_ro gets SELECT on views only — never on fdw_graph_* (migration 103).
BEGIN;

CREATE OR REPLACE VIEW context.v_agent_graph_node
  WITH (security_invoker = true) AS
SELECT n.org_id, n.snapshot_id, n.node_id, n.node_kind, n.props
  FROM context.fdw_graph_node n
 WHERE n.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_graph_edge
  WITH (security_invoker = true) AS
SELECT e.org_id, e.snapshot_id, e.source_id, e.source_kind, e.target_id, e.target_kind,
       e.relationship_kind AS relationship
  FROM context.fdw_graph_edge e
 WHERE e.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_graph_node TO agent_ro;
GRANT SELECT ON context.v_agent_graph_edge TO agent_ro;

COMMIT;
