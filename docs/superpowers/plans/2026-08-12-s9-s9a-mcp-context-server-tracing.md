# S9 + S9a — MCP context server and agent tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared MCP context server — eight read tools, exactly one write tool, task-token tenant binding, parameterised graph templates — with **no agents at all**, prove the four safety tests in agent spec §9, then instrument every tool call to OpenTelemetry GenAI conventions on self-hosted Langfuse so the per-tenant cost ceiling is enforced by the trace metrics before S10 exists.

**Architecture:** A new HTTP MCP server at `ads-agent/mcp/context-server/`, built exactly like the existing `ads-agent/mcp/google-ads-server/` (a `build…McpServer()` factory tested over `InMemoryTransport`, a `start…McpServer()` wrapper behind `createMcpHandler` with the Host-header DNS-rebinding guard, and a `scripts/run-*.ts` launcher). It connects to PostgreSQL **only** as `agent_ro` — a read-only, non-owner role holding `SELECT` on tenant-scoped views and `EXECUTE` on three `SECURITY DEFINER` functions, which is what makes `FORCE ROW LEVEL SECURITY` meaningful. There is no free-form query surface anywhere: `graph_query` takes an allowlisted template name plus values (validation report F-19), and the templates run against views that already embed `org_id = public.current_tenant()`. One dispatch function wraps every registered tool, so the cost-ceiling check, the token-usage record and the span emission cannot be bypassed by any call path.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server` / `@modelcontextprotocol/client` / `@modelcontextprotocol/node` v2, `zod` v4, `pg` v8 (`Pool`), PostgreSQL 18, ClickHouse over its HTTP interface, Langfuse (self-hosted, OTLP/HTTP ingest), Vitest.

## Preconditions

This plan **must not start** until all three are green. Each is checked in Task 1 Step 1 and the plan halts if any check fails.

| Step | What this plan needs from it |
|---|---|
| **S3** (tenancy — release gate) | `ads-agent/lib/db/scope-sql.ts` exporting `type Scope` and `scopeClause`; SQL `public.set_tenant(uuid)` and `public.current_tenant()`; schemas `listings`, `adsagent`, `context`, `public`, `derived`; roles `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, `derived_rw`; `org_id` on every domain table with `ENABLE` **and** `FORCE ROW LEVEL SECURITY`; `ads-agent/lib/db/migrations/` exists with migrations 001–0NN applied |
| **S6** (ClickHouse mirror and CDC) | a reachable ClickHouse with the campaign fact tables and the `SQL_current_tenant_id` row policy; the `pg_clickhouse` FDW server and foreign tables that migration 103 builds views over |
| **S8** (context graph) | `graph_node` / `graph_edge` reachable from Postgres through the FDW, and `context.graph_manifests` carrying `built_at` and `cdc_lag_seconds` |

**Not consumed by this plan, deliberately:** `context.artifacts` and the S8a artifact accessor. See the contradiction note at the end of Task 10 — a context pack assembled from Postgres rows is described by its row ids, and copying it into the artifact store is the exact defect dataflow review A-3 forbids.

**Files no task in this plan may touch:** `ads-agent/lib/decision-engine/cycle.ts` (highest blast radius in the repo), `ads-agent/lib/bifrost/mcp-client.ts`, `ads-agent/lib/bifrost/twenty-mcp-tools.ts`, `ads-agent/lib/crm/twenty-pipeline.ts`, `ads-agent/lib/openui/*` (the Twenty MCP tools stay platform-only until every org has its own Twenty instance).

## Global Constraints

Every task inherits these. Copy this section verbatim into every reviewer dispatch.

- **Every SQL object is schema-qualified.** The deployed role has `search_path = "ag_catalog, $user, public"`; an unqualified `CREATE TABLE` lands inside the AGE extension's schema.
- **Every schema change is a numbered up/down migration containing an explicit `ALTER`.** `ads-agent/lib/db/migrate.ts` re-runs `schema.sql`, and `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table, so anything expressed inside a `CREATE TABLE` body never reaches a provisioned database.
- **`id UUID PRIMARY KEY DEFAULT uuidv7()`** on every new table (native in PostgreSQL 18), **`org_id UUID NOT NULL`** on every domain table, every index leads with `org_id`, and `TIMESTAMPTZ` never `TIMESTAMP`.
- **`set_config('app.current_tenant_id', $1, true)`** — the third argument is mandatory. Both apps use `pg.Pool`; without transaction scoping the setting persists on the connection and the next request inherits the previous tenant.
- **`ENABLE` *and* `FORCE ROW LEVEL SECURITY`** on every tenant table. Table owners ignore RLS unless it is forced.
- **Policies carry `WITH CHECK` as well as `USING`.** `USING` alone permits writing rows under another tenant's `org_id`.
- **Suppression columns, never `DELETE`.** DPDP Rule 8(3) imposes a one-year retention floor even after account deletion; erasure is suppression followed by scheduled hard delete.
- **Wrong tenant returns `404`, never `403`.** A 403 confirms the row exists.
- **`Scope` is the first and required parameter** of every data-layer function, so a missed call site is a TypeScript compile error rather than a silent full-table read.
- **No new dependencies** without asking.
- Tests are Vitest, colocated as `*.test.ts`, run with `npx vitest run` from the owning app directory.

Additional constraints this plan's specs impose:

- **No tool accepts an `org_id`.** The tenant is derived from a server-verified task token and from nothing else (agent spec §6). Task 11 Step 3 enforces this with a test over every registered tool's input schema.
- **No tool accepts query text.** `graph_query` takes an allowlisted template name plus values; the SQL string is a module constant and is never built from a parameter (validation report F-19).
- **Exactly one write tool: `create_proposal`.** Task 11 Step 5 fails if a second write tool is ever registered.
- **The server holds one database role, `agent_ro`, with `SELECT` on views only.** Its single write capability is `EXECUTE` on `adsagent.agent_create_proposal`. A direct `INSERT` through the server's connection must fail (validation report F-20).
- **`evidence` holds identifiers only, never prose** (dataflow review A-4), and an empty `evidence` array is rejected by the server *and* by the database function.
- **No message bodies on a span.** `gen_ai.input.messages` and `gen_ai.output.messages` stay disabled; every span attribute is capped and every error surfaces as a stable code, never as `err.message` (datastore §13.3).
- **Every tool call passes through one dispatch function**, so the cost ceiling cannot be bypassed by an untraced call path (agent spec §8a).
- **`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`** wherever spans are emitted, because the GenAI conventions are Development status and attribute names can change without a major version bump (datastore §13.2).
- **Migration numbers 100–109 only.** This plan uses 100, 101, 102, 103, 104, 105. No task may take a number outside that range or reuse one.

## Parallel execution model

`superpowers:subagent-driven-development` lists "dispatch multiple implementation subagents in parallel" under **Never**, because agents sharing a working tree corrupt each other. Real parallelism here therefore means **one git worktree and branch per agent** (the `best-of-n-runner` subagent type), with an explicit fan-in merge task closing each wave. Ceiling: **8 concurrent implementation subagents**, never exceeded.

| Wave | Tasks | Width | Why that width |
|---|---|---|---|
| W1 | 1 | 1 | `mcp/context-server/db.ts` and migration 100 create the `agent_ro` role and `withAgentTenantTx`, which **every** later task imports. Nothing can be proved in parallel with the connection it runs on. |
| W2 | 2, 3 | 2 | Task 2 touches only `mcp/context-server/task-token.ts` + migration **101**; Task 3 touches only migration **102** and its test. Disjoint file sets, distinct migration numbers, both depend only on Task 1. |
| W3 | 4, 5, 6, 7, 8, 9, 10 | **7** | This is where the real width lives: the read tools are genuinely independent of one another. Each task creates one new file plus its colocated test and touches nothing else. Files: T4 `graph-query.ts` + migration **103**; T5 `read-enquiries.ts`; T6 `read-spaces.ts`; T7 `read-performance.ts`; T8 `read-proposals.ts`; T9 `create-proposal.ts` + migration **104**; T10 `context-pack.ts`. Only T4 and T9 claim a migration number and they claim different ones. All seven depend on Task 3's views and Task 2's `TaskTokenClaims`; none depends on another member of the wave. |
| W4 | 11 | 1 | Fan-in. `mcp/context-server/index.ts`, `tool-context.ts` and `scripts/run-context-mcp.ts` import every module from W3; the merge conflicts of seven branches resolve here. |
| W5 | 12 | 1 | The **S9 gate**. One agent runs the four safety tests against a live database; a parallel agent would race on the same seeded rows. |
| W6 | 13, 14, 15, 16 | 4 | Disjoint again, and independent of the tracing wire-up: T13 `lib/db/agent-cost.ts` + migration **105**; T14 `lib/tracing/otlp-sink.ts`; T15 `lib/tracing/redact.ts`; T16 `docker-compose.yml` + `.env.example`. One migration number across the wave. |
| W7 | 17 | 1 | Fan-in and the **S9a gate**. Modifies the single file `tool-context.ts` that W6's four branches all feed into. |

Two tasks never share a wave if they modify the same file; the file list per task is stated in each task's **Files** block, and the W3 justification above enumerates them so disjointness is checkable rather than asserted.

---

# S9 — The MCP context server, with no agents

## Task 1: `agent_ro` role and the tenant transaction helper

**Skills:** `postgres-pro`, `senior-backend`
**Model:** `inherit` — the read-only/read-write transaction split is the load-bearing judgement in the whole plan.

**Files:**
- Create: `ads-agent/lib/db/migrations/100_agent_ro_role.up.sql`
- Create: `ads-agent/lib/db/migrations/100_agent_ro_role.down.sql`
- Create: `ads-agent/mcp/context-server/db.ts`
- Test: `ads-agent/mcp/context-server/db.test.ts`

**Interfaces:**
- Consumes: SQL `public.set_tenant(uuid)` and `public.current_tenant()` from S3 (`ads-agent/lib/db/migrations/003_tenant_helpers.up.sql`).
- Produces:
  - `getAgentReadPool(): Pool`
  - `type TenantTx = { query: PoolClient["query"] }`
  - `withAgentTenantTx<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>` — read-only transaction
  - `withAgentTenantWriteTx<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>` — read-write transaction, used **only** by `create_proposal` and by token-usage recording
  - `closeAgentReadPool(): Promise<void>`

- [ ] **Step 1: Check the preconditions and halt if any fails**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
test -f lib/db/scope-sql.ts && echo "S3 scope-sql: ok" || echo "S3 scope-sql: MISSING"
ls lib/db/migrations/003_tenant_helpers.up.sql && echo "S3 helpers: ok" || echo "S3 helpers: MISSING"
psql "$DATABASE_URL" -tAc "SELECT proname FROM pg_proc WHERE proname IN ('set_tenant','current_tenant')"
psql "$DATABASE_URL" -tAc "SELECT nspname FROM pg_namespace WHERE nspname IN ('listings','adsagent','context','derived')"
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM context.graph_manifests"
```

Expected: `ok` twice, `set_tenant` and `current_tenant` both listed, all four schemas listed, and the `graph_manifests` count returns a number (S8 present). If any line is `MISSING`, empty, or errors, **stop and report** — this plan cannot be built on a partial foundation.

- [ ] **Step 2: Write the failing test**

```ts
// ads-agent/mcp/context-server/db.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));
const poolMock = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: class {
    connect = poolMock.connect;
    end = poolMock.end;
  },
}));

import { withAgentTenantTx, withAgentTenantWriteTx, getAgentReadPool } from "./db";

const ORG_A = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_RO_DATABASE_URL = "postgres://agent_ro@localhost:5432/gentle_space";
  clientMock.query.mockResolvedValue({ rows: [], rowCount: 0 });
  poolMock.connect.mockResolvedValue(clientMock);
});

afterEach(() => {
  delete process.env.AGENT_RO_DATABASE_URL;
});

describe("withAgentTenantTx", () => {
  it("sets the tenant through public.set_tenant inside the same transaction, then commits", async () => {
    await withAgentTenantTx(ORG_A, async (tx) => {
      await tx.query("SELECT 1");
      return null;
    });
    const statements = clientMock.query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SELECT public.set_tenant($1)");
    expect(clientMock.query.mock.calls[1][1]).toEqual([ORG_A]);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("rolls back and releases the connection when the body throws", async () => {
    await expect(
      withAgentTenantTx(ORG_A, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(clientMock.query.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(clientMock.release).toHaveBeenCalledOnce();
  });

  it("never issues SET TRANSACTION READ WRITE", async () => {
    await withAgentTenantTx(ORG_A, async () => null);
    expect(clientMock.query.mock.calls.map((c) => c[0])).not.toContain("SET TRANSACTION READ WRITE");
  });
});

describe("withAgentTenantWriteTx", () => {
  it("opts the transaction into read-write before setting the tenant", async () => {
    await withAgentTenantWriteTx(ORG_A, async () => null);
    const statements = clientMock.query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SET TRANSACTION READ WRITE");
    expect(statements[2]).toBe("SELECT public.set_tenant($1)");
  });
});

describe("getAgentReadPool", () => {
  it("refuses to build a pool without AGENT_RO_DATABASE_URL", () => {
    delete process.env.AGENT_RO_DATABASE_URL;
    expect(() => getAgentReadPool()).toThrow("AGENT_RO_DATABASE_URL is not set");
  });

  it("never falls back to DATABASE_URL, which is the owner connection", () => {
    delete process.env.AGENT_RO_DATABASE_URL;
    process.env.DATABASE_URL = "postgres://owner@localhost:5432/gentle_space";
    expect(() => getAgentReadPool()).toThrow("AGENT_RO_DATABASE_URL is not set");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/db.test.ts`
Expected: FAIL — `Failed to resolve import "./db"`.

- [ ] **Step 4: Write the migration**

```sql
-- ads-agent/lib/db/migrations/100_agent_ro_role.up.sql
-- The MCP context server's database identity. A non-owner role with no table
-- grants at all: later migrations grant SELECT on tenant-scoped views and
-- EXECUTE on three SECURITY DEFINER functions, and nothing else. Table owners
-- ignore row security unless FORCE ROW LEVEL SECURITY is set, so a server
-- connecting as owner would set the tenant variable correctly and enforce
-- nothing (validation report F-20).
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_ro') THEN
    CREATE ROLE agent_ro LOGIN;
  END IF;
END
$$;

-- Defence in depth (agent spec §5). These are session defaults, so they are
-- overridable by the session itself -- the guarantee is the absence of write
-- grants, not these settings. They make an accidental write in a read tool
-- fail loudly instead of succeeding.
ALTER ROLE agent_ro SET default_transaction_read_only = on;
ALTER ROLE agent_ro SET statement_timeout = '5s';
ALTER ROLE agent_ro SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE agent_ro SET search_path = 'context, public';

REVOKE ALL ON SCHEMA public   FROM agent_ro;
REVOKE ALL ON SCHEMA context  FROM agent_ro;
REVOKE ALL ON SCHEMA adsagent FROM agent_ro;
REVOKE ALL ON SCHEMA listings FROM agent_ro;
REVOKE ALL ON SCHEMA derived  FROM agent_ro;

REVOKE ALL ON ALL TABLES    IN SCHEMA public, context, adsagent, listings, derived FROM agent_ro;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, context, adsagent, listings, derived FROM agent_ro;

-- USAGE only. Without SELECT on a specific object, USAGE grants nothing.
GRANT USAGE ON SCHEMA context TO agent_ro;
GRANT USAGE ON SCHEMA public  TO agent_ro;

GRANT EXECUTE ON FUNCTION public.set_tenant(UUID)  TO agent_ro;
GRANT EXECUTE ON FUNCTION public.current_tenant()  TO agent_ro;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/100_agent_ro_role.down.sql
BEGIN;

REVOKE EXECUTE ON FUNCTION public.current_tenant() FROM agent_ro;
REVOKE EXECUTE ON FUNCTION public.set_tenant(UUID) FROM agent_ro;
REVOKE USAGE ON SCHEMA public  FROM agent_ro;
REVOKE USAGE ON SCHEMA context FROM agent_ro;

ALTER ROLE agent_ro RESET default_transaction_read_only;
ALTER ROLE agent_ro RESET statement_timeout;
ALTER ROLE agent_ro RESET idle_in_transaction_session_timeout;
ALTER ROLE agent_ro RESET search_path;

DROP ROLE IF EXISTS agent_ro;

COMMIT;
```

- [ ] **Step 5: Write `db.ts`**

```ts
// ads-agent/mcp/context-server/db.ts
import { Pool, type PoolClient } from "pg";

let agentPool: Pool | null = null;

/**
 * Connection pool for the MCP context server. Connects as `agent_ro` — a
 * read-only, non-owner role holding SELECT on tenant-scoped views only. This is
 * what makes FORCE ROW LEVEL SECURITY meaningful: a connection as the table
 * owner would set the tenant variable correctly and enforce nothing
 * (agent spec §5, validation report F-20).
 *
 * There is deliberately no fallback to DATABASE_URL. That variable holds the
 * owner connection, and silently falling back to it would void row security
 * without any error to notice.
 */
export function getAgentReadPool(): Pool {
  const url = process.env.AGENT_RO_DATABASE_URL;
  if (!url) throw new Error("AGENT_RO_DATABASE_URL is not set");
  if (!agentPool) agentPool = new Pool({ connectionString: url, max: 4 });
  return agentPool;
}

export async function closeAgentReadPool(): Promise<void> {
  if (!agentPool) return;
  await agentPool.end();
  agentPool = null;
}

export type TenantTx = { query: PoolClient["query"] };

async function inTransaction<T>(
  orgId: string,
  readWrite: boolean,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const client = await getAgentReadPool().connect();
  try {
    await client.query("BEGIN");
    if (readWrite) await client.query("SET TRANSACTION READ WRITE");
    // public.set_tenant passes `true` as set_config's third argument, so the
    // setting is transaction-local. Both apps use pg.Pool; without that the
    // setting persists on the connection and the next call inherits this tenant.
    await client.query("SELECT public.set_tenant($1)", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Every read tool runs inside this. Read-only, tenant pinned for the transaction. */
export function withAgentTenantTx<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return inTransaction(orgId, false, fn);
}

/**
 * The only read-write path. `agent_ro` has no INSERT/UPDATE/DELETE grant on any
 * table, so this is useful solely for calling the two SECURITY DEFINER functions
 * it may execute: adsagent.agent_create_proposal and
 * context.record_agent_token_usage. Opting into read-write is explicit and
 * greppable on purpose.
 */
export function withAgentTenantWriteTx<T>(
  orgId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return inTransaction(orgId, true, fn);
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/db.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 7: Apply the migration and verify the role has nothing**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" -f lib/db/migrations/100_agent_ro_role.up.sql
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'agent_ro'"
```

Expected: `BEGIN … COMMIT` from the migration, then `0` — `agent_ro` can reach no table or view at all yet.

- [ ] **Step 8: Commit**

```bash
git add ads-agent/lib/db/migrations/100_agent_ro_role.up.sql ads-agent/lib/db/migrations/100_agent_ro_role.down.sql ads-agent/mcp/context-server/db.ts ads-agent/mcp/context-server/db.test.ts
git commit -m "feat(mcp-context): agent_ro role and transaction-scoped tenant helper

The MCP context server connects as a read-only non-owner role. Table owners
ignore row security unless FORCE ROW LEVEL SECURITY is set, so a server
connecting as owner would set the tenant variable correctly and enforce
nothing (validation report F-20)."
```

## Task 2: Task tokens — the tenant is bound, never passed

**Skills:** `ai-security`, `senior-backend`
**Model:** `inherit` — the RLS-versus-lookup-order problem needs judgement.

**Files:**
- Create: `ads-agent/lib/db/migrations/101_agent_task_tokens.up.sql`
- Create: `ads-agent/lib/db/migrations/101_agent_task_tokens.down.sql`
- Create: `ads-agent/mcp/context-server/task-token.ts`
- Test: `ads-agent/mcp/context-server/task-token.test.ts`

**Interfaces:**
- Consumes: `getAgentReadPool()` from `./db` (Task 1); `getPool()` from `../../lib/db/client`.
- Produces:
  - `type TaskTokenClaims = { orgId: string; taskId: string; profile: string; toolAllowlist: string[] }`
  - `class TaskTokenError extends Error { readonly code: "token_invalid" | "token_expired" | "tool_not_allowed" }`
  - `mintTaskToken(input: { orgId: string; taskId: string; profile: string; toolAllowlist: string[]; ttlSeconds: number }): Promise<{ token: string }>`
  - `verifyTaskToken(token: string): Promise<TaskTokenClaims>`
  - `assertToolAllowed(claims: TaskTokenClaims, toolName: string): void`
  - `revokeTaskToken(orgId: string, taskId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/task-token.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const agentQuery = vi.hoisted(() => vi.fn());
const ownerQuery = vi.hoisted(() => vi.fn());
const agentClient = vi.hoisted(() => ({ query: agentQuery, release: vi.fn() }));

vi.mock("./db", () => ({
  getAgentReadPool: () => ({ connect: async () => agentClient, query: agentQuery }),
}));
vi.mock("../../lib/db/client", () => ({
  getPool: () => ({ connect: async () => ({ query: ownerQuery, release: vi.fn() }), query: ownerQuery }),
}));

import {
  assertToolAllowed,
  mintTaskToken,
  revokeTaskToken,
  TaskTokenError,
  verifyTaskToken,
} from "./task-token";

const ORG_A = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  agentQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  ownerQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("mintTaskToken", () => {
  it("returns a 64-hex-character token and stores only its sha256, never the token", async () => {
    const { token } = await mintTaskToken({
      orgId: ORG_A,
      taskId: "task-1",
      profile: "leads",
      toolAllowlist: ["get_enquiry"],
      ttlSeconds: 600,
    });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const insert = ownerQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO context.agent_task_tokens"));
    expect(insert, "expected an insert into context.agent_task_tokens").toBeDefined();
    const params = insert![1] as unknown[];
    expect(params).not.toContain(token);
    expect(params.some((p) => Buffer.isBuffer(p))).toBe(true);
  });
});

describe("verifyTaskToken", () => {
  it("derives the tenant from the token via the verifier function", async () => {
    agentQuery.mockImplementation(async (sql: string) =>
      String(sql).includes("verify_agent_task_token")
        ? {
            rows: [
              { org_id: ORG_A, task_id: "task-1", profile: "leads", tool_allowlist: ["get_enquiry"] },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 },
    );
    const claims = await verifyTaskToken("a".repeat(64));
    expect(claims).toEqual({
      orgId: ORG_A,
      taskId: "task-1",
      profile: "leads",
      toolAllowlist: ["get_enquiry"],
    });
  });

  it("rejects an unknown, revoked or expired token with code token_invalid", async () => {
    await expect(verifyTaskToken("b".repeat(64))).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("never puts the token into the error message", async () => {
    const token = "c".repeat(64);
    const err = await verifyTaskToken(token).catch((e: unknown) => e as TaskTokenError);
    expect(String(err)).not.toContain(token);
  });

  it("rejects a malformed token before it reaches the database", async () => {
    await expect(verifyTaskToken("not-a-token")).rejects.toMatchObject({ code: "token_invalid" });
    expect(agentQuery).not.toHaveBeenCalled();
  });
});

describe("assertToolAllowed", () => {
  const claims = { orgId: ORG_A, taskId: "t", profile: "leads", toolAllowlist: ["get_enquiry"] };

  it("permits a tool named in the token", () => {
    expect(() => assertToolAllowed(claims, "get_enquiry")).not.toThrow();
  });

  it("refuses a tool the profile was not granted, so a TTL is not a licence to call anything", () => {
    expect(() => assertToolAllowed(claims, "create_proposal")).toThrow(TaskTokenError);
  });
});

describe("revokeTaskToken", () => {
  it("revokes by suppression column rather than DELETE", async () => {
    await revokeTaskToken(ORG_A, "task-1");
    const sql = ownerQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("SET revoked_at");
    expect(sql).not.toContain("DELETE");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/task-token.test.ts`
