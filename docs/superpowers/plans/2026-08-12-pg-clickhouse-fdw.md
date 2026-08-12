# pg_clickhouse FDW (B5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install ClickHouse’s official `pg_clickhouse` into `gentle-space-pg:pg18-age`, create `context.fdw_*` foreign tables for graph + analytics mirrors, prove tenant isolation, and close open-question B5 so S9 Task 4 can proceed.

**Architecture:** Bake `pg_clickhouse` v0.10.0 into `docker/Dockerfile.postgres` alongside AGE. One Postgres migration (`103_pg_clickhouse_fdw`) creates the extension, foreign server, user mapping to ClickHouse `tenant_reader`, and five explicit foreign tables under `context`. Agent role `agent_ro` gets **no** SELECT on `fdw_*`. Tenancy uses Postgres view predicates later plus ClickHouse row policies via `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '<uuid>'$$` (documented gate).

**Tech Stack:** PostgreSQL 18, Apache AGE, `ClickHouse/pg_clickhouse` v0.10.0, ClickHouse 25.8, Docker Compose, Vitest + `pg`

**Spec:** `docs/superpowers/specs/2026-08-12-pg-clickhouse-fdw-design.md`

**Worktree:** `/Users/swami/Documents/GentleSpace_Web/.worktrees/s9-mcp-context-server` on `feat/s9-mcp-context-server`

## Global Constraints

- Pin extension tag **`v0.10.0`** (or newer patch on 0.10.x only if v0.10.0 fails to build — document the bump).
- **No HTTP fallback** if FDW or the tenant gate fails.
- **No local Postgres tables** named `fdw_graph_*` / `fdw_enquiry_*` — foreign tables only.
- **No `GRANT SELECT … TO agent_ro` on any `fdw_*`.**
- Do **not** import `raw.*` or invent `campaign_performance_daily`.
- ClickHouse FDW user: existing **`tenant_reader`** (password from `CLICKHOUSE_TENANT_PASSWORD`, default `tenant`); profile `tenant` has `readonly=2` and fail-closed zero UUID for `SQL_current_tenant_id`.
- Binary driver default port **9000**; from the PG container use **`host.docker.internal`** on Docker Desktop Mac unless both compose files share a network named in Task 2.
- Migration renumber for later S9 work: Task 4 views → **`104_agent_graph_views`**; create_proposal → **`105`**; cost → **`106`**.

## File map

| File | Responsibility |
|------|----------------|
| `docker/Dockerfile.postgres` | Build AGE + pg_clickhouse into the image |
| `docker-compose.listings.yml` | Optional: extra_hosts / network so PG reaches CH |
| `docker-compose.clickhouse.yml` | Optional: join same network |
| `ads-agent/lib/db/migrations/103_pg_clickhouse_fdw.up.sql` | Extension, server, mapping, foreign tables |
| `ads-agent/lib/db/migrations/103_pg_clickhouse_fdw.down.sql` | Drop in reverse order |
| `ads-agent/mcp/context-server/fdw-tenant.gate.test.ts` | Live gate: extension, fdw existence, no agent_ro grants, tenant isolation |
| `ads-agent/.env.example` | Document `PG_CLICKHOUSE_*` / mapping-related vars |
| `docs/superpowers/specs/2026-08-12-open-questions-register.md` | Close B5 |
| `docs/superpowers/specs/2026-08-12-pg-clickhouse-fdw-design.md` | Status → accepted |
| `openmemory.md` | Index the FDW |

---

### Task 1: Bake `pg_clickhouse` into the Postgres image

**Files:**
- Modify: `docker/Dockerfile.postgres`
- Test: rebuild + `CREATE EXTENSION` inside a throwaway container (commands below)

**Interfaces:**
- Consumes: existing AGE build pattern in Dockerfile
- Produces: image `gentle-space-pg:pg18-age` with `pg_clickhouse` shared library installed

- [ ] **Step 1: Replace `docker/Dockerfile.postgres` with AGE + pg_clickhouse**

