-- B5: pg_clickhouse FDW — graph + analytics mirrors for S9 MCP context server.
-- agent_ro must NOT receive SELECT on these foreign tables (views come later).
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_clickhouse;

-- Binary driver → native protocol port 9000. From the PG container use
-- host.docker.internal (Task 2). Override with ALTER SERVER in non-local envs.
DROP SERVER IF EXISTS clickhouse_analytics CASCADE;
CREATE SERVER clickhouse_analytics
  FOREIGN DATA WRAPPER clickhouse_fdw
  OPTIONS (
    driver 'binary',
    host 'host.docker.internal',
    port '9000',
    dbname 'gentle_space'
  );

DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER clickhouse_analytics;
CREATE USER MAPPING FOR CURRENT_USER
  SERVER clickhouse_analytics
  OPTIONS (user 'tenant_reader', password 'tenant');

-- Also map agent_ro for completeness of ROLE list — still no table grants.
DROP USER MAPPING IF EXISTS FOR agent_ro SERVER clickhouse_analytics;
CREATE USER MAPPING FOR agent_ro
  SERVER clickhouse_analytics
  OPTIONS (user 'tenant_reader', password 'tenant');

CREATE SCHEMA IF NOT EXISTS context;

-- graph_node (CH: gentle_space.graph_node)
CREATE FOREIGN TABLE IF NOT EXISTS context.fdw_graph_node (
  org_id      UUID,
  snapshot_id UUID,
  node_id     UUID,
  node_kind   TEXT,
  label       TEXT,
  subject_ref TEXT,
  props       JSONB
) SERVER clickhouse_analytics
  OPTIONS (database 'gentle_space', table_name 'graph_node');

-- graph_edge — CH column is relationship_kind (not "relationship")
CREATE FOREIGN TABLE IF NOT EXISTS context.fdw_graph_edge (
  org_id             UUID,
  snapshot_id        UUID,
  source_id          UUID,
  source_kind        TEXT,
  relationship_kind  TEXT,
  target_id          UUID,
  target_kind        TEXT,
  meters             INTEGER,
  weight             REAL,
  confidence         REAL,
  props              JSONB
) SERVER clickhouse_analytics
  OPTIONS (database 'gentle_space', table_name 'graph_edge');

CREATE FOREIGN TABLE IF NOT EXISTS context.fdw_enquiry_fact (
  org_id        UUID,
  enquiry_id    UUID,
  listing_id    UUID,
  corridor_id   UUID,
  reply_state   TEXT,
  first_seen_at TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  snapshot_id   UUID
) SERVER clickhouse_analytics
  OPTIONS (database 'analytics', table_name 'enquiry_fact');

-- AggregatingMergeTree rollups: expose dimensions + simple sums only.
-- AggregateFunction columns (uniqState) are omitted — not useful via FDW for agents.
CREATE FOREIGN TABLE IF NOT EXISTS context.fdw_portal_event_daily (
  org_id      UUID,
  occurred_on DATE,
  event       TEXT,
  purpose     TEXT,
  events      BIGINT
) SERVER clickhouse_analytics
  OPTIONS (database 'analytics', table_name 'portal_event_daily');

CREATE FOREIGN TABLE IF NOT EXISTS context.fdw_search_performed_daily (
  org_id      UUID,
  occurred_on DATE,
  zero_result SMALLINT,
  searches    BIGINT
) SERVER clickhouse_analytics
  OPTIONS (database 'analytics', table_name 'search_performed_daily');

REVOKE ALL ON context.fdw_graph_node FROM PUBLIC;
REVOKE ALL ON context.fdw_graph_edge FROM PUBLIC;
REVOKE ALL ON context.fdw_enquiry_fact FROM PUBLIC;
REVOKE ALL ON context.fdw_portal_event_daily FROM PUBLIC;
REVOKE ALL ON context.fdw_search_performed_daily FROM PUBLIC;
-- Explicit: agent_ro must remain without SELECT (Task 4 grants views only).
REVOKE ALL ON context.fdw_graph_node FROM agent_ro;
REVOKE ALL ON context.fdw_graph_edge FROM agent_ro;
REVOKE ALL ON context.fdw_enquiry_fact FROM agent_ro;
REVOKE ALL ON context.fdw_portal_event_daily FROM agent_ro;
REVOKE ALL ON context.fdw_search_performed_daily FROM agent_ro;

COMMIT;