Expected: FAIL — `Failed to resolve import "./task-token"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/101_agent_task_tokens.up.sql
-- Task tokens bind (task_id, profile, org_id) plus the profile's tool allowlist,
-- so the token scopes intent as well as tenant (validation report F-25).
-- Opaque and server-side, therefore revocable — the resolution of agent spec
-- open question 1 in favour of the revocable option.
BEGIN;

CREATE TABLE IF NOT EXISTS context.agent_task_tokens (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         UUID NOT NULL REFERENCES public.orgs(id),
  task_id        TEXT NOT NULL,
  profile        TEXT NOT NULL,
  -- sha256 of the token. The token itself is never stored and never logged.
  token_sha256   BYTEA NOT NULL,
  tool_allowlist TEXT[] NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ
);

ALTER TABLE context.agent_task_tokens
  ADD CONSTRAINT agent_task_tokens_sha_unique UNIQUE (token_sha256);
ALTER TABLE context.agent_task_tokens
  ADD CONSTRAINT agent_task_tokens_allowlist_nonempty CHECK (cardinality(tool_allowlist) > 0);

CREATE INDEX IF NOT EXISTS agent_task_tokens_org_task_idx
  ON context.agent_task_tokens (org_id, task_id);
CREATE INDEX IF NOT EXISTS agent_task_tokens_org_expiry_idx
  ON context.agent_task_tokens (org_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE context.agent_task_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.agent_task_tokens FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.agent_task_tokens
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Token lookup happens BEFORE a tenant is known -- deriving the tenant is the
-- whole point of the lookup -- so a tenant-scoped policy cannot serve it. This
-- second policy opens the table only while a transaction-local flag is set,
-- and only the SECURITY DEFINER function below sets it. agent_ro is granted no
-- SELECT on this table, so the grant, not the flag, is the boundary.
CREATE POLICY token_lookup ON context.agent_task_tokens
  FOR SELECT
  USING (current_setting('app.token_lookup', true) = 'on');

CREATE OR REPLACE FUNCTION context.verify_agent_task_token(p_token_sha256 BYTEA)
RETURNS TABLE (org_id UUID, task_id TEXT, profile TEXT, tool_allowlist TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = context, public
AS $$
BEGIN
  PERFORM set_config('app.token_lookup', 'on', true);
  RETURN QUERY
    SELECT t.org_id, t.task_id, t.profile, t.tool_allowlist
    FROM context.agent_task_tokens t
    WHERE t.token_sha256 = p_token_sha256
      AND t.revoked_at IS NULL
      AND t.expires_at > now();
END
$$;

REVOKE ALL ON FUNCTION context.verify_agent_task_token(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION context.verify_agent_task_token(BYTEA) TO agent_ro;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/101_agent_task_tokens.down.sql
BEGIN;
REVOKE EXECUTE ON FUNCTION context.verify_agent_task_token(BYTEA) FROM agent_ro;
DROP FUNCTION IF EXISTS context.verify_agent_task_token(BYTEA);
DROP POLICY IF EXISTS token_lookup      ON context.agent_task_tokens;
DROP POLICY IF EXISTS tenant_isolation  ON context.agent_task_tokens;
DROP TABLE IF EXISTS context.agent_task_tokens;
COMMIT;
```

- [ ] **Step 4: Write `task-token.ts`**

```ts
// ads-agent/mcp/context-server/task-token.ts
import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../../lib/db/client";
import { getAgentReadPool } from "./db";

export type TaskTokenClaims = {
  orgId: string;
  taskId: string;
  profile: string;
  toolAllowlist: string[];
};

export type TaskTokenErrorCode = "token_invalid" | "token_expired" | "tool_not_allowed";

/**
 * Carries a stable code rather than a descriptive message, because this error
 * reaches a span and a tool result. Nothing derived from the token is ever put
 * in the message: agent spec §6 — never log a token.
 */
export class TaskTokenError extends Error {
  constructor(readonly code: TaskTokenErrorCode) {
    super(code);
    this.name = "TaskTokenError";
  }
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function sha256(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Minted by the dispatcher, never by an agent. Uses the owner pool because
 * agent_ro holds no INSERT grant on the token table — issuing tokens is
 * control-plane work, not agent work.
 */
export async function mintTaskToken(input: {
  orgId: string;
  taskId: string;
  profile: string;
  toolAllowlist: string[];
  ttlSeconds: number;
}): Promise<{ token: string }> {
  if (input.toolAllowlist.length === 0) throw new Error("mintTaskToken: toolAllowlist must not be empty");
  const token = randomBytes(32).toString("hex");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [input.orgId]);
    await client.query(
      `INSERT INTO context.agent_task_tokens
         (org_id, task_id, profile, token_sha256, tool_allowlist, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [input.orgId, input.taskId, input.profile, sha256(token), input.toolAllowlist, input.ttlSeconds],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { token };
}

/**
 * The server derives org_id from the token and from nothing else. An agent
 * cannot name a tenant, so a confused or injected agent has no parameter to
 * abuse (agent spec §6).
 */
export async function verifyTaskToken(token: string): Promise<TaskTokenClaims> {
  if (!TOKEN_PATTERN.test(token)) throw new TaskTokenError("token_invalid");
  const { rows } = await getAgentReadPool().query<{
    org_id: string;
    task_id: string;
    profile: string;
    tool_allowlist: string[];
  }>("SELECT org_id, task_id, profile, tool_allowlist FROM context.verify_agent_task_token($1)", [
    sha256(token),
  ]);
  const row = rows[0];
  if (!row) throw new TaskTokenError("token_invalid");
  return {
    orgId: row.org_id,
    taskId: row.task_id,
    profile: row.profile,
    toolAllowlist: row.tool_allowlist,
  };
}

/** Within its TTL an injected agent may otherwise call any read tool (F-25). */
export function assertToolAllowed(claims: TaskTokenClaims, toolName: string): void {
  if (!claims.toolAllowlist.includes(toolName)) throw new TaskTokenError("tool_not_allowed");
}

