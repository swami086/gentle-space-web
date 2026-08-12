# pg_clickhouse FDW for S9 MCP context server

Date: 2026-08-12  
Status: **accepted**  
Resolves: open-questions register **B5**  
Branch / worktree: `feat/s9-mcp-context-server` (`.worktrees/s9-mcp-context-server`)

## 1. Problem

S9 Task 4 (`graph_query`) assumes Postgres foreign tables `context.fdw_graph_node` /
`context.fdw_graph_edge` over ClickHouse graph tables, then wraps them in
`security_invoker` views that embed `org_id = public.current_tenant()`.

S6 deliberately did **not** ship `pg_clickhouse` (no consumer needed a cross-store join).
Nothing in the tree creates those foreign tables. Inventing local Postgres tables with the
`fdw_*` names would shadow the FDW and silently serve empty or wrong data.

B5’s default: **build the FDW at S9**. Reading ClickHouse over HTTP from the MCP server
removes the Postgres RLS / view backstop that makes F-19’s template design safe.

## 2. Decision

| Choice | Decision |
|--------|----------|
| Approach | Official **ClickHouse/pg_clickhouse** extension in the existing PG18+AGE image |
| Scope | **B** — graph foreign tables **and** existing analytical mirrors agents will need |
| Not in v1 | `campaign_performance_daily` (table does not exist in CH yet); `raw.*` |
| Task 7 | Left on HTTP for now; FDW analytics tables prepare a later move off HTTP |
| Shadow tables | Forbidden — foreign tables only |

## 3. Current inventory (verified 2026-08-12)

**Postgres image:** `gentle-space-pg:pg18-age` from `docker/Dockerfile.postgres`
(`pgvector/pgvector:pg18` + Apache AGE). Extensions today: `age`, `vector`, `pgcrypto`.

**ClickHouse tables present locally:**

| Database | Table | Agent surface? |
|----------|-------|----------------|
| `gentle_space` | `graph_node` | yes → `context.fdw_graph_node` |
| `gentle_space` | `graph_edge` | yes → `context.fdw_graph_edge` |
| `analytics` | `enquiry_fact` | yes → `context.fdw_enquiry_fact` |
| `analytics` | `portal_event_daily` | yes → `context.fdw_portal_event_daily` |
| `analytics` | `search_performed_daily` | yes → `context.fdw_search_performed_daily` |
| `raw` | `portal_events` (+ ingest/mv) | **no** — not for agents |

Row policies on graph + analytics tables already filter with
`org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))`.