```dockerfile
FROM pgvector/pgvector:pg18
USER root
# Confirmed against `git ls-remote https://github.com/apache/age.git` at build time --
# AGE's branch names differ from its tag names, so this must not be guessed.
ARG AGE_BRANCH=release/PG18/1.8.0
ARG PG_CLICKHOUSE_REF=v0.10.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git postgresql-server-dev-18 \
      libreadline-dev zlib1g-dev flex bison \
      libcurl4-openssl-dev uuid-dev liblz4-dev libzstd-dev libssl-dev \
    && update-ca-certificates \
    && git clone --branch "${AGE_BRANCH}" --depth 1 https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age \
    && make PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config \
    && make install PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config \
    && rm -rf /tmp/age \
    && cd /tmp \
    && git clone --branch "${PG_CLICKHOUSE_REF}" --depth 1 https://github.com/ClickHouse/pg_clickhouse.git /tmp/pg_clickhouse \
    && cd /tmp/pg_clickhouse \
    && make PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config \
    && make install PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config \
    && rm -rf /tmp/pg_clickhouse \
    && apt-get purge -y --auto-remove build-essential git postgresql-server-dev-18 \
    && rm -rf /var/lib/apt/lists/* \
    && echo "shared_preload_libraries = 'age'" >> /usr/share/postgresql/postgresql.conf.sample
USER postgres
```

- [ ] **Step 2: Rebuild the image from the worktree root**

Run:

```bash
cd /Users/swami/Documents/GentleSpace_Web/.worktrees/s9-mcp-context-server
docker compose -f docker-compose.listings.yml build db --no-cache
```

Expected: build succeeds; image `gentle-space-pg:pg18-age` updated.

- [ ] **Step 3: Recreate the PG container (keep volume) and verify the extension loads**

Run:

```bash
docker compose -f docker-compose.listings.yml up -d db
sleep 3
docker exec gentle-space-pg psql -U gentle -d gentle_space_listings -c "CREATE EXTENSION IF NOT EXISTS pg_clickhouse;"
docker exec gentle-space-pg psql -U gentle -d gentle_space_listings -tAc "SELECT extversion FROM pg_extension WHERE extname='pg_clickhouse'"
```

Expected: `CREATE EXTENSION` succeeds; a version string is printed (e.g. `0.10.0`).

If `CREATE EXTENSION` fails with missing `.so`, **stop** — fix the Dockerfile; do not proceed to Task 3.

- [ ] **Step 4: Commit**

```bash
git add docker/Dockerfile.postgres
git commit -m "$(cat <<'EOF'
build(postgres): install pg_clickhouse v0.10.0 beside AGE

Required for S9 B5 — MCP context server reads ClickHouse graph/analytics
through Postgres foreign tables, not HTTP.
EOF
)"
```

---

### Task 2: Make the PG container reach ClickHouse

**Files:**
- Modify: `docker-compose.listings.yml`
- Modify: `docker-compose.clickhouse.yml` (only if using a shared network)

**Interfaces:**
- Consumes: ClickHouse published ports `9000` (binary) and `8123` (http) on the host
- Produces: reliable hostname from inside `gentle-space-pg` for `CREATE SERVER`

- [ ] **Step 1: Prefer `extra_hosts` on Docker Desktop Mac (smallest change)**

In `docker-compose.listings.yml`, under `db:`, add:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

- [ ] **Step 2: Recreate db and probe ClickHouse from inside PG**

Run:

```bash
docker compose -f docker-compose.listings.yml up -d db
docker exec gentle-space-pg bash -c 'getent hosts host.docker.internal; (exec 3<>/dev/tcp/host.docker.internal/9000 && echo binary_ok) || echo binary_fail'
```

Expected: `host.docker.internal` resolves; `binary_ok`.

If binary fails, try HTTP port 8123 and plan to use `driver 'http'` in Task 3 — still FDW, not app-level HTTP.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.listings.yml docker-compose.clickhouse.yml
git commit -m "$(cat <<'EOF'
chore(compose): let gentle-space-pg reach ClickHouse via host.docker.internal

FDW CREATE SERVER needs a stable host from inside the PG18 container.
EOF
)"
```

---

### Task 3: Migration `103_pg_clickhouse_fdw`

**Files:**
- Create: `ads-agent/lib/db/migrations/103_pg_clickhouse_fdw.up.sql`
- Create: `ads-agent/lib/db/migrations/103_pg_clickhouse_fdw.down.sql`
- Modify: `ads-agent/.env.example` (document connection knobs)

**Interfaces:**
- Consumes: extension from Task 1; network from Task 2; CH user `tenant_reader`
- Produces: `context.fdw_graph_node`, `context.fdw_graph_edge`, `context.fdw_enquiry_fact`, `context.fdw_portal_event_daily`, `context.fdw_search_performed_daily`

**Env for local apply (not committed secrets):**

```bash
export DATABASE_URL=postgres://gentle:gentle@localhost:5433/gentle_space_listings
export PG_CLICKHOUSE_HOST=host.docker.internal
export PG_CLICKHOUSE_PORT=9000
export PG_CLICKHOUSE_USER=tenant_reader
export PG_CLICKHOUSE_PASSWORD=tenant
```

Note: `CREATE SERVER` / `USER MAPPING` OPTIONS are literals in SQL. For local/dev, bake the compose defaults into the migration comments and use the values below. Production overrides via a follow-up `ALTER SERVER` runbook in `.env.example` — do **not** put production passwords in the migration file.

- [ ] **Step 1: Write `103_pg_clickhouse_fdw.up.sql`**

```sql
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
```

If `OPTIONS (database …)` is rejected by the installed FDW version, fall back to the
documented option name from `doc/pg_clickhouse.md` for that tag (`dbname` on the
**server** already points at one DB — then use separate servers per CH database, or
`IMPORT`/`table_name` only within `gentle_space` and a second server for `analytics`).
**Do not guess** — read the installed extension docs inside the container:

```bash
docker exec gentle-space-pg psql -U gentle -d gentle_space_listings -c "\dx+ pg_clickhouse"
```

- [ ] **Step 2: Write `103_pg_clickhouse_fdw.down.sql`**

```sql
BEGIN;
DROP FOREIGN TABLE IF EXISTS context.fdw_search_performed_daily;
DROP FOREIGN TABLE IF EXISTS context.fdw_portal_event_daily;
DROP FOREIGN TABLE IF EXISTS context.fdw_enquiry_fact;
DROP FOREIGN TABLE IF EXISTS context.fdw_graph_edge;
DROP FOREIGN TABLE IF EXISTS context.fdw_graph_node;
DROP USER MAPPING IF EXISTS FOR agent_ro SERVER clickhouse_analytics;
DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER clickhouse_analytics;
DROP SERVER IF EXISTS clickhouse_analytics CASCADE;
DROP EXTENSION IF EXISTS pg_clickhouse;
COMMIT;
```

- [ ] **Step 3: Apply the migration**

Run:

```bash
cd /Users/swami/Documents/GentleSpace_Web/.worktrees/s9-mcp-context-server/ads-agent
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/103_pg_clickhouse_fdw.up.sql
psql "$DATABASE_URL" -tAc "SELECT foreign_table_schema||'.'||foreign_table_name FROM information_schema.foreign_tables ORDER BY 1"
```

Expected: five `context.fdw_*` rows listed.

- [ ] **Step 4: Smoke SELECT as owner with session settings**

Run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
LOAD 'pg_clickhouse';
SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '00000000-0000-0000-0000-000000000000'$$;
SELECT count(*) AS n FROM context.fdw_graph_node;
SQL
```

Expected: query returns (likely `0` on empty graph) **without** ERROR.

- [ ] **Step 5: Append to `ads-agent/.env.example`**

```bash
# pg_clickhouse FDW (B5) — CREATE SERVER defaults in migration 103; override in prod:
# PG_CLICKHOUSE_HOST=clickhouse
# PG_CLICKHOUSE_PORT=8123
# PG_CLICKHOUSE_USER=tenant_reader
# PG_CLICKHOUSE_PASSWORD=...
```

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/migrations/103_pg_clickhouse_fdw.up.sql \
  ads-agent/lib/db/migrations/103_pg_clickhouse_fdw.down.sql \
  ads-agent/.env.example
git commit -m "$(cat <<'EOF'
feat(db): pg_clickhouse FDW foreign tables for graph and analytics

Closes the B5 gap S9 Task 4 needs. agent_ro gets no SELECT on fdw_*.
EOF
)"
```

---

### Task 4: Tenant isolation gate test

**Files:**
- Create: `ads-agent/mcp/context-server/fdw-tenant.gate.test.ts`

**Interfaces:**
- Consumes: foreign tables from Task 3; `DATABASE_URL`; ClickHouse HTTP for fixture insert as `etl_writer`
- Produces: pass/fail gate for B5 success criteria §10

- [ ] **Step 1: Write the gate test**

```ts
// ads-agent/mcp/context-server/fdw-tenant.gate.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const LIVE = Boolean(process.env.DATABASE_URL) && Boolean(process.env.CLICKHOUSE_URL);
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SNAP = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NODE_A = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const NODE_B = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const pool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function chInsert(sql: string): Promise<void> {
  const base = (process.env.CLICKHOUSE_URL ?? "http://localhost:8123").replace(/\/+$/, "");
  const user = process.env.CLICKHOUSE_ETL_USER ?? "etl_writer";
  const password = process.env.CLICKHOUSE_ETL_PASSWORD ?? "etl";
  const auth = Buffer.from(`${user}:${password}`).toString("base64");
  const res = await fetch(`${base}/?`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: sql,
  });
  if (!res.ok) throw new Error(`clickhouse insert failed: ${res.status} ${await res.text()}`);
}

beforeAll(async () => {
  if (!LIVE) return;
  await chInsert(`
    INSERT INTO gentle_space.graph_node
      (org_id, snapshot_id, node_id, node_kind, label, subject_ref, props)
    VALUES
      ('${ORG_A}', '${SNAP}', '${NODE_A}', 'Space', 'A', NULL, '{{}}'),
      ('${ORG_B}', '${SNAP}', '${NODE_B}', 'Space', 'B', NULL, '{{}}')
  `);
});

afterAll(async () => {
  if (LIVE) {
    await chInsert(
      `ALTER TABLE gentle_space.graph_node DELETE WHERE snapshot_id = '${SNAP}'`,
    ).catch(() => {});
  }
  await pool?.end();
});

describe.skipIf(!LIVE)("pg_clickhouse FDW tenant gate (B5)", () => {
  it("extension pg_clickhouse is installed", async () => {
    const { rows } = await pool!.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_clickhouse'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("exposes the five context.fdw_* foreign tables", async () => {
    const { rows } = await pool!.query<{ n: string }>(
      `SELECT foreign_table_name AS n FROM information_schema.foreign_tables
        WHERE foreign_table_schema = 'context' AND foreign_table_name LIKE 'fdw_%'
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.n)).toEqual([
      "fdw_enquiry_fact",
      "fdw_graph_edge",
      "fdw_graph_node",
      "fdw_portal_event_daily",
      "fdw_search_performed_daily",
    ]);
  });

  it("grants agent_ro no SELECT on any fdw_* table", async () => {
    const { rows } = await pool!.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'agent_ro' AND table_name LIKE 'fdw_%'`,
    );
    expect(rows).toEqual([]);
  });

  it("isolates tenants via pg_clickhouse.session_settings SQL_current_tenant_id", async () => {
    const client = await pool!.connect();
    try {
      await client.query(`LOAD 'pg_clickhouse'`);
      await client.query(
        `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${ORG_A}'$$`,
      );
      const { rows: a } = await client.query<{ node_id: string }>(
        `SELECT node_id::text FROM context.fdw_graph_node WHERE snapshot_id = $1`,
        [SNAP],
      );
      expect(a.map((r) => r.node_id)).toEqual([NODE_A]);

      await client.query(
        `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${ORG_B}'$$`,
      );
      const { rows: b } = await client.query<{ node_id: string }>(
        `SELECT node_id::text FROM context.fdw_graph_node WHERE snapshot_id = $1`,
        [SNAP],
      );
      expect(b.map((r) => r.node_id)).toEqual([NODE_B]);
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Step 2: Run the gate**

Run:

```bash
cd /Users/swami/Documents/GentleSpace_Web/.worktrees/s9-mcp-context-server/ads-agent
DATABASE_URL=postgres://gentle:gentle@localhost:5433/gentle_space_listings \
CLICKHOUSE_URL=http://localhost:8123 \
CLICKHOUSE_ETL_PASSWORD=etl \
npx vitest run mcp/context-server/fdw-tenant.gate.test.ts
```

Expected: all tests PASS.

If the isolation test returns both orgs’ rows, **stop** — session_settings is not applied; dig into FDW docs / try `driver 'http'` with settings in the URL. Do not close B5.

- [ ] **Step 3: Commit**

```bash
git add ads-agent/mcp/context-server/fdw-tenant.gate.test.ts
git commit -m "$(cat <<'EOF'
test(mcp-context): B5 FDW tenant isolation gate

Proves pg_clickhouse session_settings pins SQL_current_tenant_id and that
agent_ro has no direct SELECT on fdw_*.
EOF
)"
```

---

### Task 5: Close B5 in docs + openmemory

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-open-questions-register.md`
- Modify: `docs/superpowers/specs/2026-08-12-pg-clickhouse-fdw-design.md` (status → accepted)
- Modify: `openmemory.md`
- Modify: `docs/superpowers/plans/2026-08-12-s9-s9a-mcp-context-server-tracing.md` — header note only: migration **103** is FDW; Task 4 views are **104**; create_proposal **105**; cost **106**

- [ ] **Step 1: Move B5 from Blocking to a Closed section (or strike with resolution)**

Add under a `## Closed` heading (create if missing):

```markdown
| B5 | `pg_clickhouse` built at S9 | Resolved 2026-08-12: extension in `docker/Dockerfile.postgres`, migration `103_pg_clickhouse_fdw`, gate `fdw-tenant.gate.test.ts`. Spec: `2026-08-12-pg-clickhouse-fdw-design.md`. |
```

Remove B5 from the Blocking table (or mark resolved in-place — prefer Closed section so history remains).

- [ ] **Step 2: Set design status to accepted**

In `2026-08-12-pg-clickhouse-fdw-design.md` line 4: `Status: **accepted**`.

- [ ] **Step 3: Update `openmemory.md` S9 row** to mention `103` FDW + gate.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-open-questions-register.md \
  docs/superpowers/specs/2026-08-12-pg-clickhouse-fdw-design.md \
  docs/superpowers/plans/2026-08-12-s9-s9a-mcp-context-server-tracing.md \
  openmemory.md
git commit -m "$(cat <<'EOF'
docs: close B5 — pg_clickhouse FDW shipped for S9

Record migration renumber (Task 4 views → 104) and point at the gate test.
EOF
)"
```

---

## Plan self-review

| Spec requirement | Task |
|------------------|------|
| Bake pg_clickhouse into Dockerfile | Task 1 |
| Rebuild / CREATE EXTENSION | Task 1 |
| Network PG → CH | Task 2 |
| Five foreign tables, no agent_ro SELECT | Task 3 |
| tenant_reader mapping | Task 3 |
| Tenant gate (session_settings) | Task 4 |
| Close B5 + design status | Task 5 |
| No HTTP fallback / no shadow tables / no raw / no campaign_performance | Global + Task 3 |
| Migration renumber note | Global + Task 5 |

**Placeholder scan:** none intentional.  
**Type note for later Task 4:** CH/FDW edge column is `relationship_kind`; S9 plan templates that say `e.relationship` must be updated when implementing `104_agent_graph_views`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-12-pg-clickhouse-fdw.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans, checkpoints between tasks  

Which approach?