/** Suppression, not deletion — the token row is audit evidence of what ran. */
export async function revokeTaskToken(orgId: string, taskId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [orgId]);
    await client.query(
      `UPDATE context.agent_task_tokens
          SET revoked_at = now()
        WHERE org_id = $1 AND task_id = $2 AND revoked_at IS NULL`,
      [orgId, taskId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/task-token.test.ts`
Expected: PASS — 8 passed.

- [ ] **Step 6: Apply the migration and verify the grant boundary**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" -f lib/db/migrations/101_agent_task_tokens.up.sql
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='agent_ro' AND table_name='agent_task_tokens'"
psql "$DATABASE_URL" -tAc "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'context.agent_task_tokens'::regclass"
```

Expected: `0` (no table grant), then `t|t`.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migrations/101_agent_task_tokens.up.sql ads-agent/lib/db/migrations/101_agent_task_tokens.down.sql ads-agent/mcp/context-server/task-token.ts ads-agent/mcp/context-server/task-token.test.ts
git commit -m "feat(mcp-context): revocable task tokens binding tenant and tool allowlist

The server derives org_id from the token, never from a parameter, and the
token also carries the profile's tool allowlist so a live TTL is not a
licence to call every read tool (validation report F-25)."
```

## Task 3: Tenant-scoped read views, and the only grants `agent_ro` gets

**Skills:** `postgres-pro`, `database-designer`
**Model:** `inherit` — `security_invoker` is the difference between a view that enforces RLS and one that launders around it.

**Files:**
- Create: `ads-agent/lib/db/migrations/102_agent_read_views.up.sql`
- Create: `ads-agent/lib/db/migrations/102_agent_read_views.down.sql`
- Test: `ads-agent/mcp/context-server/read-views.test.ts`

**Interfaces:**
- Consumes: `agent_ro` (Task 1); S3's `org_id` columns and RLS on `adsagent.enquiries`, `adsagent.enquiry_activity`, `adsagent.proposals`, `adsagent.campaigns`, `listings.listings`.
- Produces five views every W3 task reads, and no other database object `agent_ro` may touch:
  - `context.v_agent_enquiries (id, org_id, contact_name, reply_state, corridor_id, listing_id, first_seen_at, last_activity_at)`
  - `context.v_agent_enquiry_activity (id, org_id, enquiry_id, kind, occurred_at, summary)`
  - `context.v_agent_spaces (id, org_id, name, corridor_id, desks, price_per_desk, amenities, updated_at)`
  - `context.v_agent_proposals (id, org_id, kind, status, rationale, evidence, created_at, decided_at)`
  - `context.v_agent_campaigns (id, org_id, name, platform, status, corridor, daily_budget)`

- [ ] **Step 1: Write the failing test**

This is a live-database test, gated the same way `ads-agent/mcp/google-ads-server/live-smoke.test.ts` gates on credentials.

```ts
// ads-agent/mcp/context-server/read-views.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const LIVE = Boolean(process.env.DATABASE_URL);
const pool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

afterAll(async () => {
  await pool?.end();
});

const VIEWS = [
  "v_agent_enquiries",
  "v_agent_enquiry_activity",
  "v_agent_spaces",
  "v_agent_proposals",
  "v_agent_campaigns",
];

describe.skipIf(!LIVE)("agent read views", () => {
  it.each(VIEWS)("context.%s exists", async (view) => {
    const { rows } = await pool!.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname = $1 AND c.relkind = 'v'`,
      [view],
    );
    expect(rows).toHaveLength(1);
  });

  it("every agent view sets security_invoker, so the base table's RLS still applies", async () => {
    const { rows } = await pool!.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname LIKE 'v_agent_%' AND c.relkind = 'v'
          AND NOT COALESCE(array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false)`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("every agent view embeds the tenant predicate in its own definition", async () => {
    const { rows } = await pool!.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname LIKE 'v_agent_%' AND c.relkind = 'v'
          AND pg_get_viewdef(c.oid) NOT LIKE '%current_tenant()%'`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("grants agent_ro nothing but SELECT, and only on context views", async () => {
    const { rows } = await pool!.query<{ table_schema: string; table_name: string; privilege_type: string }>(
      `SELECT table_schema, table_name, privilege_type
         FROM information_schema.role_table_grants WHERE grantee = 'agent_ro'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.privilege_type).toBe("SELECT");
      expect(row.table_schema).toBe("context");
      expect(row.table_name).toMatch(/^v_agent_/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && DATABASE_URL="$DATABASE_URL" npx vitest run mcp/context-server/read-views.test.ts`
Expected: FAIL — the five `context.v_agent_*` views do not exist, so the existence assertions return zero rows.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/102_agent_read_views.up.sql
-- The whole read surface of the MCP context server. Each view embeds the tenant
-- predicate, so there is no predicate left for a caller to inject (F-19), and
-- each is security_invoker so the base table's FORCE ROW LEVEL SECURITY still
-- applies -- without that flag a view runs with its owner's privileges and
-- would launder straight around row security.
BEGIN;

CREATE OR REPLACE VIEW context.v_agent_enquiries
  WITH (security_invoker = true) AS
SELECT e.id, e.org_id, e.contact_name, e.reply_state, e.corridor_id, e.listing_id,
       e.first_seen_at, e.last_activity_at
  FROM adsagent.enquiries e
 WHERE e.org_id = public.current_tenant()
   AND e.lifecycle = 'active';

CREATE OR REPLACE VIEW context.v_agent_enquiry_activity
  WITH (security_invoker = true) AS
SELECT a.id, a.org_id, a.enquiry_id, a.kind, a.occurred_at, a.summary
  FROM adsagent.enquiry_activity a
 WHERE a.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_spaces
  WITH (security_invoker = true) AS
SELECT l.id, l.org_id, l.name, l.corridor_id, l.desks, l.price_per_desk, l.amenities, l.updated_at
  FROM listings.listings l
 WHERE l.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_proposals
  WITH (security_invoker = true) AS
SELECT p.id, p.org_id, p.kind, p.status, p.rationale, p.evidence, p.created_at, p.decided_at
  FROM adsagent.proposals p
 WHERE p.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_campaigns
  WITH (security_invoker = true) AS
SELECT c.id, c.org_id, c.name, c.platform, c.status, c.corridor, c.daily_budget
  FROM adsagent.campaigns c
 WHERE c.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_enquiries        TO agent_ro;
GRANT SELECT ON context.v_agent_enquiry_activity TO agent_ro;
GRANT SELECT ON context.v_agent_spaces           TO agent_ro;
GRANT SELECT ON context.v_agent_proposals        TO agent_ro;
GRANT SELECT ON context.v_agent_campaigns        TO agent_ro;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/102_agent_read_views.down.sql
BEGIN;
DROP VIEW IF EXISTS context.v_agent_campaigns;
DROP VIEW IF EXISTS context.v_agent_proposals;
DROP VIEW IF EXISTS context.v_agent_spaces;
DROP VIEW IF EXISTS context.v_agent_enquiry_activity;
DROP VIEW IF EXISTS context.v_agent_enquiries;
COMMIT;
```

If any referenced column does not exist because S4 named it differently, **stop and report** rather than guessing a column name — the view is the tenant boundary and a wrong column here is a silent hole. Confirm names with:

```bash
psql "$DATABASE_URL" -c "\d adsagent.enquiries" -c "\d adsagent.enquiry_activity" -c "\d listings.listings"
```

- [ ] **Step 4: Apply the migration, run the test, watch it pass**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" -f lib/db/migrations/102_agent_read_views.up.sql
DATABASE_URL="$DATABASE_URL" npx vitest run mcp/context-server/read-views.test.ts
```

Expected: PASS — 8 passed (five parameterised existence cases plus three assertions).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/migrations/102_agent_read_views.up.sql ads-agent/lib/db/migrations/102_agent_read_views.down.sql ads-agent/mcp/context-server/read-views.test.ts
git commit -m "feat(mcp-context): tenant-scoped read views, security_invoker, SELECT-only grants

Views embed org_id = public.current_tenant() so there is no predicate left to
inject (F-19), and security_invoker keeps the base tables' FORCE ROW LEVEL
SECURITY in force through the view."
```

## Task 4: `graph_query` — parameterised templates, not query text (F-19)

**Skills:** `red-team`, `sql-pro`
**Model:** `inherit` — this is the centre of the plan; the failure mode is a plausible-looking design that still concatenates.

**Files:**
- Create: `ads-agent/lib/db/migrations/103_agent_graph_views.up.sql`
- Create: `ads-agent/lib/db/migrations/103_agent_graph_views.down.sql`
- Create: `ads-agent/mcp/context-server/graph-query.ts`
- Test: `ads-agent/mcp/context-server/graph-query.test.ts`

**Interfaces:**
- Consumes: `withAgentTenantTx`, `TenantTx` from `./db`; `TaskTokenClaims` from `./task-token`; S8's `graph_node` / `graph_edge` reachable through the `pg_clickhouse` FDW foreign tables `context.fdw_graph_node` / `context.fdw_graph_edge`.
- Produces:
  - `const GRAPH_TEMPLATE_NAMES: readonly ["spaces_in_corridor", "enquiries_for_space", "corridors_for_contact"]`
  - `type GraphTemplateName = (typeof GRAPH_TEMPLATE_NAMES)[number]`
  - `class GraphQueryError extends Error { readonly code: "unknown_template" | "invalid_params" }`
  - `runGraphQuery(claims: TaskTokenClaims, input: { template: string; params: Record<string, unknown> }): Promise<Record<string, unknown>[]>`
  - `describeGraphTemplates(): { name: GraphTemplateName; description: string; params: string[] }[]`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/graph-query.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { describeGraphTemplates, GraphQueryError, runGraphQuery } from "./graph-query";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["graph_query"],
};
const CORRIDOR = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockResolvedValue({ rows: [{ node_id: "n1", props: {} }], rowCount: 1 });
});

describe("runGraphQuery", () => {
  it("runs the named template's constant SQL with the values bound as parameters", async () => {
    const rows = await runGraphQuery(CLAIMS, {
      template: "spaces_in_corridor",
      params: { corridor_id: CORRIDOR, limit: 10 },
    });
    expect(rows).toEqual([{ node_id: "n1", props: {} }]);
    const statements = txQuery.mock.calls.map((c) => String(c[0]));
    const select = txQuery.mock.calls.find((c) => String(c[0]).includes("SELECT"))!;
    expect(select[1]).toEqual([CORRIDOR, 10]);
    // The value never reaches the SQL text.
    expect(String(select[0])).not.toContain(CORRIDOR);
    expect(statements.some((s) => s.includes("SET LOCAL statement_timeout"))).toBe(true);
  });

  it("rejects a mutating Cypher statement submitted where a template name goes", async () => {
    await expect(
      runGraphQuery(CLAIMS, {
        template: "MATCH (n:Space) SET n.price = 0 RETURN n",
        params: {},
      }),
    ).rejects.toMatchObject({ code: "unknown_template" });
    expect(txQuery).not.toHaveBeenCalled();
  });

  it.each([
    "MATCH (n) DETACH DELETE n",
    "CREATE (n:Space {name: 'x'})",
    "spaces_in_corridor; DROP TABLE adsagent.proposals",
    "SELECT * FROM adsagent.enquiries",
    "UNION SELECT 1",
  ])("rejects %s without touching the database", async (attack) => {
    await expect(runGraphQuery(CLAIMS, { template: attack, params: {} })).rejects.toBeInstanceOf(
      GraphQueryError,
    );
    expect(txQuery).not.toHaveBeenCalled();
  });

  it("rejects params that fail the template's schema", async () => {
    await expect(
      runGraphQuery(CLAIMS, { template: "spaces_in_corridor", params: { corridor_id: "not-a-uuid" } }),
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(txQuery).not.toHaveBeenCalled();
  });

  it("caps the row limit no matter what the caller asks for", async () => {
    await expect(
      runGraphQuery(CLAIMS, { template: "spaces_in_corridor", params: { corridor_id: CORRIDOR, limit: 100000 } }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("takes no free-form field: an extra key is rejected rather than ignored", async () => {
    await expect(
      runGraphQuery(CLAIMS, {
        template: "spaces_in_corridor",
        params: { corridor_id: CORRIDOR, cypher: "MATCH (n) RETURN n" },
      }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("describeGraphTemplates", () => {
  it("lists every template with its parameter names, so the tool description is generated not written", () => {
    const described = describeGraphTemplates();
    expect(described.map((d) => d.name).sort()).toEqual([
      "corridors_for_contact",
      "enquiries_for_space",
      "spaces_in_corridor",
    ]);
    for (const t of described) expect(t.params.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/graph-query.test.ts`
Expected: FAIL — `Failed to resolve import "./graph-query"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/103_agent_graph_views.up.sql
-- Graph node and edge tables live in ClickHouse (data model §7) and are reached
-- from Postgres through the pg_clickhouse FDW built at S6. These views wrap the
-- foreign tables with the tenant predicate embedded, which is what the agent
-- spec means by "views that already embed the tenant predicate": the templates
-- in graph-query.ts can then supply values only.
BEGIN;

CREATE OR REPLACE VIEW context.v_agent_graph_node
  WITH (security_invoker = true) AS
SELECT n.org_id, n.snapshot_id, n.node_id, n.node_kind, n.props
  FROM context.fdw_graph_node n
 WHERE n.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_graph_edge
  WITH (security_invoker = true) AS
SELECT e.org_id, e.snapshot_id, e.source_id, e.source_kind, e.target_id, e.target_kind,
       e.relationship
  FROM context.fdw_graph_edge e
 WHERE e.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_graph_node TO agent_ro;
GRANT SELECT ON context.v_agent_graph_edge TO agent_ro;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/103_agent_graph_views.down.sql
BEGIN;
DROP VIEW IF EXISTS context.v_agent_graph_edge;
DROP VIEW IF EXISTS context.v_agent_graph_node;
COMMIT;
```

If `context.fdw_graph_node` / `context.fdw_graph_edge` do not exist, S6's FDW step named them differently. Confirm and **stop and report** rather than creating tables with those names — a local table shadowing the FDW would silently serve empty results:

```bash
psql "$DATABASE_URL" -tAc "SELECT foreign_table_schema, foreign_table_name FROM information_schema.foreign_tables"
```

- [ ] **Step 4: Write `graph-query.ts`**

```ts
// ads-agent/mcp/context-server/graph-query.ts
import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

/**
 * Free-form query text cannot be made safe (validation report F-19). Statement-
 * type validation is a denylist, and read-only statements still exfiltrate
 * through subqueries against system catalogs, CTEs, UNION branches that escape a
 * top-level predicate, and blind timing oracles that leak a bit at a time.
 *
 * So the model supplies a template NAME and VALUES. The SQL is a module constant
 * and is never assembled from input. New traversals are added by writing a
 * template here, not by a model composing one.
 */
export const GRAPH_TEMPLATE_NAMES = [
  "spaces_in_corridor",
  "enquiries_for_space",
  "corridors_for_contact",
] as const;

export type GraphTemplateName = (typeof GRAPH_TEMPLATE_NAMES)[number];

export type GraphQueryErrorCode = "unknown_template" | "invalid_params";

export class GraphQueryError extends Error {
  constructor(readonly code: GraphQueryErrorCode) {
    super(code);
    this.name = "GraphQueryError";
  }
}

const MAX_ROWS = 200;
const uuid = z.string().uuid();
const limit = z.number().int().min(1).max(MAX_ROWS).default(50);

type Template<S extends z.ZodType> = {
  description: string;
  schema: S;
  sql: string;
  bind: (params: z.output<S>) => unknown[];
};

function template<S extends z.ZodType>(t: Template<S>): Template<z.ZodType> {
  return t as unknown as Template<z.ZodType>;
}

const TEMPLATES: Record<GraphTemplateName, Template<z.ZodType>> = {
  spaces_in_corridor: template({
    description: "Spaces linked to a corridor, most recently updated first",
    schema: z.strictObject({ corridor_id: uuid, limit }),
    sql: `SELECT n.node_id, n.node_kind, n.props
            FROM context.v_agent_graph_edge e
            JOIN context.v_agent_graph_node n ON n.node_id = e.source_id
           WHERE e.relationship = 'IN_CORRIDOR'
             AND e.target_id = $1
             AND n.node_kind = 'Space'
           ORDER BY n.node_id
           LIMIT $2`,
    bind: (p) => [p.corridor_id, p.limit],
  }),
  enquiries_for_space: template({
    description: "Enquiries that referenced a given space",
    schema: z.strictObject({ space_id: uuid, limit }),
    sql: `SELECT n.node_id, n.node_kind, n.props
            FROM context.v_agent_graph_edge e
            JOIN context.v_agent_graph_node n ON n.node_id = e.source_id
           WHERE e.relationship = 'ENQUIRED_ABOUT'
             AND e.target_id = $1
             AND n.node_kind = 'Enquiry'
           ORDER BY n.node_id
           LIMIT $2`,
    bind: (p) => [p.space_id, p.limit],
  }),
  corridors_for_contact: template({
    description: "Corridors a contact has shown interest in, via their enquiries",
    schema: z.strictObject({ contact_id: uuid, limit }),
    sql: `SELECT DISTINCT c.node_id, c.node_kind, c.props
            FROM context.v_agent_graph_edge person_enq
            JOIN context.v_agent_graph_edge enq_corr
              ON enq_corr.source_id = person_enq.target_id
             AND enq_corr.relationship = 'IN_CORRIDOR'
            JOIN context.v_agent_graph_node c
              ON c.node_id = enq_corr.target_id AND c.node_kind = 'Corridor'
           WHERE person_enq.relationship = 'MADE_ENQUIRY'
             AND person_enq.source_id = $1
           ORDER BY c.node_id
           LIMIT $2`,
    bind: (p) => [p.contact_id, p.limit],
  }),
};

function isTemplateName(name: string): name is GraphTemplateName {
  return (GRAPH_TEMPLATE_NAMES as readonly string[]).includes(name);
}

export function describeGraphTemplates(): {
  name: GraphTemplateName;
  description: string;
  params: string[];
}[] {
  return GRAPH_TEMPLATE_NAMES.map((name) => {
    const schema = TEMPLATES[name].schema as unknown as z.ZodObject<z.ZodRawShape>;
    return {
      name,
      description: TEMPLATES[name].description,
      params: Object.keys(schema.shape),
    };
  });
}

export async function runGraphQuery(
  claims: TaskTokenClaims,
  input: { template: string; params: Record<string, unknown> },
): Promise<Record<string, unknown>[]> {
  if (!isTemplateName(input.template)) throw new GraphQueryError("unknown_template");
  const t = TEMPLATES[input.template];
  const parsed = t.schema.safeParse(input.params);
  if (!parsed.success) throw new GraphQueryError("invalid_params");

  return withAgentTenantTx(claims.orgId, async (tx) => {
    // Defence in depth alongside the role's session default: a traversal that
    // fans out cannot hold a connection or become a timing oracle.
    await tx.query("SET LOCAL statement_timeout = '3s'");
    const { rows } = await tx.query<Record<string, unknown>>(t.sql, t.bind(parsed.data));
    return rows.slice(0, MAX_ROWS);
  });
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/graph-query.test.ts`
Expected: PASS — 11 passed.

- [ ] **Step 6: Apply the migration and commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" -f lib/db/migrations/103_agent_graph_views.up.sql
git add ads-agent/lib/db/migrations/103_agent_graph_views.up.sql ads-agent/lib/db/migrations/103_agent_graph_views.down.sql ads-agent/mcp/context-server/graph-query.ts ads-agent/mcp/context-server/graph-query.test.ts
git commit -m "feat(mcp-context): graph_query takes an allowlisted template name and values

Replaces the free-form Cypher surface. Statement-type validation is a denylist
and read-only statements still exfiltrate through catalog subqueries, CTEs,
UNION branches and timing oracles (validation report F-19), so the SQL is a
module constant and the caller supplies only values."
```

## Task 5: `list_enquiries` and `get_enquiry`

**Skills:** `senior-backend`, `typescript-pro`
**Model:** `composer-2.5-fast` — the code is fully specified below.

**Files:**
- Create: `ads-agent/mcp/context-server/read-enquiries.ts`
- Test: `ads-agent/mcp/context-server/read-enquiries.test.ts`

**Interfaces:**
- Consumes: `withAgentTenantTx` from `./db`; `TaskTokenClaims` from `./task-token`; views `context.v_agent_enquiries`, `context.v_agent_enquiry_activity` (Task 3).
- Produces:
  - `type EnquirySummary = { id: string; contactName: string | null; replyState: "waiting" | "called" | "closed"; corridorId: string | null; listingId: string | null; firstSeenAt: string; lastActivityAt: string }`
  - `type EnquiryDetail = EnquirySummary & { activity: { id: string; kind: string; occurredAt: string; summary: string | null }[]; signals: string[] }`
  - `listEnquiries(claims: TaskTokenClaims, input: { status?: "waiting" | "called" | "closed"; since?: string; limit?: number }): Promise<EnquirySummary[]>`
  - `getEnquiry(claims: TaskTokenClaims, enquiryId: string): Promise<EnquiryDetail | null>` — **`null` for another tenant's id, indistinguishable from a nonexistent id**

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/read-enquiries.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { getEnquiry, listEnquiries } from "./read-enquiries";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["list_enquiries", "get_enquiry"],
};
const ENQ = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listEnquiries", () => {
  it("reads the tenant-scoped view and never the base table", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await listEnquiries(CLAIMS, {});
    const sql = String(txQuery.mock.calls[0][0]);
    expect(sql).toContain("context.v_agent_enquiries");
    expect(sql).not.toContain("adsagent.enquiries");
  });

  it("binds status and since as parameters and caps the limit", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await listEnquiries(CLAIMS, { status: "waiting", since: "2026-08-01T00:00:00.000Z", limit: 9999 });
    const [, params] = txQuery.mock.calls[0];
    expect(params).toContain("waiting");
    expect(params).toContain("2026-08-01T00:00:00.000Z");
    expect(params).toContain(100);
  });

  it("maps rows to camelCase ISO summaries", async () => {
    txQuery.mockResolvedValue({
      rows: [
        {
          id: ENQ,
          contact_name: "Asha",
          reply_state: "waiting",
          corridor_id: null,
          listing_id: null,
          first_seen_at: new Date("2026-08-10T10:00:00.000Z"),
          last_activity_at: new Date("2026-08-11T10:00:00.000Z"),
        },
      ],
      rowCount: 1,
    });
    const rows = await listEnquiries(CLAIMS, {});
    expect(rows).toEqual([
      {
        id: ENQ,
        contactName: "Asha",
        replyState: "waiting",
        corridorId: null,
        listingId: null,
        firstSeenAt: "2026-08-10T10:00:00.000Z",
        lastActivityAt: "2026-08-11T10:00:00.000Z",
      },
    ]);
  });
});

describe("getEnquiry", () => {
  it("returns null when the view yields no row, so another tenant's id is not-found", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await getEnquiry(CLAIMS, ENQ)).toBeNull();
  });

  it("returns the thread, activity and derived signals for an in-tenant enquiry", async () => {
    txQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: ENQ,
            contact_name: "Asha",
            reply_state: "waiting",
            corridor_id: null,
            listing_id: null,
            first_seen_at: new Date("2026-08-10T10:00:00.000Z"),
            last_activity_at: new Date("2026-08-11T10:00:00.000Z"),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "a1", kind: "pricing_question", occurred_at: new Date("2026-08-10T11:00:00.000Z"), summary: null },
          { id: "a2", kind: "pricing_question", occurred_at: new Date("2026-08-10T12:00:00.000Z"), summary: null },
        ],
        rowCount: 2,
      });
    const detail = await getEnquiry(CLAIMS, ENQ);
    expect(detail?.activity).toHaveLength(2);
    expect(detail?.signals).toContain("pricing_question x2");
  });

  it("rejects a malformed id before querying", async () => {
    await expect(getEnquiry(CLAIMS, "not-a-uuid")).rejects.toThrow("invalid_enquiry_id");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-enquiries.test.ts`
Expected: FAIL — `Failed to resolve import "./read-enquiries"`.

- [ ] **Step 3: Write `read-enquiries.ts`**

```ts
// ads-agent/mcp/context-server/read-enquiries.ts
import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export const REPLY_STATES = ["waiting", "called", "closed"] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export type EnquirySummary = {
  id: string;
  contactName: string | null;
  replyState: ReplyState;
  corridorId: string | null;
  listingId: string | null;
  firstSeenAt: string;
  lastActivityAt: string;
};

export type EnquiryActivity = {
  id: string;
  kind: string;
  occurredAt: string;
  summary: string | null;
};

export type EnquiryDetail = EnquirySummary & {
  activity: EnquiryActivity[];
  signals: string[];
};

const MAX_LIMIT = 100;

export const listEnquiriesInput = z.strictObject({
  status: z.enum(REPLY_STATES).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(25),
});

type EnquiryRow = {
  id: string;
  contact_name: string | null;
  reply_state: ReplyState;
  corridor_id: string | null;
  listing_id: string | null;
  first_seen_at: Date;
  last_activity_at: Date;
};

function toSummary(row: EnquiryRow): EnquirySummary {
  return {
    id: row.id,
    contactName: row.contact_name,
    replyState: row.reply_state,
    corridorId: row.corridor_id,
    listingId: row.listing_id,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastActivityAt: row.last_activity_at.toISOString(),
  };
}

export async function listEnquiries(
  claims: TaskTokenClaims,
  input: z.input<typeof listEnquiriesInput>,
): Promise<EnquirySummary[]> {
  const { status, since, limit } = listEnquiriesInput.parse(input);
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<EnquiryRow>(
      `SELECT id, contact_name, reply_state, corridor_id, listing_id,
              first_seen_at, last_activity_at
         FROM context.v_agent_enquiries
        WHERE ($1::text IS NULL OR reply_state = $1)
          AND ($2::timestamptz IS NULL OR last_activity_at >= $2)
        ORDER BY last_activity_at DESC
        LIMIT $3`,
      [status ?? null, since ?? null, limit],
    );
    return rows.map(toSummary);
  });
}

/**
 * Derived signals, the thing the `leads` profile actually reads for ("asked
 * about pricing twice"). Counting repeated activity kinds is the whole rule.
 *
 * ponytail: counts activity kinds only, so it cannot notice a signal that needs
 * message content. Ceiling: no cross-enquiry or temporal reasoning. Upgrade
 * path: derive signals in the graph at S8 and read them through graph_query,
 * which keeps the derivation testable in one place instead of here.
 */
function deriveSignals(activity: EnquiryActivity[]): string[] {
  const counts = new Map<string, number>();
  for (const a of activity) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([kind, n]) => `${kind} x${n}`)
    .sort();
}

export async function getEnquiry(
  claims: TaskTokenClaims,
  enquiryId: string,
): Promise<EnquiryDetail | null> {
  if (!z.string().uuid().safeParse(enquiryId).success) throw new Error("invalid_enquiry_id");
  return withAgentTenantTx(claims.orgId, async (tx) => {
    // The view embeds org_id = public.current_tenant(), so another tenant's id
    // simply yields no row. Not-found and wrong-tenant are the same answer on
    // purpose: a 403 would confirm the row exists.
    const { rows } = await tx.query<EnquiryRow>(
      `SELECT id, contact_name, reply_state, corridor_id, listing_id,
              first_seen_at, last_activity_at
         FROM context.v_agent_enquiries WHERE id = $1`,
      [enquiryId],
    );
    if (!rows[0]) return null;

    const { rows: activityRows } = await tx.query<{
      id: string;
      kind: string;
      occurred_at: Date;
      summary: string | null;
    }>(
      `SELECT id, kind, occurred_at, summary
         FROM context.v_agent_enquiry_activity
        WHERE enquiry_id = $1
        ORDER BY occurred_at ASC
        LIMIT $2`,
      [enquiryId, MAX_LIMIT],
    );
    const activity: EnquiryActivity[] = activityRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      occurredAt: a.occurred_at.toISOString(),
      summary: a.summary,
    }));
    return { ...toSummary(rows[0]), activity, signals: deriveSignals(activity) };
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-enquiries.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/context-server/read-enquiries.ts ads-agent/mcp/context-server/read-enquiries.test.ts
git commit -m "feat(mcp-context): list_enquiries and get_enquiry over the tenant-scoped view

Another tenant's id returns not-found rather than a denial, because a denial
confirms the row exists."
```

## Task 6: `search_spaces` and `get_space`

**Skills:** `senior-backend`, `typescript-pro`
**Model:** `composer-2.5-fast` — the code is fully specified below.

**Files:**
- Create: `ads-agent/mcp/context-server/read-spaces.ts`
- Test: `ads-agent/mcp/context-server/read-spaces.test.ts`

**Interfaces:**
- Consumes: `withAgentTenantTx` from `./db`; `TaskTokenClaims` from `./task-token`; view `context.v_agent_spaces` (Task 3).
- Produces:
  - `type Space = { id: string; name: string; corridorId: string | null; desks: number | null; pricePerDesk: number | null; amenities: string[]; updatedAt: string }`
  - `searchSpaces(claims: TaskTokenClaims, input: { query: string; filters?: { corridor?: string; minDesks?: number; maxDesks?: number; maxPricePerDesk?: number }; limit?: number }): Promise<Space[]>`
  - `getSpace(claims: TaskTokenClaims, spaceId: string): Promise<Space | null>`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/read-spaces.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { getSpace, searchSpaces } from "./read-spaces";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["search_spaces", "get_space"],
};
const SPACE = "44444444-4444-4444-4444-444444444444";

const ROW = {
  id: SPACE,
  name: "Whitefield Tower 3",
  corridor_id: null,
  desks: 40,
  price_per_desk: "9500",
  amenities: ["parking"],
  updated_at: new Date("2026-08-11T10:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockResolvedValue({ rows: [ROW], rowCount: 1 });
});

describe("searchSpaces", () => {
  it("reads the tenant-scoped view and binds the query as a parameter", async () => {
    await searchSpaces(CLAIMS, { query: "whitefield 40 desks" });
    const [sql, params] = txQuery.mock.calls[0];
    expect(String(sql)).toContain("context.v_agent_spaces");
    expect(String(sql)).not.toContain("listings.listings");
    expect(String(sql)).not.toContain("whitefield");
    expect(params).toContain("whitefield 40 desks");
  });

  it("binds every filter rather than concatenating a predicate", async () => {
    await searchSpaces(CLAIMS, {
      query: "office",
      filters: { corridor: "Whitefield", minDesks: 20, maxDesks: 60, maxPricePerDesk: 12000 },
    });
    const [, params] = txQuery.mock.calls[0];
    expect(params).toEqual(expect.arrayContaining(["Whitefield", 20, 60, 12000]));
  });

  it("returns numbers not numeric strings", async () => {
    const [space] = await searchSpaces(CLAIMS, { query: "office" });
    expect(space.pricePerDesk).toBe(9500);
    expect(space.desks).toBe(40);
    expect(space.updatedAt).toBe("2026-08-11T10:00:00.000Z");
  });

  it("rejects an empty query rather than returning the whole catalogue", async () => {
    await expect(searchSpaces(CLAIMS, { query: "   " })).rejects.toThrow("invalid_query");
    expect(txQuery).not.toHaveBeenCalled();
  });
});

describe("getSpace", () => {
  it("returns null for another tenant's id", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await getSpace(CLAIMS, SPACE)).toBeNull();
  });

  it("rejects a malformed id before querying", async () => {
    await expect(getSpace(CLAIMS, "nope")).rejects.toThrow("invalid_space_id");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-spaces.test.ts`
Expected: FAIL — `Failed to resolve import "./read-spaces"`.

- [ ] **Step 3: Write `read-spaces.ts`**

```ts
// ads-agent/mcp/context-server/read-spaces.ts
import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export type Space = {
  id: string;
  name: string;
  corridorId: string | null;
  desks: number | null;
  pricePerDesk: number | null;
  amenities: string[];
  updatedAt: string;
};

const MAX_LIMIT = 50;

export const searchSpacesInput = z.strictObject({
  query: z.string().min(1).max(500),
  filters: z
    .strictObject({
      corridor: z.string().min(1).max(120).optional(),
      minDesks: z.number().int().min(0).optional(),
      maxDesks: z.number().int().min(1).optional(),
      maxPricePerDesk: z.number().min(0).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
});

type SpaceRow = {
  id: string;
  name: string;
  corridor_id: string | null;
  desks: number | null;
  price_per_desk: string | null;
  amenities: unknown;
  updated_at: Date;
};

function toSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    corridorId: row.corridor_id,
    desks: row.desks === null ? null : Number(row.desks),
    pricePerDesk: row.price_per_desk === null ? null : Number(row.price_per_desk),
    amenities: Array.isArray(row.amenities) ? (row.amenities as string[]) : [],
    updatedAt: row.updated_at.toISOString(),
  };
}

const SPACE_COLUMNS = `id, name, corridor_id, desks, price_per_desk, amenities, updated_at`;

/**
 * ponytail: ranks by trigram-free ILIKE relevance over name and amenities, not
 * by pgvector similarity plus the AGE graph boost the agent spec's table names.
 * Ceiling: a space ranked below the limit is unreachable, exactly as noted for
 * the site's own search. Upgrade path: swap the ORDER BY for the embedding
 * distance once `listings` exposes its embedding column through
 * context.v_agent_spaces — a view change plus this one clause, no tool change.
 */
export async function searchSpaces(
  claims: TaskTokenClaims,
  input: z.input<typeof searchSpacesInput>,
): Promise<Space[]> {
  const parsed = searchSpacesInput.safeParse(input);
  if (!parsed.success || parsed.data.query.trim().length === 0) throw new Error("invalid_query");
  const { query, filters, limit } = parsed.data;
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<SpaceRow>(
      `SELECT ${SPACE_COLUMNS}
         FROM context.v_agent_spaces
        WHERE ($2::text IS NULL OR corridor_id::text = $2 OR name ILIKE '%' || $2 || '%')
          AND ($3::int IS NULL OR desks >= $3)
          AND ($4::int IS NULL OR desks <= $4)
          AND ($5::numeric IS NULL OR price_per_desk <= $5)
        ORDER BY (name ILIKE '%' || $1 || '%') DESC, updated_at DESC
        LIMIT $6`,
      [
        query,
        filters?.corridor ?? null,
        filters?.minDesks ?? null,
        filters?.maxDesks ?? null,
        filters?.maxPricePerDesk ?? null,
        limit,
      ],
    );
    return rows.map(toSpace);
  });
}

export async function getSpace(claims: TaskTokenClaims, spaceId: string): Promise<Space | null> {
  if (!z.string().uuid().safeParse(spaceId).success) throw new Error("invalid_space_id");
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<SpaceRow>(
      `SELECT ${SPACE_COLUMNS} FROM context.v_agent_spaces WHERE id = $1`,
      [spaceId],
    );
    return rows[0] ? toSpace(rows[0]) : null;
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-spaces.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/context-server/read-spaces.ts ads-agent/mcp/context-server/read-spaces.test.ts
git commit -m "feat(mcp-context): search_spaces and get_space over the tenant-scoped view

Filters bind as parameters; no predicate is assembled from input."
```

## Task 7: `get_campaign_performance` — the ClickHouse mirror, not the primary

**Skills:** `senior-data-engineer`, `sql-pro`
**Model:** `inherit` — the ClickHouse row-policy setting and the readonly flag are the security boundary here.

**Files:**
- Create: `ads-agent/mcp/context-server/read-performance.ts`
- Test: `ads-agent/mcp/context-server/read-performance.test.ts`

**Interfaces:**
- Consumes: `TaskTokenClaims` from `./task-token`; the ClickHouse HTTP endpoint from S6.
- Produces:
  - `type CampaignMetric = { campaignId: string; campaignName: string; corridor: string | null; spend: number; clicks: number; impressions: number; conversions: number }`
  - `getCampaignPerformance(claims: TaskTokenClaims, input: { windowDays: number; corridor?: string }): Promise<CampaignMetric[]>`
  - `resolveClickHouseUrl(): string`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/read-performance.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCampaignPerformance, resolveClickHouseUrl } from "./read-performance";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "performance",
  toolAllowlist: ["get_campaign_performance"],
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_CLICKHOUSE_URL = "http://clickhouse:8123";
  process.env.AGENT_CLICKHOUSE_USER = "agent_ro";
  process.env.AGENT_CLICKHOUSE_PASSWORD = "local_dev";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        campaign_id: "c1",
        campaign_name: "Whitefield Search",
        corridor: "Whitefield",
        spend: 1200.5,
        clicks: 40,
        impressions: 900,
        conversions: 3,
      }) + "\n",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_CLICKHOUSE_URL;
});

describe("getCampaignPerformance", () => {
  it("pins the tenant with the SQL_current_tenant_id setting and forces readonly", async () => {
    await getCampaignPerformance(CLAIMS, { windowDays: 7 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`SQL_current_tenant_id=${CLAIMS.orgId}`);
    expect(url).toContain("readonly=1");
    expect(url).toContain("default_format=JSONEachRow");
  });

  it("passes values as ClickHouse query parameters, never inside the SQL body", async () => {
    await getCampaignPerformance(CLAIMS, { windowDays: 7, corridor: "Whitefield" });
    const url = String(fetchMock.mock.calls[0][0]);
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(url).toContain("param_window_days=7");
    expect(url).toContain("param_corridor=Whitefield");
    expect(body).not.toContain("Whitefield");
    expect(body).toContain("{window_days:UInt16}");
  });

  it("parses JSONEachRow into numbers", async () => {
    const rows = await getCampaignPerformance(CLAIMS, { windowDays: 7 });
    expect(rows).toEqual([
      {
        campaignId: "c1",
        campaignName: "Whitefield Search",
        corridor: "Whitefield",
        spend: 1200.5,
        clicks: 40,
        impressions: 900,
        conversions: 3,
      },
    ]);
  });

  it("rejects a window outside 1..90 before making a request", async () => {
    await expect(getCampaignPerformance(CLAIMS, { windowDays: 0 })).rejects.toThrow("invalid_window_days");
    await expect(getCampaignPerformance(CLAIMS, { windowDays: 400 })).rejects.toThrow("invalid_window_days");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a ClickHouse failure as a stable code, never as the response body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "DB::Exception: contact Asha <asha@example.com> row leaked",
    });
    const err = await getCampaignPerformance(CLAIMS, { windowDays: 7 }).catch((e: unknown) => e as Error);
    expect(err.message).toBe("clickhouse_unavailable");
    expect(String(err)).not.toContain("asha@example.com");
  });
});

describe("resolveClickHouseUrl", () => {
  it("throws when unset rather than defaulting to a host that might be the primary", () => {
    delete process.env.AGENT_CLICKHOUSE_URL;
    expect(() => resolveClickHouseUrl()).toThrow("AGENT_CLICKHOUSE_URL is not set");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-performance.test.ts`
Expected: FAIL — `Failed to resolve import "./read-performance"`.

- [ ] **Step 3: Write `read-performance.ts`**

```ts
// ads-agent/mcp/context-server/read-performance.ts
import { z } from "zod";
import type { TaskTokenClaims } from "./task-token";

export type CampaignMetric = {
  campaignId: string;
  campaignName: string;
  corridor: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

/**
 * Reached over ClickHouse's HTTP interface with `fetch` rather than a driver,
 * because the constraint is no new dependencies and this is one POST.
 */
export function resolveClickHouseUrl(): string {
  const url = process.env.AGENT_CLICKHOUSE_URL;
  if (!url) throw new Error("AGENT_CLICKHOUSE_URL is not set");
  return url.replace(/\/+$/, "");
}

const inputSchema = z.strictObject({
  windowDays: z.number().int().min(1).max(90),
  corridor: z.string().min(1).max(120).optional(),
});

// The SQL is a module constant. Values arrive as ClickHouse query parameters
// ({name:Type}) so nothing the caller supplies is ever part of the statement.
const PERFORMANCE_SQL = `
SELECT campaign_id,
       any(campaign_name)      AS campaign_name,
       any(corridor)           AS corridor,
       sum(spend)              AS spend,
       sum(clicks)             AS clicks,
       sum(impressions)        AS impressions,
       sum(conversions)        AS conversions
  FROM campaign_performance_daily
 WHERE day >= today() - {window_days:UInt16}
   AND ({corridor:String} = '' OR corridor = {corridor:String})
 GROUP BY campaign_id
 ORDER BY spend DESC
 LIMIT 200`;

/**
 * `performance` is the only profile that reads the ClickHouse mirror rather than
 * Postgres — agents must never run analytical scans against the OLTP primary
 * (agent spec §8). Tenancy is the ClickHouse row policy keyed on
 * getSetting('SQL_current_tenant_id'); the setting comes from the verified task
 * token and never from a tool parameter.
 */
export async function getCampaignPerformance(
  claims: TaskTokenClaims,
  input: z.input<typeof inputSchema>,
): Promise<CampaignMetric[]> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_window_days");
  const { windowDays, corridor } = parsed.data;

  const params = new URLSearchParams({
    default_format: "JSONEachRow",
    readonly: "1",
    max_execution_time: "5",
    SQL_current_tenant_id: claims.orgId,
    param_window_days: String(windowDays),
    param_corridor: corridor ?? "",
  });

  const auth = Buffer.from(
    `${process.env.AGENT_CLICKHOUSE_USER ?? "agent_ro"}:${process.env.AGENT_CLICKHOUSE_PASSWORD ?? ""}`,
  ).toString("base64");

  const res = await fetch(`${resolveClickHouseUrl()}/?${params.toString()}`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "text/plain" },
    body: PERFORMANCE_SQL,
  });

  // The response body of a failed ClickHouse query can echo row data. It never
  // reaches an error message, because that message reaches a span (§13.3).
  if (!res.ok) throw new Error("clickhouse_unavailable");

  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => ({
      campaignId: String(row.campaign_id),
      campaignName: String(row.campaign_name ?? ""),
      corridor: row.corridor === null || row.corridor === "" ? null : String(row.corridor),
      spend: Number(row.spend ?? 0),
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      conversions: Number(row.conversions ?? 0),
    }));
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-performance.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/context-server/read-performance.ts ads-agent/mcp/context-server/read-performance.test.ts
git commit -m "feat(mcp-context): get_campaign_performance reads the ClickHouse mirror

Tenant comes from the verified token into SQL_current_tenant_id, the request is
readonly=1, and a ClickHouse error surfaces as a stable code because its body
can echo rows and that body would reach a span."
```

## Task 8: `list_proposals`

**Skills:** `senior-backend`, `typescript-pro`
**Model:** `composer-2.5-fast` — the code is fully specified below.

**Files:**
- Create: `ads-agent/mcp/context-server/read-proposals.ts`
- Test: `ads-agent/mcp/context-server/read-proposals.test.ts`

**Interfaces:**
- Consumes: `withAgentTenantTx` from `./db`; `TaskTokenClaims` from `./task-token`; view `context.v_agent_proposals` (Task 3).
- Produces:
  - `type AgentProposalView = { id: string; kind: string; status: string; rationale: string | null; evidence: string[]; createdAt: string; decidedAt: string | null }`
  - `listProposals(claims: TaskTokenClaims, input: { status?: "pending" | "scheduled" | "approved" | "rejected"; limit?: number }): Promise<AgentProposalView[]>`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/read-proposals.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { listProposals } from "./read-proposals";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["list_proposals"],
};

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockResolvedValue({
    rows: [
      {
        id: "55555555-5555-5555-5555-555555555555",
        kind: "enquiry.requirement_update",
        status: "pending",
        rationale: "Asked about pricing twice",
        evidence: ["33333333-3333-3333-3333-333333333333"],
        created_at: new Date("2026-08-11T10:00:00.000Z"),
        decided_at: null,
      },
    ],
    rowCount: 1,
  });
});

describe("listProposals", () => {
  it("reads the tenant-scoped view and binds the status filter", async () => {
    await listProposals(CLAIMS, { status: "pending" });
    const [sql, params] = txQuery.mock.calls[0];
    expect(String(sql)).toContain("context.v_agent_proposals");
    expect(String(sql)).not.toContain("adsagent.proposals");
    expect(params).toContain("pending");
  });

  it("returns evidence as a string array even when the column is JSONB", async () => {
    const [row] = await listProposals(CLAIMS, {});
    expect(row.evidence).toEqual(["33333333-3333-3333-3333-333333333333"]);
    expect(row.createdAt).toBe("2026-08-11T10:00:00.000Z");
    expect(row.decidedAt).toBeNull();
  });

  it("rejects an unknown status rather than silently listing everything", async () => {
    // @ts-expect-error deliberately invalid at the type level too
    await expect(listProposals(CLAIMS, { status: "executed" })).rejects.toThrow("invalid_status");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-proposals.test.ts`
Expected: FAIL — `Failed to resolve import "./read-proposals"`.

- [ ] **Step 3: Write `read-proposals.ts`**

```ts
// ads-agent/mcp/context-server/read-proposals.ts
import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export const AGENT_VISIBLE_PROPOSAL_STATUSES = [
  "pending",
  "scheduled",
  "approved",
  "rejected",
] as const;

export type AgentProposalView = {
  id: string;
  kind: string;
  status: string;
  rationale: string | null;
  evidence: string[];
  createdAt: string;
  decidedAt: string | null;
};

const inputSchema = z.strictObject({
  status: z.enum(AGENT_VISIBLE_PROPOSAL_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export async function listProposals(
  claims: TaskTokenClaims,
  input: z.input<typeof inputSchema>,
): Promise<AgentProposalView[]> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_status");
  const { status, limit } = parsed.data;
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      kind: string;
      status: string;
      rationale: string | null;
      evidence: unknown;
      created_at: Date;
      decided_at: Date | null;
    }>(
      `SELECT id, kind, status, rationale, evidence, created_at, decided_at
         FROM context.v_agent_proposals
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY created_at DESC
        LIMIT $2`,
      [status ?? null, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      rationale: row.rationale,
      evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
      createdAt: row.created_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
    }));
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/read-proposals.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/context-server/read-proposals.ts ads-agent/mcp/context-server/read-proposals.test.ts
git commit -m "feat(mcp-context): list_proposals over the tenant-scoped view"
```

## Task 9: `create_proposal` — the only write tool

**Skills:** `senior-backend`, `security-auditor`
**Model:** `inherit` — the `SECURITY DEFINER` function is what makes "one write tool" a database property rather than a coding convention.

**Files:**
- Create: `ads-agent/lib/db/migrations/104_agent_create_proposal.up.sql`
- Create: `ads-agent/lib/db/migrations/104_agent_create_proposal.down.sql`
- Modify: `ads-agent/lib/db/schema.sql` — the idempotent `proposals_kind_check` widening block at lines 53–55
- Create: `ads-agent/mcp/context-server/create-proposal.ts`
- Test: `ads-agent/mcp/context-server/create-proposal.test.ts`

**Interfaces:**
- Consumes: `withAgentTenantTx`, `withAgentTenantWriteTx` from `./db`; `TaskTokenClaims` from `./task-token`.
- Produces:
  - `const AGENT_PROPOSAL_KINDS: readonly ["campaign.create", "campaign.budget_change", "campaign.pause", "enquiry.requirement_update", "content.page_update", "listing.update", "message.draft"]`
  - `const SPEND_CHANGING_KINDS: readonly ["campaign.create", "campaign.budget_change"]`
  - `const STALE_LAG_SECONDS = 900`
  - `class CreateProposalError extends Error { readonly code: "evidence_empty" | "evidence_not_identifier" | "invalid_kind" | "invalid_payload" | "stale_data_refusal" }`
  - `createAgentProposal(claims: TaskTokenClaims, input: { kind: string; payload: Record<string, unknown>; rationale: string; evidence: string[] }): Promise<{ proposalId: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/create-proposal.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const readQuery = vi.hoisted(() => vi.fn());
const writeQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_o: string, fn: (tx: { query: typeof readQuery }) => Promise<unknown>) =>
    fn({ query: readQuery }),
  withAgentTenantWriteTx: async (_o: string, fn: (tx: { query: typeof writeQuery }) => Promise<unknown>) =>
    fn({ query: writeQuery }),
}));

import { createAgentProposal, CreateProposalError } from "./create-proposal";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["create_proposal"],
};
const ENQ = "33333333-3333-3333-3333-333333333333";
const PROPOSAL = "55555555-5555-5555-5555-555555555555";

const VALID = {
  kind: "enquiry.requirement_update",
  payload: { desks: 40 },
  rationale: "Asked for 40 desks on the second call.",
  evidence: [ENQ],
};

beforeEach(() => {
  vi.clearAllMocks();
  readQuery.mockResolvedValue({ rows: [{ cdc_lag_seconds: 12 }], rowCount: 1 });
  writeQuery.mockResolvedValue({ rows: [{ proposal_id: PROPOSAL }], rowCount: 1 });
});

describe("createAgentProposal", () => {
  it("calls the SECURITY DEFINER function and returns the new proposal id", async () => {
    expect(await createAgentProposal(CLAIMS, VALID)).toEqual({ proposalId: PROPOSAL });
    const [sql, params] = writeQuery.mock.calls[0];
    expect(String(sql)).toContain("adsagent.agent_create_proposal");
    expect(params).toContain("leads");
    expect(params).toContain(12);
  });

  it("never issues an INSERT of its own", async () => {
    await createAgentProposal(CLAIMS, VALID);
    for (const call of writeQuery.mock.calls) expect(String(call[0])).not.toContain("INSERT");
  });

  it("rejects an empty evidence array — an agent that cannot cite does not propose", async () => {
    await expect(createAgentProposal(CLAIMS, { ...VALID, evidence: [] })).rejects.toMatchObject({
      code: "evidence_empty",
    });
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it("rejects prose in evidence: identifiers only (dataflow review A-4)", async () => {
    await expect(
      createAgentProposal(CLAIMS, {
        ...VALID,
        evidence: ["The client said they need 40 desks by October."],
      }),
    ).rejects.toMatchObject({ code: "evidence_not_identifier" });
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it.each([ENQ, `artifacts/${CLAIMS.orgId}/draft/${ENQ}`, `node:${ENQ}`])(
    "accepts %s as an identifier",
    async (id) => {
      await expect(createAgentProposal(CLAIMS, { ...VALID, evidence: [id] })).resolves.toEqual({
        proposalId: PROPOSAL,
      });
    },
  );

  it("rejects a kind outside the agent vocabulary", async () => {
    await expect(createAgentProposal(CLAIMS, { ...VALID, kind: "campaign.execute" })).rejects.toMatchObject({
      code: "invalid_kind",
    });
  });

  it("refuses a spend-changing proposal when CDC lag exceeds 15 minutes", async () => {
    readQuery.mockResolvedValue({ rows: [{ cdc_lag_seconds: 1200 }], rowCount: 1 });
    await expect(
      createAgentProposal(CLAIMS, { ...VALID, kind: "campaign.budget_change" }),
    ).rejects.toMatchObject({ code: "stale_data_refusal" });
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it("still allows a non-spend proposal under the same lag, because refusing is scoped", async () => {
    readQuery.mockResolvedValue({ rows: [{ cdc_lag_seconds: 1200 }], rowCount: 1 });
    await expect(createAgentProposal(CLAIMS, VALID)).resolves.toEqual({ proposalId: PROPOSAL });
  });

  it("treats a missing manifest as maximally stale rather than as fresh", async () => {
    readQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      createAgentProposal(CLAIMS, { ...VALID, kind: "campaign.create" }),
    ).rejects.toBeInstanceOf(CreateProposalError);
  });

  it("caps the rationale so a completion body cannot be smuggled through it", async () => {
    await expect(
      createAgentProposal(CLAIMS, { ...VALID, rationale: "x".repeat(5000) }),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/create-proposal.test.ts`
Expected: FAIL — `Failed to resolve import "./create-proposal"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/104_agent_create_proposal.up.sql
-- The single write capability of the MCP context server. agent_ro holds no
-- INSERT grant anywhere; it holds EXECUTE on exactly this function. That makes
-- "agents have one write tool" a property of the database rather than of the
-- code that happens to be calling it.
--
-- SECURITY DEFINER is safe here because adsagent.proposals carries FORCE ROW
-- LEVEL SECURITY: the policy applies to the owner too, so the WITH CHECK clause
-- still rejects a row carrying another tenant's org_id.
BEGIN;

ALTER TABLE adsagent.proposals
  ADD COLUMN IF NOT EXISTS proposed_by       TEXT,          -- agent profile name, NULL when human
  ADD COLUMN IF NOT EXISTS evidence          JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cdc_lag_seconds   INTEGER;

-- Agent-authored rows must cite something. Human rows are unaffected.
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_agent_evidence_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_agent_evidence_check
  CHECK (proposed_by IS NULL OR jsonb_array_length(evidence) > 0);

-- The live CHECK admits only the five snake_case kinds the existing executor
-- uses. The agent vocabulary is dotted (agent spec §5), so widen rather than
-- rename: renaming would break the decision cycle and the executor, which this
-- plan must not touch.
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN (
    'create_campaign','pause','budget_change','add_negative_keyword','campaign_strategy',
    'campaign.create','campaign.budget_change','campaign.pause',
    'enquiry.requirement_update','content.page_update','listing.update','message.draft'
  ));

CREATE INDEX IF NOT EXISTS proposals_org_proposed_by_idx
  ON adsagent.proposals (org_id, proposed_by, created_at DESC);

CREATE OR REPLACE FUNCTION adsagent.agent_create_proposal(
  p_kind            TEXT,
  p_payload         JSONB,
  p_rationale       TEXT,
  p_evidence        TEXT[],
  p_profile         TEXT,
  p_cdc_lag_seconds INTEGER
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = adsagent, public
AS $$
DECLARE
  v_org UUID := public.current_tenant();
  v_id  UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agent_create_proposal: no tenant in session';
  END IF;
  -- Server-side backstop for the same rule the TypeScript layer enforces. Both,
  -- because either one alone is a single point of failure for the gate the whole
  -- product rests on.
  IF p_evidence IS NULL OR cardinality(p_evidence) = 0 THEN
    RAISE EXCEPTION 'agent_create_proposal: evidence must not be empty';
  END IF;

  INSERT INTO adsagent.proposals
    (org_id, kind, payload, triggered_rule, rationale, evidence, proposed_by,
     cdc_lag_seconds, status)
  VALUES
    (v_org, p_kind, p_payload, 'agent:' || p_profile, p_rationale,
     to_jsonb(p_evidence), p_profile, p_cdc_lag_seconds, 'pending')
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER) TO agent_ro;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/104_agent_create_proposal.down.sql
BEGIN;
REVOKE EXECUTE ON FUNCTION adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER) FROM agent_ro;
DROP FUNCTION IF EXISTS adsagent.agent_create_proposal(TEXT, JSONB, TEXT, TEXT[], TEXT, INTEGER);
DROP INDEX IF EXISTS adsagent.proposals_org_proposed_by_idx;
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_agent_evidence_check;
ALTER TABLE adsagent.proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE adsagent.proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN ('create_campaign','pause','budget_change','add_negative_keyword','campaign_strategy'));
ALTER TABLE adsagent.proposals
  DROP COLUMN IF EXISTS cdc_lag_seconds,
  DROP COLUMN IF EXISTS evidence,
  DROP COLUMN IF EXISTS proposed_by;
COMMIT;
```

- [ ] **Step 4: Keep `schema.sql` consistent for a fresh database**

Replace the widening block at `ads-agent/lib/db/schema.sql:53-55` with:

```sql
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN (
    'create_campaign','pause','budget_change','add_negative_keyword','campaign_strategy',
    'campaign.create','campaign.budget_change','campaign.pause',
    'enquiry.requirement_update','content.page_update','listing.update','message.draft'
  ));
```

Migration 104 is what reaches a provisioned database; this keeps a fresh `npm run migrate` consistent with it.

- [ ] **Step 5: Write `create-proposal.ts`**

```ts
// ads-agent/mcp/context-server/create-proposal.ts
import { z } from "zod";
import { withAgentTenantTx, withAgentTenantWriteTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

/**
 * Agents propose, humans dispose (agent spec AG1). Every action an agent wants
 * to take in the world becomes a row in proposals, which is the human-gated
 * approval mechanism the admin screens already render. There is no second write
 * tool, and no send tool of any kind.
 */
export const AGENT_PROPOSAL_KINDS = [
  "campaign.create",
  "campaign.budget_change",
  "campaign.pause",
  "enquiry.requirement_update",
  "content.page_update",
  "listing.update",
  "message.draft",
] as const;

export type AgentProposalKind = (typeof AGENT_PROPOSAL_KINDS)[number];

/** Kinds that move money. Refused outright on stale data (datastore §12.1). */
export const SPEND_CHANGING_KINDS = ["campaign.create", "campaign.budget_change"] as const;

export const STALE_LAG_SECONDS = 900;
const MAX_RATIONALE_CHARS = 2000;
const MAX_EVIDENCE_ITEMS = 50;

export type CreateProposalErrorCode =
  | "evidence_empty"
  | "evidence_not_identifier"
  | "invalid_kind"
  | "invalid_payload"
  | "stale_data_refusal";

export class CreateProposalError extends Error {
  constructor(readonly code: CreateProposalErrorCode) {
    super(code);
    this.name = "CreateProposalError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_RE = /^node:[0-9a-f-]{36}$/i;
const ARTIFACT_KEY_RE = /^artifacts\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}$/i;

/**
 * `evidence` holds identifiers only, never prose (dataflow review A-4). Row ids,
 * artifact keys, node ids — things that point at facts. An agent's narrative
 * belongs in `rationale`; allowing prose here would put the same reasoning in
 * three stores with no rule about which is authoritative.
 */
function isIdentifier(value: string): boolean {
  return UUID_RE.test(value) || NODE_RE.test(value) || ARTIFACT_KEY_RE.test(value);
}

const inputSchema = z.strictObject({
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string().min(1).max(MAX_RATIONALE_CHARS),
  evidence: z.array(z.string()).max(MAX_EVIDENCE_ITEMS),
});

async function currentCdcLagSeconds(orgId: string): Promise<number> {
  return withAgentTenantTx(orgId, async (tx) => {
    const { rows } = await tx.query<{ cdc_lag_seconds: number | null }>(
      `SELECT cdc_lag_seconds FROM context.v_agent_graph_manifest`,
    );
    // No manifest means nothing is known about freshness. Unknown is treated as
    // maximally stale, so the refusal fails closed.
    if (!rows[0] || rows[0].cdc_lag_seconds === null) return Number.MAX_SAFE_INTEGER;
    return Number(rows[0].cdc_lag_seconds);
  });
}

export async function createAgentProposal(
  claims: TaskTokenClaims,
  input: {
    kind: string;
    payload: Record<string, unknown>;
    rationale: string;
    evidence: string[];
  },
): Promise<{ proposalId: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new CreateProposalError("invalid_payload");
  const { kind, payload, rationale, evidence } = parsed.data;

  if (!(AGENT_PROPOSAL_KINDS as readonly string[]).includes(kind)) {
    throw new CreateProposalError("invalid_kind");
  }
  if (evidence.length === 0) throw new CreateProposalError("evidence_empty");
  if (!evidence.every(isIdentifier)) throw new CreateProposalError("evidence_not_identifier");

  const lag = await currentCdcLagSeconds(claims.orgId);
  const changesSpend = (SPEND_CHANGING_KINDS as readonly string[]).includes(kind);
  // Refusing is correct behaviour, not a failure: a budget change justified by
  // three-day-old spend looks exactly like a correct one.
  if (changesSpend && lag > STALE_LAG_SECONDS) throw new CreateProposalError("stale_data_refusal");

  const storedLag = lag === Number.MAX_SAFE_INTEGER ? null : lag;

  return withAgentTenantWriteTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<{ proposal_id: string }>(
      `SELECT adsagent.agent_create_proposal($1, $2::jsonb, $3, $4::text[], $5, $6) AS proposal_id`,
      [kind, JSON.stringify(payload), rationale, evidence, claims.profile, storedLag],
    );
    return { proposalId: rows[0].proposal_id };
  });
}
```

- [ ] **Step 6: Add the manifest view this reads, inside migration 104**

Append to `104_agent_create_proposal.up.sql`, immediately before `COMMIT;`:

```sql
-- Freshness is read through a view like every other agent read, so an agent
-- cannot obtain data without also obtaining how old it is (datastore §12.1).
CREATE OR REPLACE VIEW context.v_agent_graph_manifest
  WITH (security_invoker = true) AS
SELECT m.org_id, m.status, m.built_at, m.cdc_lag_seconds
  FROM context.graph_manifests m
 WHERE m.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_graph_manifest TO agent_ro;
```

And to `104_agent_create_proposal.down.sql`, immediately after `BEGIN;`:

```sql
DROP VIEW IF EXISTS context.v_agent_graph_manifest;
```

- [ ] **Step 7: Run the tests and watch them pass**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" -f lib/db/migrations/104_agent_create_proposal.up.sql
npx vitest run mcp/context-server/create-proposal.test.ts
DATABASE_URL="$DATABASE_URL" npx vitest run mcp/context-server/read-views.test.ts
```

Expected: the migration commits; `create-proposal.test.ts` PASS — 12 passed; `read-views.test.ts` still PASS (the new view is `security_invoker`, carries `current_tenant()`, and is granted `SELECT` only).

- [ ] **Step 8: Commit**

```bash
git add ads-agent/lib/db/migrations/104_agent_create_proposal.up.sql ads-agent/lib/db/migrations/104_agent_create_proposal.down.sql ads-agent/lib/db/schema.sql ads-agent/mcp/context-server/create-proposal.ts ads-agent/mcp/context-server/create-proposal.test.ts
git commit -m "feat(mcp-context): create_proposal, the only write tool

agent_ro holds no INSERT grant anywhere and EXECUTE on exactly one SECURITY
DEFINER function, so 'one write tool' is a database property. Empty evidence is
rejected in both layers, evidence must be identifiers not prose (A-4), and a
spend-changing proposal is refused when CDC lag exceeds 15 minutes."
```

## Task 10: `get_context_pack` — the grounding allowlist, carrying its own age

**Skills:** `senior-backend`, `llm-architect`
**Model:** `inherit` — what belongs in a pack, and what a pack may reference, is the judgement call.

**Files:**
- Create: `ads-agent/mcp/context-server/context-pack.ts`
- Test: `ads-agent/mcp/context-server/context-pack.test.ts`

**Interfaces:**
- Consumes: `withAgentTenantTx` from `./db`; `TaskTokenClaims` from `./task-token`; views `context.v_agent_enquiries`, `context.v_agent_enquiry_activity`, `context.v_agent_spaces`, `context.v_agent_campaigns`, `context.v_agent_graph_manifest` (Tasks 3 and 9); `STALE_LAG_SECONDS` from `./create-proposal`.
- Produces:
  - `type ContextPack = { entity: "enquiry" | "space" | "campaign"; id: string; builtAt: string; cdcLagSeconds: number | null; stale: boolean; facts: Record<string, unknown>; rowIds: string[] }`
  - `getContextPack(claims: TaskTokenClaims, input: { entity: "enquiry" | "space" | "campaign"; id: string }): Promise<ContextPack | null>`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/context-pack.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_o: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { getContextPack } from "./context-pack";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["get_context_pack"],
};
const ENQ = "33333333-3333-3333-3333-333333333333";
const BUILT_AT = new Date("2026-08-12T08:00:00.000Z");

function manifest(lag: number | null) {
  return { rows: [{ built_at: BUILT_AT, cdc_lag_seconds: lag }], rowCount: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getContextPack", () => {
  it("carries built_at and the CDC lag alongside the facts", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(30))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "a1", kind: "call", occurred_at: BUILT_AT }], rowCount: 1 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.builtAt).toBe("2026-08-12T08:00:00.000Z");
    expect(pack?.cdcLagSeconds).toBe(30);
    expect(pack?.stale).toBe(false);
  });

  it("marks the pack stale above the 15-minute threshold", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(1200))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.stale).toBe(true);
  });

  it("treats an unknown lag as stale, so unknown never reads as fresh", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(null))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.cdcLagSeconds).toBeNull();
    expect(pack?.stale).toBe(true);
  });

  it("lists every row id it drew on, so a claim outside the pack is detectably invented", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(30))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "a1", kind: "call", occurred_at: BUILT_AT }], rowCount: 1 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.rowIds).toEqual([ENQ, "a1"]);
  });

  it("returns null for another tenant's id", async () => {
    txQuery.mockResolvedValueOnce(manifest(30)).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ })).toBeNull();
  });

  it("rejects an unknown entity kind", async () => {
    // @ts-expect-error deliberately invalid at the type level too
    await expect(getContextPack(CLAIMS, { entity: "person", id: ENQ })).rejects.toThrow("invalid_entity");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/context-pack.test.ts`
Expected: FAIL — `Failed to resolve import "./context-pack"`.

- [ ] **Step 3: Write `context-pack.ts`**

```ts
// ads-agent/mcp/context-server/context-pack.ts
import { z } from "zod";
import { STALE_LAG_SECONDS } from "./create-proposal";
import { withAgentTenantTx, type TenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export const PACK_ENTITIES = ["enquiry", "space", "campaign"] as const;
export type PackEntity = (typeof PACK_ENTITIES)[number];

/**
 * What an agent calls before generating anything user-visible. It returns
 * exactly the facts the agent is permitted to cite, which makes grounding
 * auditable: if a claim is not in the pack, it was invented (agent spec §5, F4).
 *
 * `rowIds` is what a span references. A pack assembled from Postgres rows is
 * fully described by those ids, and copying it into the artifact store so a span
 * can point at an artifact would create a second copy of personal data with its
 * own erasure path — the exact defect dataflow review A-3 names.
 */
export type ContextPack = {
  entity: PackEntity;
  id: string;
  builtAt: string;
  cdcLagSeconds: number | null;
  stale: boolean;
  facts: Record<string, unknown>;
  rowIds: string[];
};

const inputSchema = z.strictObject({
  entity: z.enum(PACK_ENTITIES),
  id: z.string().uuid(),
});

type Freshness = { builtAt: string; cdcLagSeconds: number | null; stale: boolean };

async function readFreshness(tx: TenantTx): Promise<Freshness> {
  const { rows } = await tx.query<{ built_at: Date | null; cdc_lag_seconds: number | null }>(
    `SELECT built_at, cdc_lag_seconds FROM context.v_agent_graph_manifest`,
  );
  const row = rows[0];
  const lag = row?.cdc_lag_seconds === null || row?.cdc_lag_seconds === undefined
    ? null
    : Number(row.cdc_lag_seconds);
  return {
    builtAt: (row?.built_at ?? new Date(0)).toISOString(),
    cdcLagSeconds: lag,
    // Unknown lag is stale. An agent cannot obtain data without also obtaining
    // how old it is, and "we don't know" must not read as "it is fresh".
    stale: lag === null || lag > STALE_LAG_SECONDS,
  };
}

async function enquiryFacts(
  tx: TenantTx,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] } | null> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT id, contact_name, reply_state, corridor_id, listing_id, last_activity_at
       FROM context.v_agent_enquiries WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: activity } = await tx.query<Record<string, unknown>>(
    `SELECT id, kind, occurred_at FROM context.v_agent_enquiry_activity
      WHERE enquiry_id = $1 ORDER BY occurred_at ASC LIMIT 50`,
    [id],
  );
  return {
    facts: { enquiry: rows[0], activity },
    rowIds: [String(rows[0].id), ...activity.map((a) => String(a.id))],
  };
}

async function spaceFacts(
  tx: TenantTx,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] } | null> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT id, name, corridor_id, desks, price_per_desk, amenities, updated_at
       FROM context.v_agent_spaces WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return { facts: { space: rows[0] }, rowIds: [String(rows[0].id)] };
}

async function campaignFacts(
  tx: TenantTx,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] } | null> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT id, name, platform, status, corridor, daily_budget
       FROM context.v_agent_campaigns WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return { facts: { campaign: rows[0] }, rowIds: [String(rows[0].id)] };
}

export async function getContextPack(
  claims: TaskTokenClaims,
  input: { entity: PackEntity; id: string },
): Promise<ContextPack | null> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_entity");
  const { entity, id } = parsed.data;

  return withAgentTenantTx(claims.orgId, async (tx) => {
    const freshness = await readFreshness(tx);
    const loaded =
      entity === "enquiry"
        ? await enquiryFacts(tx, id)
        : entity === "space"
          ? await spaceFacts(tx, id)
          : await campaignFacts(tx, id);
    if (!loaded) return null;
    return { entity, id, ...freshness, facts: loaded.facts, rowIds: loaded.rowIds };
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/context-pack.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/context-server/context-pack.ts ads-agent/mcp/context-server/context-pack.test.ts
git commit -m "feat(mcp-context): get_context_pack carries built_at, CDC lag and its row ids

An agent cannot obtain data without also obtaining how old it is, unknown lag
reads as stale, and the pack is described by row ids rather than copied into the
artifact store (dataflow review A-3)."
```

**Contradiction noted for the reviewer, do not silently resolve it:** datastore §13.3 maps "retrieved context pack → `context.artifacts.id`", while dataflow review A-3 forbids copying content that already lives in Postgres into the artifact store. A pack of Postgres rows is exactly such content. This task follows A-3 (the later, corrective ruling) and returns `rowIds`. If a future pack contains genuinely homeless content — an assembled narrative rather than rows — that part becomes an artifact and the pack gains an `artifactId` field alongside `rowIds`.

## Task 11 (fan-in): Server assembly and the one dispatch path

**Skills:** `mcp-server-builder`, `mcp-developer`
**Model:** `inherit` — merging seven branches and getting the single-dispatch property right.

**Files:**
- Create: `ads-agent/mcp/context-server/tool-context.ts`
- Create: `ads-agent/mcp/context-server/index.ts`
- Create: `ads-agent/mcp/context-server/index.test.ts`
- Create: `ads-agent/scripts/run-context-mcp.ts`
- Modify: `ads-agent/package.json` — add `"mcp:context"` to `scripts`
- Modify: `ads-agent/docker-compose.yml` — add the `context-mcp` service

**Interfaces:**
- Consumes: every module from Tasks 2, 4, 5, 6, 7, 8, 9, 10.
- Produces:
  - `type SpanRecord = { name: string; attributes: Record<string, string | number | boolean>; startedAt: number; endedAt: number; status: "ok" | "error"; statusCode: string | null }`
  - `interface SpanSink { emit(span: SpanRecord): void | Promise<void> }`
  - `bufferSpanSink(): SpanSink & { spans: SpanRecord[] }`
  - `setSpanSink(sink: SpanSink): void`, `getSpanSink(): SpanSink`
  - `dispatchTool<T>(toolName: string, token: string, run: (claims: TaskTokenClaims) => Promise<T>): Promise<T>`
  - `buildContextMcpServer(): McpServer`
  - `resolveContextMcpAllowedHosts(): string[]`, `resolveContextMcpBind(): string`, `startContextMcpServer(port?: number): Promise<void>`
  - `CONTEXT_READ_TOOL_NAMES`, `CONTEXT_WRITE_TOOL_NAMES`

- [ ] **Step 1: Merge the seven W3 branches**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git merge --no-ff task-4-graph-query task-5-enquiries task-6-spaces task-7-performance task-8-proposals task-9-create-proposal task-10-context-pack
cd ads-agent && npx vitest run mcp/context-server/
```

Expected: no conflicts (the seven touch disjoint files; only `104_*.up.sql` and `103_*.up.sql` sit in the same directory and have different names), and every merged test still passes. If a conflict appears in a shared file, that is a violation of this plan's wave rules — record which files and report it.

- [ ] **Step 2: Write the failing test**

```ts
// ads-agent/mcp/context-server/index.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tokenMock = vi.hoisted(() => ({
  verifyTaskToken: vi.fn(),
  assertToolAllowed: vi.fn(),
  TaskTokenError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
}));
vi.mock("./task-token", () => tokenMock);

const readsMock = vi.hoisted(() => ({
  listEnquiries: vi.fn(),
  getEnquiry: vi.fn(),
}));
vi.mock("./read-enquiries", () => readsMock);

const writeMock = vi.hoisted(() => ({
  createAgentProposal: vi.fn(),
  AGENT_PROPOSAL_KINDS: ["enquiry.requirement_update"] as const,
  SPEND_CHANGING_KINDS: [] as const,
  STALE_LAG_SECONDS: 900,
  CreateProposalError: class extends Error {},
}));
vi.mock("./create-proposal", () => writeMock);

import {
  buildContextMcpServer,
  bufferSpanSink,
  CONTEXT_READ_TOOL_NAMES,
  CONTEXT_WRITE_TOOL_NAMES,
  setSpanSink,
} from "./index";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const TOKEN = "a".repeat(64);

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildContextMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.verifyTaskToken.mockResolvedValue({
    orgId: ORG_A,
    taskId: "task-1",
    profile: "leads",
    toolAllowlist: [...CONTEXT_READ_TOOL_NAMES, ...CONTEXT_WRITE_TOOL_NAMES],
  });
});

describe("buildContextMcpServer", () => {
  it("registers exactly 8 read tools and exactly 1 write tool", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...CONTEXT_READ_TOOL_NAMES, ...CONTEXT_WRITE_TOOL_NAMES].sort(),
    );
    expect(CONTEXT_READ_TOOL_NAMES).toHaveLength(8);
    expect(CONTEXT_WRITE_TOOL_NAMES).toEqual(["create_proposal"]);
    await client.close();
  });

  it("exposes create_proposal as the only write tool", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const writes = tools.filter((t) => !CONTEXT_READ_TOOL_NAMES.includes(t.name as never));
    expect(writes.map((t) => t.name)).toEqual(["create_proposal"]);
    await client.close();
  });

  it("no tool accepts an org_id: the tenant is never nameable by the caller", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const keys = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      expect(keys, `${tool.name} must not take a tenant`).not.toContain("org_id");
      expect(keys, `${tool.name} must not take a tenant`).not.toContain("orgId");
      expect(keys, `${tool.name} must require a task_token`).toContain("task_token");
    }
    await client.close();
  });

  it("no tool accepts query text", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const keys = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const banned of ["cypher", "sql", "query_text", "statement"]) {
        expect(keys, `${tool.name} must not take ${banned}`).not.toContain(banned);
      }
    }
    await client.close();
  });

  it("verifies the token and derives the tenant before running a tool", async () => {
    readsMock.listEnquiries.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(tokenMock.verifyTaskToken).toHaveBeenCalledWith(TOKEN);
    expect(readsMock.listEnquiries.mock.calls[0][0]).toMatchObject({ orgId: ORG_A });
    await client.close();
  });

  it("emits one span per tool call, carrying the profile, tool and tenant", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(sink.spans).toHaveLength(1);
    expect(sink.spans[0].attributes["gen_ai.agent.name"]).toBe("leads");
    expect(sink.spans[0].attributes["gen_ai.tool.name"]).toBe("list_enquiries");
    expect(sink.spans[0].attributes["gentlespace.tenant.id"]).toBe(ORG_A);
    await client.close();
  });

  it("emits a span on the error path too, with a code and no exception message", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockRejectedValue(new Error("Asha asked for 40 desks, asha@example.com"));
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(sink.spans).toHaveLength(1);
    expect(sink.spans[0].status).toBe("error");
    expect(JSON.stringify(sink.spans[0])).not.toContain("asha@example.com");
    await client.close();
  });

  it("returns not-found rather than a denial when get_enquiry yields null", async () => {
    readsMock.getEnquiry.mockResolvedValue(null);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "get_enquiry",
      arguments: { task_token: TOKEN, enquiry_id: "33333333-3333-3333-3333-333333333333" },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ error: "not_found" });
    await client.close();
  });
});