Upstream extension: [ClickHouse/pg_clickhouse](https://github.com/ClickHouse/pg_clickhouse)
(pin **v0.10.0** or newer patch on the 0.10 line; CI claims PG 13–19, CH 23–26).

## 4. Architecture

```
agent_ro ──▶ context.v_agent_graph_* (security_invoker, current_tenant() in view)
                │
                ▼
             context.fdw_graph_*  (FOREIGN TABLE, no agent_ro SELECT)
                │  pg_clickhouse
                ▼
             ClickHouse gentle_space.graph_*
                + row policy on SQL_current_tenant_id
```

Same pattern for analytics `fdw_*` tables; agent-facing views are added when a tool needs them
(Task 4 for graph; later tasks for enquiry_fact / dailies). This design only **creates** the
foreign tables and grants for owner/control-plane roles — not a second set of agent views for
analytics beyond what Task 4 already plans for graph.

### 4.1 Tenancy — two layers (both required)

1. **Postgres:** views embed `org_id = public.current_tenant()` (F-19). `agent_ro` gets SELECT
   on those views only, never on `fdw_*`.
2. **ClickHouse:** row policies on `SQL_current_tenant_id`. The FDW session used by the
   Postgres owner (and any path that hits CH) must set that value to the same tenant UUID.

**Gate (blocking):** before marking B5 done, prove one of:

- `WHERE org_id = $<tenant>` on a foreign table **pushes down** and returns only that tenant’s
  rows against multi-tenant fixture data, or
- the FDW connection injects `SQL_current_tenant_id` for the duration of the query (document
  the exact SET / server option / GUC).

If neither works on the pinned extension version, **stop** — do not paper over with HTTP.

### 4.2 Credentials

- Dedicated ClickHouse user for FDW (read-only, subject to row policies) — not the ETL writer.
- Postgres `USER MAPPING` for the table-owner / migration role to that CH user.
- Host/port/db from env (compose: service hostname `clickhouse`; local port `8123` / native
  `9000` per driver option). Secrets stay in env / Compose — never in migration SQL committed
  with real passwords (use placeholders + local override, same pattern as `outbox_relay`).

## 5. Image change

File: `docker/Dockerfile.postgres`

- Keep existing AGE build.
- Add build deps for pg_clickhouse: `libcurl4-openssl-dev`, `uuid-dev`, `liblz4-dev`,
  `libzstd-dev`, `libssl-dev`, plus existing `build-essential` / `postgresql-server-dev-18`.
- Clone/pin `https://github.com/ClickHouse/pg_clickhouse.git` at tag `v0.10.0`, `make && make install`.
- Purge build deps after install (same pattern as AGE).
- Rebuild tag `gentle-space-pg:pg18-age` and recreate the `gentle-space-pg` container
  (volume preserved).

## 6. Postgres migration

**Numbering:** `103_pg_clickhouse_fdw` (extension + server + mappings + foreign tables only).

S9 plan’s Task 4 file `103_agent_graph_views` shifts to **`104_agent_graph_views`**.
Plan’s `104_agent_create_proposal` → **`105`**; plan’s `105` cost → **`106`**. Document the
shift in the S9 plan header when implementing (do not silently keep colliding numbers).

`103_pg_clickhouse_fdw.up.sql` (conceptual):

1. `CREATE EXTENSION IF NOT EXISTS pg_clickhouse;`
2. `CREATE SERVER IF NOT EXISTS clickhouse_analytics FOREIGN DATA WRAPPER clickhouse_fdw OPTIONS (...);`
3. `CREATE USER MAPPING IF NOT EXISTS FOR CURRENT_USER SERVER clickhouse_analytics OPTIONS (...);`
4. Explicit `CREATE FOREIGN TABLE` for each row in §3 (map CH types carefully; `JSON` / `LowCardinality` → supported PG types per extension docs).
5. **Revoke** any default grants; **do not** `GRANT SELECT ON context.fdw_* TO agent_ro`.

Down migration: drop foreign tables, user mapping, server; `DROP EXTENSION` only if nothing else depends on it.

## 7. What this unlocks

| Next | Depends on |
|------|------------|
| S9 Task 4 `v_agent_graph_*` + `graph-query.ts` | `fdw_graph_node` / `fdw_graph_edge` |
| Later analytics tools via Postgres | `fdw_enquiry_fact`, daily rollups |
| Task 7 as written (HTTP) | Still needs `campaign_performance_daily` in CH — **out of this design** |

## 8. Out of scope

- Replacing Task 7’s HTTP client in the same change set
- Importing `raw.*` into `context`
- PuppyGraph / querying the context graph via AGE
- Building `campaign_performance_daily` in ClickHouse
- Production TLS / Cloud ClickHouse hardening beyond env-driven server options

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Extension fails to build on `pgvector:pg18` + AGE image | Pin tag; fail CI/local build loudly; do not fall back to HTTP |
| Type mapping for `props JSON` / LowCardinality | Follow pg_clickhouse type map; integration test SELECT one row |
| Tenant setting not pushed to CH | Blocking gate in §4.1 |
| Rebuild loses local DB | Compose uses named volume — recreate container only |
| Migration password in git | Env substitution / documented local secrets only |

## 10. Success criteria

1. Rebuilt image: `CREATE EXTENSION pg_clickhouse;` succeeds.
2. `SELECT count(*) FROM context.fdw_graph_node` works as owner with tenant set (fixture).
3. `information_schema.role_table_grants` shows **no** `agent_ro` SELECT on any `fdw_*`.
4. Tenant isolation gate (§4.1) passes.
5. B5 marked **closed** in `docs/superpowers/specs/2026-08-12-open-questions-register.md`.
6. S9 Task 4 can create `v_agent_graph_*` without inventing local tables.

## 11. Self-review

- [x] No placeholder “TBD” for required decisions (pin, tables, numbering, gate)
- [x] No contradiction with B5 (FDW, not HTTP, for the graph path)
- [x] Scope B tables limited to what exists in CH today
- [x] Explicit non-goals (Task 7 HTTP, campaign_performance_daily, raw)
- [x] Migration renumber called out so Task 4 / 9 / cost do not collide