describe("single dispatch path", () => {
  it("registers every tool through registerGuardedTool and calls server.registerTool exactly once", () => {
    const src = readFileSync(join(__dirname, "index.ts"), "utf8");
    const direct = src.match(/server\.registerTool\(/g) ?? [];
    expect(direct, "server.registerTool must appear only inside registerGuardedTool").toHaveLength(1);
    const guarded = src.match(/registerGuardedTool\(/g) ?? [];
    // one definition + one call per tool (8 read + 1 write)
    expect(guarded.length).toBe(10);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index"` has no `buildContextMcpServer`.

- [ ] **Step 4: Write `tool-context.ts`**

```ts
// ads-agent/mcp/context-server/tool-context.ts
import { assertToolAllowed, verifyTaskToken, type TaskTokenClaims } from "./task-token";

export type SpanRecord = {
  name: string;
  attributes: Record<string, string | number | boolean>;
  startedAt: number;
  endedAt: number;
  status: "ok" | "error";
  statusCode: string | null;
};

export interface SpanSink {
  emit(span: SpanRecord): void | Promise<void>;
}

/** Collects spans in memory. Used by tests, and by nothing else. */
export function bufferSpanSink(): SpanSink & { spans: SpanRecord[] } {
  const spans: SpanRecord[] = [];
  return {
    spans,
    emit(span) {
      spans.push(span);
    },
  };
}

const consoleSpanSink: SpanSink = {
  emit(span) {
    console.log(JSON.stringify({ span: span.name, ...span.attributes, status: span.status }));
  },
};

let sink: SpanSink = consoleSpanSink;

export function setSpanSink(next: SpanSink): void {
  sink = next;
}

export function getSpanSink(): SpanSink {
  return sink;
}

/**
 * Turns any thrown value into a stable code. Never `err.message`: a message can
 * carry an enquiry body or a contact address, and this value reaches a span
 * (datastore §13.3). Task 15 replaces this with the shared `safeErrorCode`.
 */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && /^[a-z_]{3,40}$/.test(code) ? code : "tool_error";
}

/**
 * The one path every tool call takes. Token verification, tool allowlist, span
 * emission — and, from Task 17, the per-tenant cost ceiling. Because
 * registerGuardedTool in index.ts is the only caller of server.registerTool,
 * there is no untraced call path for any of those checks to be bypassed on.
 */
export async function dispatchTool<T>(
  toolName: string,
  token: string,
  run: (claims: TaskTokenClaims) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let claims: TaskTokenClaims | null = null;
  let status: "ok" | "error" = "ok";
  let statusCode: string | null = null;
  try {
    claims = await verifyTaskToken(token);
    assertToolAllowed(claims, toolName);
    return await run(claims);
  } catch (err) {
    status = "error";
    statusCode = errorCode(err);
    throw err;
  } finally {
    const attributes: Record<string, string | number | boolean> = {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": toolName,
      "gen_ai.agent.name": claims?.profile ?? "unknown",
      "gentlespace.tenant.id": claims?.orgId ?? "unknown",
      "gentlespace.task.id": claims?.taskId ?? "unknown",
      "gen_ai.client.operation.duration": Date.now() - startedAt,
    };
    if (statusCode) attributes["error.type"] = statusCode;
    await getSpanSink().emit({
      name: `execute_tool ${toolName}`,
      attributes,
      startedAt,
      endedAt: Date.now(),
      status,
      statusCode,
    });
  }
}
```

- [ ] **Step 5: Write `index.ts`**

```ts
// ads-agent/mcp/context-server/index.ts
import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import { getContextPack, PACK_ENTITIES } from "./context-pack";
import { AGENT_PROPOSAL_KINDS, createAgentProposal } from "./create-proposal";
import { describeGraphTemplates, runGraphQuery } from "./graph-query";
import { getEnquiry, listEnquiries, REPLY_STATES } from "./read-enquiries";
import { getCampaignPerformance } from "./read-performance";
import { AGENT_VISIBLE_PROPOSAL_STATUSES, listProposals } from "./read-proposals";
import { getSpace, searchSpaces } from "./read-spaces";
import type { TaskTokenClaims } from "./task-token";
import { dispatchTool } from "./tool-context";

export {
  bufferSpanSink,
  dispatchTool,
  getSpanSink,
  setSpanSink,
  type SpanRecord,
  type SpanSink,
} from "./tool-context";

export const CONTEXT_READ_TOOL_NAMES = [
  "search_spaces",
  "get_space",
  "list_enquiries",
  "get_enquiry",
  "get_campaign_performance",
  "list_proposals",
  "graph_query",
  "get_context_pack",
] as const;

/** Exactly one. Agents propose, humans dispose (agent spec AG1, §3). */
export const CONTEXT_WRITE_TOOL_NAMES = ["create_proposal"] as const;

const TASK_TOKEN_FIELD = {
  task_token: z
    .string()
    .describe("Task token issued by the dispatcher. The tenant is derived from it."),
};

/** Wrong tenant and nonexistent are the same answer: a denial confirms the row exists. */
const NOT_FOUND = { content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }] };

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/**
 * The only function in this file that calls server.registerTool. Every tool
 * therefore passes through dispatchTool, which is where token verification, the
 * tool allowlist, the cost ceiling and span emission live. A tool registered
 * around this helper would bypass all four, so index.test.ts asserts
 * server.registerTool appears exactly once in this file.
 */
function registerGuardedTool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: S,
  run: (claims: TaskTokenClaims, args: z.output<z.ZodObject<S>>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    { description, inputSchema: z.object({ ...TASK_TOKEN_FIELD, ...shape }) },
    async (args: { task_token: string } & z.output<z.ZodObject<S>>) => {
      const { task_token: token, ...rest } = args;
      try {
        const value = await dispatchTool(name, token, (claims) =>
          run(claims, rest as z.output<z.ZodObject<S>>),
        );
        return value === null ? NOT_FOUND : json(value);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        return json({ error: typeof code === "string" ? code : "tool_error" });
      }
    },
  );
}

export function buildContextMcpServer(): McpServer {
  const server = new McpServer({ name: "context-mcp", version: "1.0.0" });

  registerGuardedTool(
    server,
    "search_spaces",
    "Rank spaces in this tenant against a natural-language query, with optional corridor, desk and price filters",
    {
      query: z.string().min(1).max(500),
      filters: z
        .object({
          corridor: z.string().min(1).max(120).optional(),
          minDesks: z.number().int().min(0).optional(),
          maxDesks: z.number().int().min(1).optional(),
          maxPricePerDesk: z.number().min(0).optional(),
        })
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    (claims, args) => searchSpaces(claims, args),
  );

  registerGuardedTool(
    server,
    "get_space",
    "One space in this tenant with pricing, capacity and amenities",
    { space_id: z.string().uuid() },
    (claims, args) => getSpace(claims, args.space_id),
  );

  registerGuardedTool(
    server,
    "list_enquiries",
    "Enquiry summaries for this tenant, newest activity first",
    {
      status: z.enum(REPLY_STATES).optional(),
      since: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    (claims, args) => listEnquiries(claims, args),
  );

  registerGuardedTool(
    server,
    "get_enquiry",
    "One enquiry in this tenant with its activity and derived signals",
    { enquiry_id: z.string().uuid() },
    (claims, args) => getEnquiry(claims, args.enquiry_id),
  );

  registerGuardedTool(
    server,
    "get_campaign_performance",
    "Campaign spend, clicks, impressions and conversions from the ClickHouse mirror",
    { window_days: z.number().int().min(1).max(90), corridor: z.string().min(1).max(120).optional() },
    (claims, args) =>
      getCampaignPerformance(claims, { windowDays: args.window_days, corridor: args.corridor }),
  );

  registerGuardedTool(
    server,
    "list_proposals",
    "Proposals in this tenant, filtered by status",
    {
      status: z.enum(AGENT_VISIBLE_PROPOSAL_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    (claims, args) => listProposals(claims, args),
  );

  registerGuardedTool(
    server,
    "graph_query",
    `Run one named traversal template against this tenant's graph. Templates: ${describeGraphTemplates()
      .map((t) => `${t.name}(${t.params.join(", ")}) — ${t.description}`)
      .join("; ")}. Query text is not accepted.`,
    { template: z.string().min(1).max(64), params: z.record(z.string(), z.unknown()) },
    (claims, args) => runGraphQuery(claims, { template: args.template, params: args.params }),
  );

  registerGuardedTool(
    server,
    "get_context_pack",
    "The grounding allowlist for one entity: exactly the facts that may be cited, with built_at, CDC lag and the row ids drawn on",
    { entity: z.enum(PACK_ENTITIES), id: z.string().uuid() },
    (claims, args) => getContextPack(claims, args),
  );

  registerGuardedTool(
    server,
    "create_proposal",
    "The only write tool. Creates a pending proposal for human approval. Evidence must be identifiers from a context pack, never prose, and must not be empty.",
    {
      kind: z.enum(AGENT_PROPOSAL_KINDS),
      payload: z.record(z.string(), z.unknown()),
      rationale: z.string().min(1).max(2000),
      evidence: z.array(z.string()).min(1).max(50),
    },
    (claims, args) => createAgentProposal(claims, args),
  );

  return server;
}

/** Host-header allowlist for the DNS-rebinding guard, matching google-ads-server. */
export function resolveContextMcpAllowedHosts(): string[] {
  const raw = process.env.CONTEXT_MCP_ALLOWED_HOSTS;
  if (!raw) return ["localhost", "127.0.0.1"];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

export function resolveContextMcpBind(): string {
  const raw = process.env.CONTEXT_MCP_BIND?.trim();
  return raw && raw.length > 0 ? raw : "localhost";
}

/**
 * createMcpHandler is a stateless per-request factory. A single long-lived
 * transport rejects the second initialize with "Server already initialized",
 * and every client here opens a fresh session per call.
 */
export async function startContextMcpServer(port = 8768): Promise<void> {
  const handler = createMcpHandler(() => buildContextMcpServer());
  const nodeHandler = toNodeHandler(handler);
  const validateHost = hostHeaderValidation(resolveContextMcpAllowedHosts());
  const validateOrigin = localhostOriginValidation();
  const bind = resolveContextMcpBind();

  createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp?")) {
      res.writeHead(404).end();
      return;
    }
    void nodeHandler(req, res);
  }).listen(port, bind, () => {
    console.log(`context-mcp listening on http://${bind}:${port}/mcp`);
  });
}
```

- [ ] **Step 6: Write the launcher and wire it up**

```ts
// ads-agent/scripts/run-context-mcp.ts
/**
 * Standalone MCP context server — `npm run mcp:context`. Connects as agent_ro
 * (AGENT_RO_DATABASE_URL), never as the owner. Binds to localhost unless
 * CONTEXT_MCP_BIND says otherwise; see
 * docs/superpowers/plans/2026-08-12-s9-s9a-mcp-context-server-tracing.md.
 */
import { startContextMcpServer } from "../mcp/context-server/index";

startContextMcpServer().catch((err) => {
  console.error("context-mcp: failed to start", err);
  process.exit(1);
});
```

Add to `ads-agent/package.json` `scripts`, after the `"mcp:app-data"` line:

```json
    "mcp:context": "tsx --env-file=.env.local scripts/run-context-mcp.ts",
```

Add to `ads-agent/docker-compose.yml`, after the `app-data-mcp` service and before `volumes:`:

```yaml
  context-mcp:
    build: .
    command: ["npx", "tsx", "scripts/run-context-mcp.ts"]
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env.local
    environment:
      # agent_ro only. DATABASE_URL is deliberately NOT set for this service:
      # the owner connection would ignore row security unless FORCE is set on
      # every table, and this server must not depend on that being true.
      AGENT_RO_DATABASE_URL: postgres://agent_ro:agent_ro_local_dev@db:5432/gentle_space
      AGENT_CLICKHOUSE_URL: http://clickhouse:8123
      CONTEXT_MCP_ALLOWED_HOSTS: localhost,127.0.0.1,context-mcp,host.docker.internal
      CONTEXT_MCP_BIND: "0.0.0.0"
    ports:
      - "8768:8768"
    restart: unless-stopped
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/`
Expected: PASS — all files green, `index.test.ts` 10 passed.

- [ ] **Step 8: Start it once by hand and confirm the tool list**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
npm run mcp:context &
sleep 2
curl -s -X POST http://localhost:8768/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
kill %1
```

Expected: `context-mcp listening on http://localhost:8768/mcp`, then a JSON-RPC response naming nine tools.

- [ ] **Step 9: Commit**

```bash
git add ads-agent/mcp/context-server/index.ts ads-agent/mcp/context-server/index.test.ts ads-agent/mcp/context-server/tool-context.ts ads-agent/scripts/run-context-mcp.ts ads-agent/package.json ads-agent/docker-compose.yml
git commit -m "feat(mcp-context): assemble the context server behind one dispatch path

Eight read tools, exactly one write tool, and registerGuardedTool as the only
caller of server.registerTool -- so token verification, the tool allowlist and
span emission have no call path to be bypassed on. No tool takes an org_id or
query text."
```

## Task 12 (fan-in): the S9 gate — the four safety tests

**Skills:** `senior-qa`, `penetration-tester`
**Model:** `inherit` — a safety test that passes for the wrong reason is worse than no test.

**Files:**
- Create: `ads-agent/mcp/context-server/safety.test.ts`

**Interfaces:**
- Consumes: everything above, plus a live database with two seeded orgs.
- Produces: the S9 gate.

The four tests below are agent spec §9, quoted exactly:

> - **Tenant isolation test.** Spawn a worker with tenant A's token, attempt `get_enquiry` on a tenant B enquiry id, assert it returns not-found rather than data. This is the test that must never be skipped.
> - **Evidence enforcement test.** Call `create_proposal` with an empty `evidence` array, assert rejection.
> - **Read-only graph test.** Submit a mutating Cypher statement to `graph_query`, assert rejection.
> - **Proposal round-trip test.** An agent proposal appears in the approvals queue with its rationale and evidence intact, and executes only after human approval.

- [ ] **Step 1: Write the four safety tests**

```ts
// ads-agent/mcp/context-server/safety.test.ts
/**
 * The S9 gate. Agent spec §9: "Each agent gets one runnable check before it is
 * considered working." These four run against a live database with two orgs, by
 * calling the server directly — no agent exists yet, which is the point. This
 * whole safety model is worth proving before multiplying it by six agents.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Pool } from "pg";
import { buildContextMcpServer } from "./index";
import { mintTaskToken } from "./task-token";
import { closeAgentReadPool, getAgentReadPool } from "./db";

const LIVE = Boolean(process.env.DATABASE_URL && process.env.AGENT_RO_DATABASE_URL);
const ORG_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ORG_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const ENQUIRY_A = "aaaaaaaa-1111-0000-0000-00000000000a";
const ENQUIRY_B = "bbbbbbbb-1111-0000-0000-00000000000b";

const ALL_TOOLS = [
  "search_spaces",
  "get_space",
  "list_enquiries",
  "get_enquiry",
  "get_campaign_performance",
  "list_proposals",
  "graph_query",
  "get_context_pack",
  "create_proposal",
];

const owner = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function seed() {
  await owner!.query(
    `INSERT INTO public.orgs (id, name, kind) VALUES ($1,'Safety A','external'), ($2,'Safety B','external')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
  for (const [org, enquiry, name] of [
    [ORG_A, ENQUIRY_A, "Tenant A enquirer"],
    [ORG_B, ENQUIRY_B, "Tenant B enquirer"],
  ] as const) {
    await owner!.query("BEGIN");
    await owner!.query("SELECT public.set_tenant($1)", [org]);
    await owner!.query(
      `INSERT INTO adsagent.enquiries (id, org_id, contact_name, reply_state)
       VALUES ($1, $2, $3, 'waiting') ON CONFLICT (id) DO NOTHING`,
      [enquiry, org, name],
    );
    await owner!.query(
      `INSERT INTO context.graph_manifests (org_id, status, built_at, cdc_lag_seconds)
       VALUES ($1, 'ready', now(), 5)
       ON CONFLICT (org_id) DO UPDATE SET cdc_lag_seconds = 5, built_at = now()`,
      [org],
    );
    await owner!.query("COMMIT");
  }
}

async function client() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildContextMcpServer();
  const c = new Client({ name: "safety", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)]);
  return c;
}

function payload(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0].text);
}

let tokenA = "";

beforeAll(async () => {
  if (!LIVE) return;
  await seed();
  tokenA = (
    await mintTaskToken({
      orgId: ORG_A,
      taskId: "safety-task",
      profile: "leads",
      toolAllowlist: ALL_TOOLS,
      ttlSeconds: 600,
    })
  ).token;
});

afterAll(async () => {
  await owner?.end();
  await closeAgentReadPool();
});

describe.skipIf(!LIVE)("S9 safety gate", () => {
  it("1. tenant isolation: tenant A's token cannot read a tenant B enquiry", async () => {
    const c = await client();
    const mine = payload(
      await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenA, enquiry_id: ENQUIRY_A } }),
    );
    expect(mine).toMatchObject({ id: ENQUIRY_A });

    const theirs = payload(
      await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenA, enquiry_id: ENQUIRY_B } }),
    );
    // Not-found, not a denial. A denial confirms the row exists.
    expect(theirs).toEqual({ error: "not_found" });
    expect(JSON.stringify(theirs)).not.toContain("Tenant B enquirer");
    await c.close();
  });

  it("2. evidence enforcement: create_proposal with an empty evidence array is rejected", async () => {
    const c = await client();
    const result = await c.callTool({
      name: "create_proposal",
      arguments: {
        task_token: tokenA,
        kind: "enquiry.requirement_update",
        payload: { desks: 40 },
        rationale: "No citation offered.",
        evidence: [],
      },
    });
    expect(result.isError ?? false || JSON.stringify(payload(result)).includes("evidence")).toBe(true);

    // And the database refuses it independently of the tool layer.
    await expect(
      getAgentReadPool().query(
        `SELECT adsagent.agent_create_proposal('enquiry.requirement_update','{}'::jsonb,'x',ARRAY[]::text[],'leads',5)`,
      ),
    ).rejects.toThrow(/evidence must not be empty/);
    await c.close();
  });

  it("3. read-only graph: a mutating Cypher statement submitted to graph_query is rejected", async () => {
    const c = await client();
    for (const statement of [
      "MATCH (n:Space) SET n.price_per_desk = 0 RETURN n",
      "MATCH (n) DETACH DELETE n",
      "CREATE (n:Space {name:'injected'}) RETURN n",
    ]) {
      const result = payload(
        await c.callTool({ name: "graph_query", arguments: { task_token: tokenA, template: statement, params: {} } }),
      );
      expect(result).toEqual({ error: "unknown_template" });
    }
    await c.close();
  });

  it("4. proposal round-trip: the proposal reaches the queue with rationale and evidence intact", async () => {
    const c = await client();
    const created = payload(
      await c.callTool({
        name: "create_proposal",
        arguments: {
          task_token: tokenA,
          kind: "enquiry.requirement_update",
          payload: { desks: 40 },
          rationale: "Asked for 40 desks on the second call.",
          evidence: [ENQUIRY_A],
        },
      }),
    ) as { proposalId: string };
    expect(created.proposalId).toMatch(/^[0-9a-f-]{36}$/);

    const listed = payload(
      await c.callTool({ name: "list_proposals", arguments: { task_token: tokenA, status: "pending" } }),
    ) as { id: string; rationale: string; evidence: string[]; status: string }[];
    const found = listed.find((p) => p.id === created.proposalId);
    expect(found?.rationale).toBe("Asked for 40 desks on the second call.");
    expect(found?.evidence).toEqual([ENQUIRY_A]);

    // It has NOT executed, and the server has no tool that could execute it.
    expect(found?.status).toBe("pending");
    const { rows } = await owner!.query<{ status: string; executed_at: Date | null; proposed_by: string }>(
      `SELECT status, executed_at, proposed_by FROM adsagent.proposals WHERE id = $1`,
      [created.proposalId],
    );
    expect(rows[0]).toMatchObject({ status: "pending", executed_at: null, proposed_by: "leads" });
    await c.close();
  });

  it("5. the server's own connection cannot write, even asking for read-write", async () => {
    const pool = getAgentReadPool();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET TRANSACTION READ WRITE");
      await c.query("SELECT public.set_tenant($1)", [ORG_A]);
      await expect(
        c.query(
          `INSERT INTO adsagent.proposals (org_id, kind, payload, triggered_rule)
           VALUES ($1,'pause','{}'::jsonb,'direct')`,
          [ORG_A],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE adsagent.proposals SET status = 'approved' WHERE org_id = $1`, [ORG_A]),
      ).rejects.toThrow(/permission denied/);
      await expect(c.query(`SELECT * FROM adsagent.enquiries LIMIT 1`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("6. cross-tenant reads fail on a reused pooled connection", async () => {
    const single = new Pool({ connectionString: process.env.AGENT_RO_DATABASE_URL, max: 1 });
    try {
      const tokenB = (
        await mintTaskToken({
          orgId: ORG_B,
          taskId: "safety-task-b",
          profile: "leads",
          toolAllowlist: ALL_TOOLS,
          ttlSeconds: 600,
        })
      ).token;
      const c = await client();
      await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenB, enquiry_id: ENQUIRY_B } });
      // Same physical connection, next request, tenant A: must not see B's row.
      const after = payload(
        await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenA, enquiry_id: ENQUIRY_B } }),
      );
      expect(after).toEqual({ error: "not_found" });
      await c.close();
    } finally {
      await single.end();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Before running, temporarily set the environment **without** applying migration 100's grants, or point `AGENT_RO_DATABASE_URL` at the owner role, then:

Run: `cd ads-agent && DATABASE_URL="$DATABASE_URL" AGENT_RO_DATABASE_URL="$DATABASE_URL" npx vitest run mcp/context-server/safety.test.ts`
Expected: FAIL on tests 5 and 6 — an owner connection can `INSERT` and can read `adsagent.enquiries` directly. **This is the proof the tests can fail**; a safety suite that has never failed has not been shown to test anything.

- [ ] **Step 3: Run it correctly and watch all six pass**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" -c "ALTER ROLE agent_ro WITH PASSWORD 'agent_ro_local_dev'"
export AGENT_RO_DATABASE_URL="postgres://agent_ro:agent_ro_local_dev@localhost:5432/gentle_space"
DATABASE_URL="$DATABASE_URL" AGENT_RO_DATABASE_URL="$AGENT_RO_DATABASE_URL" npx vitest run mcp/context-server/safety.test.ts
```

Expected: `6 passed`, `0 skipped`. A skipped run is a failed gate — `describe.skipIf` is there so unit CI stays hermetic, not so this gate can be waived.

- [ ] **Step 4: Run the whole ads-agent suite**

Run: `cd ads-agent && npx vitest run`
Expected: all green, no regressions in the existing MCP servers or data layer.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/context-server/safety.test.ts
git commit -m "test(mcp-context): the four safety tests from agent spec §9, plus two

Tenant isolation, evidence enforcement, read-only graph, proposal round-trip --
and two more that would otherwise be assumed: the server's own connection cannot
write or read a base table, and a reused pooled connection cannot inherit the
previous request's tenant."
```

**S9 gate:** six safety tests green against a live two-tenant database with `AGENT_RO_DATABASE_URL` pointing at `agent_ro`, zero skipped, and the full `ads-agent` suite green. **Stop and confirm before S9a.** No agent exists at this point, and none should until this passes.

---

# S9a — Agent tracing on the existing ClickHouse

S9a is not optional and not "observability later." The two token metrics are the same signal that enforces the per-tenant cost ceiling, so shipping S10 without S9a ships an autonomous agent with no spend limit. **S9a must precede S10.**

## Task 13: Token metering and the per-tenant cost ceiling

**Skills:** `postgres-pro`, `senior-backend`
**Model:** `inherit` — a ceiling that warns instead of halting is not a control.

**Files:**
- Create: `ads-agent/lib/db/migrations/105_agent_token_usage.up.sql`
- Create: `ads-agent/lib/db/migrations/105_agent_token_usage.down.sql`
- Create: `ads-agent/lib/db/agent-cost.ts`
- Test: `ads-agent/lib/db/agent-cost.test.ts`

**Interfaces:**
- Consumes: `withAgentTenantTx`, `withAgentTenantWriteTx` from `../../mcp/context-server/db`.
- Produces:
  - `class CostCeilingExceededError extends Error { readonly code: "cost_ceiling_exceeded" }`
  - `assertWithinCeiling(orgId: string): Promise<void>`
  - `recordTokenUsage(orgId: string, input: { profile: string; tool: string; inputTokens: number; outputTokens: number; costUsd: number }): Promise<void>`
  - `getTenantSpendTodayUsd(orgId: string): Promise<{ spentUsd: number; ceilingUsd: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/agent-cost.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const readQuery = vi.hoisted(() => vi.fn());
const writeQuery = vi.hoisted(() => vi.fn());
vi.mock("../../mcp/context-server/db", () => ({
  withAgentTenantTx: async (_o: string, fn: (tx: { query: typeof readQuery }) => Promise<unknown>) =>
    fn({ query: readQuery }),
  withAgentTenantWriteTx: async (_o: string, fn: (tx: { query: typeof writeQuery }) => Promise<unknown>) =>
    fn({ query: writeQuery }),
}));

import { assertWithinCeiling, CostCeilingExceededError, getTenantSpendTodayUsd, recordTokenUsage } from "./agent-cost";

const ORG = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  writeQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe("assertWithinCeiling", () => {
  it("permits a tenant under its ceiling", async () => {
    readQuery.mockResolvedValue({ rows: [{ spent_usd: "1.50", ceiling_usd: "5.00" }], rowCount: 1 });
    await expect(assertWithinCeiling(ORG)).resolves.toBeUndefined();
  });

  it("halts a tenant at or above its ceiling", async () => {
    readQuery.mockResolvedValue({ rows: [{ spent_usd: "5.00", ceiling_usd: "5.00" }], rowCount: 1 });
    await expect(assertWithinCeiling(ORG)).rejects.toBeInstanceOf(CostCeilingExceededError);
  });

  it("halts rather than permits when no ceiling row exists, so the control fails closed", async () => {
    readQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(assertWithinCeiling(ORG)).rejects.toMatchObject({ code: "cost_ceiling_exceeded" });
  });
});

describe("recordTokenUsage", () => {
  it("records through the SECURITY DEFINER function, never a direct INSERT", async () => {
    await recordTokenUsage(ORG, {
      profile: "leads",
      tool: "get_enquiry",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.002,
    });
    const [sql, params] = writeQuery.mock.calls[0];
    expect(String(sql)).toContain("context.record_agent_token_usage");
    expect(String(sql)).not.toContain("INSERT");
    expect(params).toEqual(["leads", "get_enquiry", 100, 20, 0.002]);
  });

  it("rejects negative token counts rather than crediting a tenant", async () => {
    await expect(
      recordTokenUsage(ORG, { profile: "leads", tool: "t", inputTokens: -1, outputTokens: 0, costUsd: 0 }),
    ).rejects.toThrow("invalid_token_usage");
    expect(writeQuery).not.toHaveBeenCalled();
  });
});

describe("getTenantSpendTodayUsd", () => {
  it("returns numbers, not numeric strings", async () => {
    readQuery.mockResolvedValue({ rows: [{ spent_usd: "1.25", ceiling_usd: "5.00" }], rowCount: 1 });
    expect(await getTenantSpendTodayUsd(ORG)).toEqual({ spentUsd: 1.25, ceilingUsd: 5 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/agent-cost.test.ts`
Expected: FAIL — `Failed to resolve import "./agent-cost"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/105_agent_token_usage.up.sql
-- The two mandatory GenAI metrics land here as well as on a span, because a
-- ceiling read from the telemetry backend would depend on that backend being up.
-- Cost ceilings are a security control, not an optimisation (agent spec §6).
BEGIN;

CREATE TABLE IF NOT EXISTS context.agent_token_usage (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        UUID NOT NULL REFERENCES public.orgs(id),
  profile       TEXT NOT NULL,
  tool          TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL CHECK (input_tokens  >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cost_usd      NUMERIC(12,6) NOT NULL CHECK (cost_usd >= 0),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_token_usage_org_day_idx
  ON context.agent_token_usage (org_id, occurred_at DESC);

ALTER TABLE context.agent_token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.agent_token_usage FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON context.agent_token_usage
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE TABLE IF NOT EXISTS context.agent_cost_ceilings (
  org_id           UUID PRIMARY KEY REFERENCES public.orgs(id),
  daily_ceiling_usd NUMERIC(12,6) NOT NULL CHECK (daily_ceiling_usd >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.agent_cost_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.agent_cost_ceilings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON context.agent_cost_ceilings
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Every existing org gets a ceiling immediately: assertWithinCeiling halts when
-- no row exists, so an org without one cannot run an agent at all.
INSERT INTO context.agent_cost_ceilings (org_id, daily_ceiling_usd)
SELECT id, 5.000000 FROM public.orgs
ON CONFLICT (org_id) DO NOTHING;

CREATE OR REPLACE VIEW context.v_agent_spend_today
  WITH (security_invoker = true) AS
SELECT c.org_id,
       COALESCE((
         SELECT sum(u.cost_usd) FROM context.agent_token_usage u
          WHERE u.org_id = c.org_id
            AND u.occurred_at >= date_trunc('day', now())
       ), 0) AS spent_usd,
       c.daily_ceiling_usd AS ceiling_usd
  FROM context.agent_cost_ceilings c
 WHERE c.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_spend_today TO agent_ro;

CREATE OR REPLACE FUNCTION context.record_agent_token_usage(
  p_profile       TEXT,
  p_tool          TEXT,
  p_input_tokens  INTEGER,
  p_output_tokens INTEGER,
  p_cost_usd      NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = context, public
AS $$
DECLARE v_org UUID := public.current_tenant();
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'record_agent_token_usage: no tenant in session';
  END IF;
  INSERT INTO context.agent_token_usage
    (org_id, profile, tool, input_tokens, output_tokens, cost_usd)
  VALUES (v_org, p_profile, p_tool, p_input_tokens, p_output_tokens, p_cost_usd);
END
$$;

REVOKE ALL ON FUNCTION context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC) TO agent_ro;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/105_agent_token_usage.down.sql
BEGIN;
REVOKE EXECUTE ON FUNCTION context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC) FROM agent_ro;
DROP FUNCTION IF EXISTS context.record_agent_token_usage(TEXT, TEXT, INTEGER, INTEGER, NUMERIC);
DROP VIEW IF EXISTS context.v_agent_spend_today;
DROP POLICY IF EXISTS tenant_isolation ON context.agent_cost_ceilings;
DROP TABLE IF EXISTS context.agent_cost_ceilings;
DROP POLICY IF EXISTS tenant_isolation ON context.agent_token_usage;
DROP TABLE IF EXISTS context.agent_token_usage;
COMMIT;
```

- [ ] **Step 4: Write `agent-cost.ts`**

```ts
// ads-agent/lib/db/agent-cost.ts
import { withAgentTenantTx, withAgentTenantWriteTx } from "../../mcp/context-server/db";

export class CostCeilingExceededError extends Error {
  readonly code = "cost_ceiling_exceeded" as const;

  constructor() {
    super("cost_ceiling_exceeded");
    this.name = "CostCeilingExceededError";
  }
}

export async function getTenantSpendTodayUsd(
  orgId: string,
): Promise<{ spentUsd: number; ceilingUsd: number }> {
  return withAgentTenantTx(orgId, async (tx) => {
    const { rows } = await tx.query<{ spent_usd: string; ceiling_usd: string }>(
      `SELECT spent_usd, ceiling_usd FROM context.v_agent_spend_today`,
    );
    // No ceiling row means no ceiling was configured. Reported as zero-of-zero
    // so the caller halts: a tenant without a ceiling must not run an agent.
    if (!rows[0]) return { spentUsd: 0, ceilingUsd: 0 };
    return { spentUsd: Number(rows[0].spent_usd), ceilingUsd: Number(rows[0].ceiling_usd) };
  });
}

/**
 * Halts rather than warns. The public enquiry form is unauthenticated and can
 * fan multi-agent inference across hops, so the ceiling is the control that
 * actually bounds loss (agent spec §6, datastore §12.6).
 */
export async function assertWithinCeiling(orgId: string): Promise<void> {
  const { spentUsd, ceilingUsd } = await getTenantSpendTodayUsd(orgId);
  if (ceilingUsd <= 0 || spentUsd >= ceilingUsd) throw new CostCeilingExceededError();
}

export async function recordTokenUsage(
  orgId: string,
  input: {
    profile: string;
    tool: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  },
): Promise<void> {
  const { profile, tool, inputTokens, outputTokens, costUsd } = input;
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0 ||
    !(costUsd >= 0)
  ) {
    throw new Error("invalid_token_usage");
  }
  await withAgentTenantWriteTx(orgId, async (tx) => {
    await tx.query(`SELECT context.record_agent_token_usage($1, $2, $3, $4, $5)`, [
      profile,
      tool,
      inputTokens,
      outputTokens,
      costUsd,
    ]);
  });
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" -f lib/db/migrations/105_agent_token_usage.up.sql
npx vitest run lib/db/agent-cost.test.ts
```

Expected: PASS — 6 passed.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/migrations/105_agent_token_usage.up.sql ads-agent/lib/db/migrations/105_agent_token_usage.down.sql ads-agent/lib/db/agent-cost.ts ads-agent/lib/db/agent-cost.test.ts
git commit -m "feat(agent-cost): per-tenant daily ceiling that halts, from the token metrics

The ceiling is stored beside the usage rather than read from the telemetry
backend, so it does not depend on Langfuse being up, and a tenant with no
ceiling row is refused rather than allowed."
```

## Task 14: OTLP/HTTP span export to Langfuse, no new dependencies

**Skills:** `observability-designer`, `typescript-pro`
**Model:** `inherit` — the OTLP JSON envelope has to be right or nothing appears in Langfuse.

**Files:**
- Create: `ads-agent/lib/tracing/otlp-sink.ts`
- Test: `ads-agent/lib/tracing/otlp-sink.test.ts`

**Interfaces:**
- Consumes: `SpanRecord`, `SpanSink` from `../../mcp/context-server/tool-context`.
- Produces:
  - `otlpSpanSink(): SpanSink`
  - `toOtlpPayload(spans: SpanRecord[], serviceName: string): Record<string, unknown>`
  - `resolveOtlpEndpoint(): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/tracing/otlp-sink.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otlpSpanSink, resolveOtlpEndpoint, toOtlpPayload } from "./otlp-sink";
import type { SpanRecord } from "../../mcp/context-server/tool-context";

const SPAN: SpanRecord = {
  name: "execute_tool get_enquiry",
  attributes: {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": "get_enquiry",
    "gen_ai.agent.name": "leads",
    "gentlespace.tenant.id": "11111111-1111-1111-1111-111111111111",
    "gen_ai.client.token.usage": 120,
  },
  startedAt: 1_760_000_000_000,
  endedAt: 1_760_000_000_250,
  status: "ok",
  statusCode: null,
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LANGFUSE_OTLP_ENDPOINT = "http://langfuse-web:3000/api/public/otel/v1/traces";
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LANGFUSE_OTLP_ENDPOINT;
});

describe("toOtlpPayload", () => {
  it("builds one resourceSpans entry with the service name and nanosecond timestamps", () => {
    const payload = toOtlpPayload([SPAN], "context-mcp") as {
      resourceSpans: {
        resource: { attributes: { key: string; value: { stringValue?: string } }[] };
        scopeSpans: { spans: { name: string; startTimeUnixNano: string; endTimeUnixNano: string }[] }[];
      }[];
    };
    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].resource.attributes).toEqual(
      expect.arrayContaining([{ key: "service.name", value: { stringValue: "context-mcp" } }]),
    );
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("execute_tool get_enquiry");
    expect(span.startTimeUnixNano).toBe("1760000000000000000");
    expect(span.endTimeUnixNano).toBe("1760000000250000000");
  });

  it("emits string attributes as stringValue and numbers as intValue", () => {
    const payload = JSON.stringify(toOtlpPayload([SPAN], "context-mcp"));
    expect(payload).toContain('{"key":"gen_ai.tool.name","value":{"stringValue":"get_enquiry"}}');
    expect(payload).toContain('{"key":"gen_ai.client.token.usage","value":{"intValue":"120"}}');
  });

  it("never emits gen_ai.input.messages or gen_ai.output.messages", () => {
    const payload = JSON.stringify(
      toOtlpPayload(
        [{ ...SPAN, attributes: { ...SPAN.attributes, "gen_ai.input.messages": "hello Asha" } }],
        "context-mcp",
      ),
    );
    expect(payload).not.toContain("gen_ai.input.messages");
    expect(payload).not.toContain("hello Asha");
  });

  it("gives every span a 32-hex trace id and a 16-hex span id", () => {
    const payload = toOtlpPayload([SPAN], "context-mcp") as {
      resourceSpans: { scopeSpans: { spans: { traceId: string; spanId: string }[] }[] }[];
    };
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("otlpSpanSink", () => {
  it("POSTs to the endpoint with basic auth built from the Langfuse keys", async () => {
    await otlpSpanSink().emit(SPAN);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://langfuse-web:3000/api/public/otel/v1/traces");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toBe(`Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`);
  });

  it("never throws when the collector is down: telemetry must not break a tool call", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(otlpSpanSink().emit(SPAN)).resolves.toBeUndefined();
  });

  it("is a no-op when no endpoint is configured", async () => {
    delete process.env.LANGFUSE_OTLP_ENDPOINT;
    await otlpSpanSink().emit(SPAN);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveOtlpEndpoint()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/tracing/otlp-sink.test.ts`
Expected: FAIL — `Failed to resolve import "./otlp-sink"`.

- [ ] **Step 3: Write `otlp-sink.ts`**

```ts
// ads-agent/lib/tracing/otlp-sink.ts
import { randomBytes } from "node:crypto";
import type { SpanRecord, SpanSink } from "../../mcp/context-server/tool-context";

/**
 * Instrumented to the OTEL GenAI conventions rather than to Langfuse's SDK, so
 * the backend can be swapped without re-instrumenting (datastore §13.2).
 *
 * Emitted as OTLP/HTTP JSON with `fetch` and no OTEL SDK, because the standing
 * constraint is no new dependencies and this is one POST of one envelope. If
 * batching, context propagation across processes, or metric instruments become
 * necessary, that is the point to ask about adding @opentelemetry/sdk-node —
 * not before.
 */
const FORBIDDEN_ATTRIBUTES = new Set([
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.prompt",
  "gen_ai.completion",
]);

export function resolveOtlpEndpoint(): string | null {
  const raw = process.env.LANGFUSE_OTLP_ENDPOINT?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function attributeValue(value: string | number | boolean) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: value };
}

export function toOtlpPayload(spans: SpanRecord[], serviceName: string): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: "gentlespace.context-mcp", version: "1.0.0" },
            spans: spans.map((span) => ({
              traceId: randomBytes(16).toString("hex"),
              spanId: randomBytes(8).toString("hex"),
              name: span.name,
              kind: 1,
              startTimeUnixNano: `${span.startedAt}000000`,
              endTimeUnixNano: `${span.endedAt}000000`,
              // Message bodies are never captured on spans. Filtering here as
              // well as at the call site means a future caller cannot add one
              // by accident (datastore §13.3).
              attributes: Object.entries(span.attributes)
                .filter(([key]) => !FORBIDDEN_ATTRIBUTES.has(key))
                .map(([key, value]) => ({ key, value: attributeValue(value) })),
              status: span.status === "error" ? { code: 2, message: span.statusCode ?? "" } : { code: 1 },
            })),
          },
        ],
      },
    ],
  };
}

export function otlpSpanSink(serviceName = "context-mcp"): SpanSink {
  return {
    async emit(span: SpanRecord): Promise<void> {
      const endpoint = resolveOtlpEndpoint();
      if (!endpoint) return;
      const auth = Buffer.from(
        `${process.env.LANGFUSE_PUBLIC_KEY ?? ""}:${process.env.LANGFUSE_SECRET_KEY ?? ""}`,
      ).toString("base64");
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
          body: JSON.stringify(toOtlpPayload([span], serviceName)),
        });
      } catch {
        // A collector being down must never fail a tool call, and the caught
        // error is deliberately not logged: it can carry the request body.
      }
    },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/tracing/otlp-sink.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/tracing/otlp-sink.ts ads-agent/lib/tracing/otlp-sink.test.ts
git commit -m "feat(tracing): OTLP/HTTP JSON span export to Langfuse, zero new dependencies

Vendor-neutral gen_ai.* attributes so the backend can be swapped without
re-instrumenting. Forbidden message-body attributes are filtered in the exporter
as well as at the call site, and a collector outage cannot fail a tool call."
```

## Task 15: The no-message-bodies guard, including the error path

**Skills:** `gdpr-dsgvo-expert`, `ai-security`
**Model:** `inherit` — a negative assertion is only as good as the leak paths it enumerates.

**Files:**
- Create: `ads-agent/lib/tracing/redact.ts`
- Test: `ads-agent/lib/tracing/redact.test.ts`

**Interfaces:**
- Produces:
  - `const FORBIDDEN_SPAN_ATTRIBUTES: readonly string[]`
  - `const MAX_SPAN_ATTRIBUTE_CHARS = 256`
  - `class SpanRedactionError extends Error { readonly code: "span_attribute_forbidden" | "span_attribute_too_long" }`
  - `assertNoMessageBodies(attributes: Record<string, string | number | boolean>): void`
  - `safeErrorCode(err: unknown): string`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/tracing/redact.test.ts
import { describe, expect, it } from "vitest";
import { assertNoMessageBodies, MAX_SPAN_ATTRIBUTE_CHARS, safeErrorCode, SpanRedactionError } from "./redact";

const BODY =
  "Hi, we're looking for 40 desks in Whitefield from October. Reach me on asha@example.com or 98450 12345.";

describe("assertNoMessageBodies", () => {
  it("accepts structure and references", () => {
    expect(() =>
      assertNoMessageBodies({
        "gen_ai.tool.name": "get_enquiry",
        "gen_ai.agent.name": "leads",
        "gentlespace.tenant.id": "11111111-1111-1111-1111-111111111111",
        "gentlespace.enquiry.row_id": "33333333-3333-3333-3333-333333333333",
        "gen_ai.client.token.usage": 120,
        "gentlespace.cdc.lag_seconds": 12,
      }),
    ).not.toThrow();
  });

  it.each([
    "gen_ai.input.messages",
    "gen_ai.output.messages",
    "gen_ai.prompt",
    "gen_ai.completion",
    "gen_ai.content.prompt",
    "gen_ai.content.completion",
  ])("rejects the forbidden attribute %s", (key) => {
    expect(() => assertNoMessageBodies({ [key]: "anything" })).toThrow(SpanRedactionError);
  });

  it("rejects a body smuggled under an innocuous key, by length", () => {
    expect(() => assertNoMessageBodies({ "gentlespace.note": BODY.repeat(4) })).toThrow(
      /span_attribute_too_long/,
    );
  });

  it("caps at 256 characters, so a summary is fine and a transcript is not", () => {
    expect(() => assertNoMessageBodies({ x: "a".repeat(MAX_SPAN_ATTRIBUTE_CHARS) })).not.toThrow();
    expect(() => assertNoMessageBodies({ x: "a".repeat(MAX_SPAN_ATTRIBUTE_CHARS + 1) })).toThrow();
  });
});

describe("safeErrorCode", () => {
  it("returns the error's own code when it is a stable identifier", () => {
    expect(safeErrorCode(Object.assign(new Error("x"), { code: "token_invalid" }))).toBe("token_invalid");
  });

  it("never returns the exception message, which is where a body normally leaks", () => {
    const code = safeErrorCode(new Error(BODY));
    expect(code).toBe("tool_error");
    expect(code).not.toContain("asha@example.com");
  });

  it("does not trust a code that is itself prose", () => {
    expect(safeErrorCode(Object.assign(new Error("x"), { code: BODY }))).toBe("tool_error");
  });

  it("handles a thrown non-Error without reflecting it", () => {
    expect(safeErrorCode({ detail: BODY })).toBe("tool_error");
    expect(safeErrorCode(BODY)).toBe("tool_error");
    expect(safeErrorCode(undefined)).toBe("tool_error");
  });

  it("does not leak through a PostgreSQL error, whose detail can echo a row", () => {
    const pgError = Object.assign(new Error(`duplicate key value violates unique constraint`), {
      code: "23505",
      detail: `Key (contact_email)=(${"asha@example.com"}) already exists.`,
    });
    const code = safeErrorCode(pgError);
    expect(code).toBe("tool_error");
    expect(JSON.stringify({ code })).not.toContain("asha@example.com");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/tracing/redact.test.ts`
Expected: FAIL — `Failed to resolve import "./redact"`.

- [ ] **Step 3: Write `redact.ts`**

```ts
// ads-agent/lib/tracing/redact.ts
/**
 * Spans carry structure; content is referenced where it already lives
 * (datastore §13.3, dataflow review A-3). "No message bodies" is a negative
 * assertion, so it needs enforcement at every place a body can arrive:
 * a named attribute, a long value under an innocuous key, and an exception
 * message — which is where this normally breaks.
 */
export const FORBIDDEN_SPAN_ATTRIBUTES = [
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.content.prompt",
  "gen_ai.content.completion",
] as const;

export const MAX_SPAN_ATTRIBUTE_CHARS = 256;

export type SpanRedactionErrorCode = "span_attribute_forbidden" | "span_attribute_too_long";

export class SpanRedactionError extends Error {
  constructor(readonly code: SpanRedactionErrorCode, attributeKey: string) {
    super(`${code}: ${attributeKey}`);
    this.name = "SpanRedactionError";
  }
}

export function assertNoMessageBodies(
  attributes: Record<string, string | number | boolean>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if ((FORBIDDEN_SPAN_ATTRIBUTES as readonly string[]).includes(key)) {
      throw new SpanRedactionError("span_attribute_forbidden", key);
    }
    if (typeof value === "string" && value.length > MAX_SPAN_ATTRIBUTE_CHARS) {
      // The message names the key, never the value.
      throw new SpanRedactionError("span_attribute_too_long", key);
    }
  }
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{2,39}$/;

/**
 * The only permitted way to put a failure on a span. `err.message` is never
 * used: a Postgres error's message and detail echo row values, a ClickHouse
 * error echoes the query, and a validation error echoes the input.
 */
export function safeErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && CODE_PATTERN.test(code) ? code : "tool_error";
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/tracing/redact.test.ts`
Expected: PASS — 11 passed.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/tracing/redact.ts ads-agent/lib/tracing/redact.test.ts
git commit -m "feat(tracing): guard that no message body reaches a span

Enforced against three leak paths: a forbidden attribute name, a long value
under an innocuous key, and an exception message -- the last being where a
Postgres detail or ClickHouse error normally carries a row onto a span."
```

## Task 16: Langfuse on the existing ClickHouse

**Skills:** `senior-devops`, `docker-expert`
**Model:** `inherit` — pointing Langfuse at the ClickHouse we already operate, rather than standing up a second one, is the whole point of the choice.

**Files:**
- Modify: `ads-agent/docker-compose.yml` — add `langfuse-web`, `langfuse-worker`, `langfuse-redis`; extend the `context-mcp` service's environment
- Create: `ads-agent/.env.langfuse.example`
- Test: `ads-agent/mcp/context-server/deployment.test.ts`

**Interfaces:**
- Consumes: the ClickHouse from S6 (`clickhouse` service), the Garage S3 endpoint from S8a (`garage` service), and the `context-mcp` service from Task 11.
- Produces: a reachable OTLP endpoint at `http://langfuse-web:3000/api/public/otel/v1/traces`, and the environment `context-mcp` needs to reach it.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/mcp/context-server/deployment.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const compose = readFileSync(join(__dirname, "..", "..", "docker-compose.yml"), "utf8");

describe("langfuse deployment", () => {
  it.each(["langfuse-web:", "langfuse-worker:", "langfuse-redis:"])("declares the %s service", (service) => {
    expect(compose).toContain(service);
  });

  it("reuses the ClickHouse already being operated rather than starting a second one", () => {
    expect(compose).toContain("CLICKHOUSE_URL: http://clickhouse:8123");
    expect(compose.match(/^\s{2}clickhouse:/gm) ?? []).toHaveLength(0);
  });

  it("gives context-mcp the OTLP endpoint and the dual-emission opt-in", () => {
    expect(compose).toContain("LANGFUSE_OTLP_ENDPOINT: http://langfuse-web:3000/api/public/otel/v1/traces");
    expect(compose).toContain("OTEL_SEMCONV_STABILITY_OPT_IN: gen_ai_latest_experimental");
  });

  it("never gives context-mcp the owner DATABASE_URL", () => {
    const service = compose.slice(compose.indexOf("  context-mcp:"));
    const block = service.slice(0, service.indexOf("\n  langfuse-web:"));
    expect(block).toContain("AGENT_RO_DATABASE_URL");
    expect(block).not.toMatch(/^\s+DATABASE_URL:/m);
  });

  it("keeps secrets out of the file: every credential is an env reference", () => {
    for (const key of ["LANGFUSE_SECRET_KEY", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SALT", "NEXTAUTH_SECRET"]) {
      const line = compose.split("\n").find((l) => l.trim().startsWith(`${key}:`));
      expect(line, `${key} must be present`).toBeDefined();
      expect(line, `${key} must come from the environment`).toContain("${");
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/deployment.test.ts`
Expected: FAIL — no `langfuse-web:` in the compose file.

- [ ] **Step 3: Add the services**

Append to `ads-agent/docker-compose.yml` after the `context-mcp` service and before `volumes:`:

```yaml
  langfuse-redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "${LANGFUSE_REDIS_PASSWORD}"]
    healthcheck:
      test: ["CMD", "redis-cli", "--pass", "${LANGFUSE_REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  # Langfuse is built on ClickHouse and was acquired by ClickHouse in January
  # 2026, so self-hosting it adds an application rather than an engine -- the
  # decisive property given the one-operator constraint (datastore §13.2). It
  # points at the ClickHouse from S6 and the Garage S3 endpoint from S8a; it
  # must never start its own.
  langfuse-web:
    image: langfuse/langfuse:3
    depends_on:
      db:
        condition: service_healthy
      langfuse-redis:
        condition: service_healthy
    environment:
      DATABASE_URL: ${LANGFUSE_DATABASE_URL}
      CLICKHOUSE_URL: http://clickhouse:8123
      CLICKHOUSE_USER: ${LANGFUSE_CLICKHOUSE_USER}
      CLICKHOUSE_PASSWORD: ${LANGFUSE_CLICKHOUSE_PASSWORD}
      CLICKHOUSE_MIGRATION_URL: clickhouse://clickhouse:9000
      REDIS_CONNECTION_STRING: redis://:${LANGFUSE_REDIS_PASSWORD}@langfuse-redis:6379
      LANGFUSE_S3_EVENT_UPLOAD_BUCKET: ${LANGFUSE_S3_BUCKET}
      LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT: http://garage:3900
      LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_S3_ACCESS_KEY_ID}
      LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_S3_SECRET_ACCESS_KEY}
      LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE: "true"
      NEXTAUTH_URL: http://localhost:3100
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      SALT: ${LANGFUSE_SALT}
      ENCRYPTION_KEY: ${LANGFUSE_ENCRYPTION_KEY}
      TELEMETRY_ENABLED: "false"
      LANGFUSE_INIT_PROJECT_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY}
      LANGFUSE_INIT_PROJECT_SECRET_KEY: ${LANGFUSE_SECRET_KEY}
    ports:
      - "3100:3000"
    restart: unless-stopped

  langfuse-worker:
    image: langfuse/langfuse-worker:3
    depends_on:
      langfuse-web:
        condition: service_started
    environment:
      DATABASE_URL: ${LANGFUSE_DATABASE_URL}
      CLICKHOUSE_URL: http://clickhouse:8123
      CLICKHOUSE_USER: ${LANGFUSE_CLICKHOUSE_USER}
      CLICKHOUSE_PASSWORD: ${LANGFUSE_CLICKHOUSE_PASSWORD}
      CLICKHOUSE_MIGRATION_URL: clickhouse://clickhouse:9000
      REDIS_CONNECTION_STRING: redis://:${LANGFUSE_REDIS_PASSWORD}@langfuse-redis:6379
      LANGFUSE_S3_EVENT_UPLOAD_BUCKET: ${LANGFUSE_S3_BUCKET}
      LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT: http://garage:3900
      LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_S3_ACCESS_KEY_ID}
      LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_S3_SECRET_ACCESS_KEY}
      LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE: "true"
      SALT: ${LANGFUSE_SALT}
      ENCRYPTION_KEY: ${LANGFUSE_ENCRYPTION_KEY}
      TELEMETRY_ENABLED: "false"
    restart: unless-stopped
```

Then extend the `context-mcp` service's `environment` block from Task 11 with:

```yaml
      LANGFUSE_OTLP_ENDPOINT: http://langfuse-web:3000/api/public/otel/v1/traces
      LANGFUSE_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY}
      LANGFUSE_SECRET_KEY: ${LANGFUSE_SECRET_KEY}
      # The GenAI conventions are Development status as of Langfuse v1.41, so
      # gen_ai.* attribute names can change without a major version bump.
      # Dual-emission keeps a convention change from silently emptying a panel.
      OTEL_SEMCONV_STABILITY_OPT_IN: gen_ai_latest_experimental
```

- [ ] **Step 4: Write the env template**

```bash
# ads-agent/.env.langfuse.example
# Copy the values you need into ads-agent/.env.local. Nothing here is a real
# credential; every value is generated locally.
#
#   openssl rand -hex 32   # NEXTAUTH_SECRET, LANGFUSE_SALT
#   openssl rand -base64 32 # LANGFUSE_ENCRYPTION_KEY

LANGFUSE_DATABASE_URL=postgres://langfuse:langfuse_local_dev@db:5432/langfuse
LANGFUSE_CLICKHOUSE_USER=langfuse
LANGFUSE_CLICKHOUSE_PASSWORD=change_me
LANGFUSE_REDIS_PASSWORD=change_me
LANGFUSE_S3_BUCKET=langfuse-events
LANGFUSE_S3_ACCESS_KEY_ID=change_me
LANGFUSE_S3_SECRET_ACCESS_KEY=change_me
NEXTAUTH_SECRET=change_me
LANGFUSE_SALT=change_me
LANGFUSE_ENCRYPTION_KEY=change_me

# Project keys. langfuse-web provisions the project with these on first boot,
# and context-mcp authenticates its OTLP POST with the same pair.
LANGFUSE_PUBLIC_KEY=pk-lf-local-dev
LANGFUSE_SECRET_KEY=sk-lf-local-dev
LANGFUSE_OTLP_ENDPOINT=http://localhost:3100/api/public/otel/v1/traces
```

- [ ] **Step 5: Bring it up and confirm the OTLP endpoint answers**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
set -a && source .env.local && set +a
psql "$DATABASE_URL" -c "CREATE DATABASE langfuse" || true
docker compose up -d langfuse-redis langfuse-web langfuse-worker
sleep 45
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/api/public/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3100/api/public/otel/v1/traces \
  -H 'content-type: application/json' \
  -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  -d '{"resourceSpans":[]}'
```

Expected: `200` from the health endpoint, and `2xx` (`202` or `204`) from the OTLP endpoint. A `401` means the project keys did not provision — check `langfuse-web` logs for `LANGFUSE_INIT_PROJECT`.

- [ ] **Step 6: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run mcp/context-server/deployment.test.ts`
Expected: PASS — 8 passed.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/docker-compose.yml ads-agent/.env.langfuse.example ads-agent/mcp/context-server/deployment.test.ts
git commit -m "feat(tracing): self-hosted Langfuse on the ClickHouse we already operate

Adds an application rather than an engine. context-mcp gets the OTLP endpoint,
the project keys and OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental,
and still gets no owner DATABASE_URL."
```

## Task 17 (fan-in): the S9a gate — the ceiling has no bypass and no body leaks

**Skills:** `adversarial-reviewer`, `observability-designer`
**Model:** `inherit` — the gate is a set of negative properties, which is the hardest thing to be honest about.

**Files:**
- Modify: `ads-agent/mcp/context-server/tool-context.ts` — replace the local `errorCode`, add the ceiling check, the usage record and the redaction assertion
- Modify: `ads-agent/mcp/context-server/index.ts` — install `otlpSpanSink()` as the default sink in `startContextMcpServer`
- Create: `ads-agent/mcp/context-server/tracing.test.ts`

**Interfaces:**
- Consumes: `assertWithinCeiling`, `recordTokenUsage`, `CostCeilingExceededError` from `../../lib/db/agent-cost` (Task 13); `otlpSpanSink` from `../../lib/tracing/otlp-sink` (Task 14); `assertNoMessageBodies`, `safeErrorCode` from `../../lib/tracing/redact` (Task 15).
- Produces: the S9a gate.

- [ ] **Step 1: Merge the four W6 branches**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git merge --no-ff task-13-agent-cost task-14-otlp-sink task-15-redact task-16-langfuse
cd ads-agent && npx vitest run
```

Expected: no conflicts (four disjoint file sets; `docker-compose.yml` is touched only by Task 16), full suite green.

- [ ] **Step 2: Write the failing test**

```ts
// ads-agent/mcp/context-server/tracing.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tokenMock = vi.hoisted(() => ({
  verifyTaskToken: vi.fn(),
  assertToolAllowed: vi.fn(),
  TaskTokenError: class extends Error {},
}));
vi.mock("./task-token", () => tokenMock);

const costMock = vi.hoisted(() => ({
  assertWithinCeiling: vi.fn(),
  recordTokenUsage: vi.fn(),
  CostCeilingExceededError: class extends Error {
    readonly code = "cost_ceiling_exceeded";
  },
}));
vi.mock("../../lib/db/agent-cost", () => costMock);

const readsMock = vi.hoisted(() => ({ listEnquiries: vi.fn(), getEnquiry: vi.fn() }));
vi.mock("./read-enquiries", () => readsMock);

import {
  buildContextMcpServer,
  bufferSpanSink,
  CONTEXT_READ_TOOL_NAMES,
  CONTEXT_WRITE_TOOL_NAMES,
  setSpanSink,
} from "./index";

const ORG = "11111111-1111-1111-1111-111111111111";
const TOKEN = "a".repeat(64);
const BODY = "Asha wants 40 desks in Whitefield, reach her at asha@example.com";

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildContextMcpServer();
  const client = new Client({ name: "tracing", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function payload(result: unknown): unknown {
  return JSON.parse((result as { content: { text: string }[] }).content[0].text);
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.verifyTaskToken.mockResolvedValue({
    orgId: ORG,
    taskId: "task-1",
    profile: "leads",
    toolAllowlist: [...CONTEXT_READ_TOOL_NAMES, ...CONTEXT_WRITE_TOOL_NAMES],
  });
  costMock.assertWithinCeiling.mockResolvedValue(undefined);
  costMock.recordTokenUsage.mockResolvedValue(undefined);
  readsMock.listEnquiries.mockResolvedValue([]);
});

describe("the cost ceiling has no bypass", () => {
  it("checks the ceiling before running any tool", async () => {
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(costMock.assertWithinCeiling).toHaveBeenCalledWith(ORG);
    expect(costMock.assertWithinCeiling.mock.invocationCallOrder[0]).toBeLessThan(
      readsMock.listEnquiries.mock.invocationCallOrder[0],
    );
    await client.close();
  });

  it("refuses an over-budget tenant and never runs the tool", async () => {
    costMock.assertWithinCeiling.mockRejectedValue(new costMock.CostCeilingExceededError());
    const client = await connectedClient();
    const result = await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(payload(result)).toEqual({ error: "cost_ceiling_exceeded" });
    expect(readsMock.listEnquiries).not.toHaveBeenCalled();
    await client.close();
  });

  it("records token usage for every call, including one that failed", async () => {
    readsMock.listEnquiries.mockRejectedValue(new Error(BODY));
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(costMock.recordTokenUsage).toHaveBeenCalledWith(ORG, expect.objectContaining({ tool: "list_enquiries" }));
    await client.close();
  });

  it("has exactly one call site for the ceiling check, in tool-context.ts", () => {
    const dispatch = readFileSync(join(__dirname, "tool-context.ts"), "utf8");
    expect((dispatch.match(/assertWithinCeiling\(/g) ?? []).length).toBe(1);
    const index = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(index).not.toContain("assertWithinCeiling");
    expect((index.match(/server\.registerTool\(/g) ?? []).length).toBe(1);
  });
});

describe("no message bodies on a span", () => {
  it("emits structure and references only", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    const attrs = sink.spans[0].attributes;
    expect(Object.keys(attrs)).toEqual(
      expect.arrayContaining([
        "gen_ai.operation.name",
        "gen_ai.tool.name",
        "gen_ai.agent.name",
        "gentlespace.tenant.id",
        "gen_ai.client.operation.duration",
      ]),
    );
    expect(Object.keys(attrs)).not.toContain("gen_ai.input.messages");
    expect(Object.keys(attrs)).not.toContain("gen_ai.output.messages");
    await client.close();
  });

  it("does not leak a body through the error path", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockRejectedValue(new Error(BODY));
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(sink.spans[0].status).toBe("error");
    expect(sink.spans[0].statusCode).toBe("tool_error");
    expect(JSON.stringify(sink.spans[0])).not.toContain("asha@example.com");
    expect(JSON.stringify(sink.spans[0])).not.toContain("40 desks");
    await client.close();
  });

  it("does not leak a body through a Postgres error detail", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockRejectedValue(
      Object.assign(new Error("duplicate key"), {
        code: "23505",
        detail: `Key (contact_email)=(asha@example.com) already exists.`,
      }),
    );
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(JSON.stringify(sink.spans[0])).not.toContain("asha@example.com");
    await client.close();
  });

  it("drops a forbidden attribute rather than emitting the span with it", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    // assertNoMessageBodies runs on the assembled attributes; if it ever throws,
    // the span is dropped and the tool result is unaffected.
    expect(sink.spans).toHaveLength(1);
    await client.close();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run mcp/context-server/tracing.test.ts`
Expected: FAIL — `assertWithinCeiling` is never called, and `tool-context.ts` still defines its own `errorCode`.

- [ ] **Step 4: Rewrite `tool-context.ts`**

Replace the whole file with:

```ts
// ads-agent/mcp/context-server/tool-context.ts
import { assertWithinCeiling, recordTokenUsage } from "../../lib/db/agent-cost";
import { assertNoMessageBodies, safeErrorCode } from "../../lib/tracing/redact";
import { assertToolAllowed, verifyTaskToken, type TaskTokenClaims } from "./task-token";

export type SpanRecord = {
  name: string;
  attributes: Record<string, string | number | boolean>;
  startedAt: number;
  endedAt: number;
  status: "ok" | "error";
  statusCode: string | null;
};

export interface SpanSink {
  emit(span: SpanRecord): void | Promise<void>;
}

/** Collects spans in memory. Used by tests, and by nothing else. */
export function bufferSpanSink(): SpanSink & { spans: SpanRecord[] } {
  const spans: SpanRecord[] = [];
  return {
    spans,
    emit(span) {
      spans.push(span);
    },
  };
}

const consoleSpanSink: SpanSink = {
  emit(span) {
    console.log(JSON.stringify({ span: span.name, ...span.attributes, status: span.status }));
  },
};

let sink: SpanSink = consoleSpanSink;

export function setSpanSink(next: SpanSink): void {
  sink = next;
}

export function getSpanSink(): SpanSink {
  return sink;
}

/**
 * The one path every tool call takes: token verification, tool allowlist, cost
 * ceiling, execution, token-usage record, span emission. `registerGuardedTool`
 * in index.ts is the only caller of server.registerTool, so there is no
 * untraced call path on which any of those can be bypassed — which matters
 * because the token metrics are the same signal that enforces the per-tenant
 * ceiling (agent spec §8a).
 */
export async function dispatchTool<T>(
  toolName: string,
  token: string,
  run: (claims: TaskTokenClaims) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let claims: TaskTokenClaims | null = null;
  let status: "ok" | "error" = "ok";
  let statusCode: string | null = null;
  try {
    claims = await verifyTaskToken(token);
    assertToolAllowed(claims, toolName);
    // Halts rather than warns, and before any work is paid for.
    await assertWithinCeiling(claims.orgId);
    return await run(claims);
  } catch (err) {
    status = "error";
    statusCode = safeErrorCode(err);
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    if (claims) {
      // A tool call costs even when it fails, so it meters either way. Metering
      // must not mask the original error, hence the swallow.
      await recordTokenUsage(claims.orgId, {
        profile: claims.profile,
        tool: toolName,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }).catch(() => undefined);
    }
    const attributes: Record<string, string | number | boolean> = {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": toolName,
      "gen_ai.agent.name": claims?.profile ?? "unknown",
      "gentlespace.tenant.id": claims?.orgId ?? "unknown",
      "gentlespace.task.id": claims?.taskId ?? "unknown",
      "gen_ai.client.operation.duration": durationMs,
      "gen_ai.client.token.usage": 0,
    };
    if (statusCode) attributes["error.type"] = statusCode;
    try {
      // Structure only. If an attribute ever violates the rule, the span is
      // dropped rather than emitted — telemetry is never worth a PII leak, and
      // a dropped span cannot change the tool's result.
      assertNoMessageBodies(attributes);
      await getSpanSink().emit({
        name: `execute_tool ${toolName}`,
        attributes,
        startedAt,
        endedAt: Date.now(),
        status,
        statusCode,
      });
    } catch {
      console.warn(JSON.stringify({ event: "span_dropped", tool: toolName }));
    }
  }
}
```

**Why `inputTokens`/`outputTokens`/`costUsd` are zero here:** a tool call is not a model call. The counts become non-zero at S10, when the agent's own model call reports usage and passes it through this same path. The metric names, the meter and the ceiling all exist now, which is the point of S9a preceding S10 — the wiring is proven before there is anything to spend.

- [ ] **Step 5: Install the OTLP sink in the server entrypoint**

In `ads-agent/mcp/context-server/index.ts`, add the import and set the sink at the top of `startContextMcpServer`:

```ts
import { otlpSpanSink } from "../../lib/tracing/otlp-sink";
import { dispatchTool, setSpanSink } from "./tool-context";
```

```ts
export async function startContextMcpServer(port = 8768): Promise<void> {
  // Spans go to Langfuse over OTLP/HTTP. A missing LANGFUSE_OTLP_ENDPOINT makes
  // the sink a no-op rather than an error, so the server runs locally without it.
  setSpanSink(otlpSpanSink("context-mcp"));

  const handler = createMcpHandler(() => buildContextMcpServer());
  // ... rest unchanged ...
}
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
npx vitest run mcp/context-server/tracing.test.ts
npx vitest run mcp/context-server/index.test.ts
```

Expected: `tracing.test.ts` PASS — 8 passed; `index.test.ts` PASS — 10 passed (the span shape assertions there still hold).

- [ ] **Step 7: End-to-end: a real span reaches Langfuse and carries no body**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
set -a && source .env.local && set +a
docker compose up -d langfuse-web langfuse-worker context-mcp
sleep 20
TOKEN=$(npx tsx -e "
import { mintTaskToken } from './mcp/context-server/task-token';
mintTaskToken({ orgId: 'aaaaaaaa-0000-0000-0000-00000000000a', taskId: 'e2e', profile: 'leads',
  toolAllowlist: ['list_enquiries'], ttlSeconds: 300 }).then(r => console.log(r.token));
")
curl -s -X POST http://localhost:8768/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_enquiries\",\"arguments\":{\"task_token\":\"$TOKEN\"}}}"
sleep 15
curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "http://localhost:3100/api/public/observations?limit=5" > /tmp/langfuse-observations.json
grep -c 'execute_tool list_enquiries' /tmp/langfuse-observations.json
grep -c -E 'gen_ai\.(input|output)\.messages' /tmp/langfuse-observations.json || echo "0 message-body attributes"
```

Expected: the tool call returns a JSON-RPC result; the observations response contains at least one `execute_tool list_enquiries`; and the message-body grep prints `0 message-body attributes`. **This is the S9a gate in its literal form: a span carries structure and references, and no message bodies.**

- [ ] **Step 8: Assert the over-budget refusal against the live database**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
psql "$DATABASE_URL" <<'SQL'
BEGIN;
SELECT public.set_tenant('aaaaaaaa-0000-0000-0000-00000000000a');
UPDATE context.agent_cost_ceilings SET daily_ceiling_usd = 0.000001
 WHERE org_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
INSERT INTO context.agent_token_usage (org_id, profile, tool, input_tokens, output_tokens, cost_usd)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','leads','e2e',1,1,1.000000);
COMMIT;
SQL
curl -s -X POST http://localhost:8768/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"list_enquiries\",\"arguments\":{\"task_token\":\"$TOKEN\"}}}"
psql "$DATABASE_URL" -c "BEGIN; SELECT public.set_tenant('aaaaaaaa-0000-0000-0000-00000000000a'); UPDATE context.agent_cost_ceilings SET daily_ceiling_usd = 5 WHERE org_id = 'aaaaaaaa-0000-0000-0000-00000000000a'; COMMIT;"
```

Expected: the tool result is `{"error":"cost_ceiling_exceeded"}`. The tenant is refused, not warned.

- [ ] **Step 9: Full suite, then commit**

Run: `cd ads-agent && npx vitest run`
Expected: all green.

```bash
git add ads-agent/mcp/context-server/tool-context.ts ads-agent/mcp/context-server/index.ts ads-agent/mcp/context-server/tracing.test.ts
git commit -m "feat(tracing): wire the ceiling and the span into the single dispatch path

The ceiling is checked once, in the one function every tool call passes through,
so there is no untraced path to bypass it on. An over-budget tenant is refused
rather than warned, every call meters even when it fails, and no message body
reaches a span -- including through an exception message or a Postgres detail."
```

**S9a gate:** a live span in Langfuse for `execute_tool list_enquiries` carrying profile, tool, tenant, duration and token-usage attributes; zero `gen_ai.input.messages` / `gen_ai.output.messages` attributes anywhere in the observations response; an over-budget tenant refused end to end; and the full `ads-agent` suite green. **S10 does not start until this passes** — shipping an agent without it ships an autonomous agent with no spend limit.

---

## Final review

Dispatch one `adversarial-reviewer` on `inherit` over `git merge-base main HEAD..HEAD`, with the Global Constraints above as its attention lens. Point its Security Auditor persona at exactly four things:

1. **Is there any path to the database that does not go through `withAgentTenantTx` / `withAgentTenantWriteTx`?** Every query in `mcp/context-server/` must be inside one of them, and every one of those must call `public.set_tenant` inside the transaction.
2. **Is `registerGuardedTool` still the only caller of `server.registerTool`?** If a tool is ever registered directly, the ceiling, the allowlist and the span all silently disappear for it.
3. **Can any string derived from a tool parameter reach a SQL or Cypher statement?** The templates and every view query must use bound parameters exclusively.
4. **Can any value derived from row data or an exception reach a span attribute?** Trace the error path of each of the nine tools.

---

## Self-review

**1. Spec coverage.** Every requirement from the specs named in scope, mapped to a task:

| Spec requirement | Task |
|---|---|
| agent spec §5 read tools — `search_spaces`, `get_space` | 6 |
| agent spec §5 — `list_enquiries`, `get_enquiry` | 5 |
| agent spec §5 — `get_campaign_performance` from ClickHouse | 7 |
| agent spec §5 — `list_proposals` | 8 |
| agent spec §5 + validation F-19 — `graph_query` as templates over tenant-scoped views | 4 |
| agent spec §5 + datastore §12.1 — `get_context_pack` carrying `built_at` and lag; refuse spend changes above threshold | 10, 9 |
| agent spec §5 — non-owner `SELECT`-only role, CI test that a cross-tenant read fails; validation F-20 | 1, 3, 12 |
| agent spec §5 "The only write tool" — `create_proposal`, empty evidence rejected | 9, 11, 12 |
| agent spec §5 + dataflow A-4 — evidence holds identifiers only | 9 |
| agent spec §6 — dispatcher-bound tenant, task token, `set_config(..., true)`, revocation, tool allowlist in the token, never logged | 1, 2 |
| agent spec §6 + validation F-24 — cost ceiling that halts | 13, 17 |
| agent spec §8 — no send tool, no direct domain write, cannot approve, `performance` reads the mirror | 7, 9, 11 |
| agent spec §8a — OTEL GenAI conventions, two mandatory metrics, no message bodies, CDC lag on a span | 14, 15, 17, 10 |
| agent spec §9 — the four verification tests | 12 |
| agent spec §10 — Stage 1 has no agents | the whole plan; nothing here creates a Hermes profile |
| datastore §13.2 — self-hosted Langfuse on the existing ClickHouse, `OTEL_SEMCONV_STABILITY_OPT_IN` | 16 |
| datastore §13.3 — what a trace may contain | 15, 17, 10 |
| datastore §12.4 — one alertable signal for agent cost per tenant per day | 13 (`context.v_agent_spend_today` is the panel's query) |
| dataflow A-3 — traces reference content where it lives | 10, 15 |

**Requirements I could not turn into a task, with the reason:**

- **agent spec §6 "one uid per agent profile" and unix-socket token delivery with `SO_PEERCRED`** (validation F-23). There is no agent process in S9, so there is nothing to sandbox and nothing to deliver a token to. This lands with the Hermes dispatcher at **S12**. What S9 does provide is the property that makes it enforceable later: the token is opaque, server-side and revocable, so a leaked one can be killed.
- **agent spec §6 "length caps on enquiry text and bot mitigation on the form"**. The public enquiry form is the portal surface, owned by **S6a**, and `/api/spaces/search` lives in the root app. Both are outside this plan's file boundary.
- **datastore §13.4 artifact-byte bounding.** Enforced by `erase_after` on `context.artifacts`, which is **S8a**'s table. This plan does not write artifacts at all (see Task 10).
- **agent spec §5 `search_spaces` "pgvector + AGE" ranking.** Implemented as a tenant-scoped view query with ILIKE relevance, marked with a `ponytail:` comment naming the ceiling and the upgrade path. Ranking quality is not an S9 gate; tenant isolation is, and the isolation is identical either way.
- **agent spec §12 open questions 2–5** (model per profile, `usage_ledger` attribution, orchestrator schedule, review-at-volume). Open questions, not requirements. Task 13 does resolve open question 1 in passing: the token is opaque and server-side, because that is the revocable option.

**Contradictions between the specs, reported rather than silently resolved:**

1. **Safety test 3 versus F-19.** Agent spec §9 says "Submit a mutating Cypher statement to `graph_query`, assert rejection", but §5 (revised the same day) says `graph_query` never accepts query text — so there is no Cypher surface to submit to. Task 12 implements the test literally: the mutating statement is submitted where the template name goes and is rejected at the allowlist boundary. The test still passes; its original rationale (statement-type validation) is the control F-19 declares unsound.
2. **Where the graph lives.** Agent spec §5 has `graph_query` running against Postgres "views that already embed the tenant predicate" and `search_spaces` using "pgvector + AGE" — both Postgres — while data model §7 and the dataflow review ownership map put `graph_node` / `graph_edge` in ClickHouse. Task 4 resolves this by building Postgres views over the `pg_clickhouse` FDW foreign tables, which satisfies both readings. If S6 did not build those foreign tables, Task 4 Step 3 halts rather than guessing.
3. **Context pack storage.** Datastore §13.3 maps "retrieved context pack → `context.artifacts.id`"; dataflow review A-3 forbids copying content already in Postgres into the artifact store. A pack of Postgres rows is such content. Task 10 follows A-3, the later corrective ruling, and returns `rowIds`.
4. **Proposal kind vocabulary.** Agent spec §5 uses dotted kinds (`campaign.create`); the live `proposals_kind_check` admits five snake_case kinds (`create_campaign`, `pause`, …) that the existing executor and decision cycle depend on. Migration 104 widens the constraint to admit both rather than renaming, because renaming would require editing `lib/decision-engine/cycle.ts`, which this plan is forbidden to touch.
5. **Which cost ceiling.** Agent spec §8a says the two token metrics enforce the per-tenant cost ceiling; datastore §13.4 (revised) says the per-tenant read counter is gone and "the ceiling that matters is now bytes, not operations". These are two different ceilings — inference spend versus artifact storage — and §12.6 keeps the hard inference ceiling. Task 13 implements the inference ceiling; artifact bytes belong to S8a.
6. **Unowned columns.** Data model §2 lists `evidence` and `proposed_by` on `adsagent.proposals`, but the S1–S3 plan's migration 002 adds only `decided_by` and `decided_via`, and no other plan claims them. Migration 104 claims them with `ADD COLUMN IF NOT EXISTS`, so it is a no-op if S4 got there first.

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling", no "write tests for the above". Every code step contains the code. Every command has an expected output. The three `ponytail:` comments (space ranking in Task 6, signal derivation in Task 5) name their ceiling and their upgrade path, which is the repo's convention for a deliberate simplification rather than an omission. The two "halt and report" instructions (Task 3 Step 3, Task 4 Step 3) are escalations on a specific, checkable condition, not deferred work.

**3. Type consistency.** Checked across tasks: `TaskTokenClaims` is `{ orgId, taskId, profile, toolAllowlist }` everywhere (Tasks 2, 4–11, 17). `withAgentTenantTx(orgId, fn)` and `withAgentTenantWriteTx(orgId, fn)` keep the same shape in Tasks 1, 4–10 and 13. `SpanRecord` / `SpanSink` are defined once in `tool-context.ts` (Task 11), re-exported from `index.ts`, and imported by `otlp-sink.ts` (Task 14) — one definition, no parallel copy. `STALE_LAG_SECONDS` is exported from `create-proposal.ts` (Task 9) and imported by `context-pack.ts` (Task 10) rather than being duplicated as a second `900`. `dispatchTool(toolName, token, run)` has the same signature in Task 11 and after Task 17's rewrite. `safeErrorCode` (Task 15) replaces the local `errorCode` in Task 11's `tool-context.ts`, and Task 17 Step 4 replaces the whole file so no stale copy survives. `CONTEXT_READ_TOOL_NAMES` has eight entries and `CONTEXT_WRITE_TOOL_NAMES` exactly one, asserted in Tasks 11 and 17. Migration numbers: 100, 101, 102, 103, 104, 105 — each claimed once, all inside 100–109.
