# S6 + S6a — ClickHouse Mirror, CDC, Portal Ingestion and Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the ClickHouse analytical mirror with verified CDC from PostgreSQL, then land consent-gated portal ingestion end to end — a broker's page event reaches ClickHouse, and a withdrawn consent stops the next one within seconds.

**Architecture:** ClickHouse runs self-hosted with embedded Keeper. CDC is a watermark-driven pull executed *inside* ClickHouse through its built-in `postgresql()` table function, so no connector process and no new npm dependency exists; a reconciliation job compares source and mirror per `(org_id, occurred_on)` on a schedule and alerts on divergence or lag. Portal ingestion is a write-only edge endpoint in the `ads-agent` app that validates against a fixed versioned taxonomy, checks consent from a cache invalidated by PostgreSQL `LISTEN/NOTIFY`, and publishes through the S5a outbox. Pub/Sub's native Cloud Storage export subscription lands batches in a GCS bucket; ClickHouse's S3Queue engine plus a materialized view ingests them. Locally the same materialized view is driven by a `Null`-engine ingest table, so every transform is testable with no cloud credentials.

**Tech Stack:** PostgreSQL 18 (+ AGE, pgvector), ClickHouse 25.8 with embedded Keeper, Google Cloud Pub/Sub + Cloud Storage, Next.js 15 route handlers, TypeScript, `pg`, `zod` (already in `ads-agent`), Vitest. No new npm dependencies.

## Preconditions

Do not start until all of these hold. Each is a hard stop, not a warning.

- **S3 is complete and its release gate passed** (`docs/superpowers/plans/2026-08-12-s1-s3-foundation.md`). `ads-agent/lib/db/scope-sql.ts` exports `type Scope` and `scopeClause`; SQL `public.set_tenant(uuid)` and `public.current_tenant()` exist; schemas `listings`, `adsagent`, `context`, `public`, `derived` exist with roles `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, `derived_rw`, `agent_ro`; `public.lifecycle_state` and `public.org_ref` exist.
- **S4 is complete.** `context.session_links` carries `enquiry_id UUID NOT NULL REFERENCES adsagent.enquiries(id)`, so that table must exist. S4 is implied by S5a but is called out because Task 16 fails outright without it.
- **S5a is complete** (`docs/superpowers/plans/2026-08-12-s5a-event-backbone.md`). This plan publishes only through S5a's outbox and never touches Pub/Sub directly. Three interfaces are imported and **never redefined**:

  ```ts
  // Owned by S5a. Both apps have a copy with identical signatures (S5a Task 3 and Task 11).
  import { enqueueEvent, type OutboxEventInput } from "@/lib/db/outbox";
  // enqueueEvent(scope: Scope, client: PoolClient, event: { topic: OutboxTopic; payload: Record<string, unknown> }): Promise<string>
  //   returns context.outbox_events.id, which is also the consumer idempotency key.
  //   Throws on platform scope: every event belongs to exactly one tenant.

  import { withTenantTransaction } from "@/lib/db/tx";
  // withTenantTransaction<T>(scope: Scope, fn: (client: PoolClient) => Promise<T>, pool?: Pool): Promise<T>
  //   BEGIN, public.set_tenant when the scope is org-shaped, COMMIT, ROLLBACK on throw.

  // ads-agent/lib/db/scope-sql.ts (S3) and lib/db/scope.ts (S5a Task 11), same shape:
  // type Scope = { kind: "platform"; orgId: string } | { kind: "org"; orgId: string }
  ```

  **Do not add a second publish path, do not hand-roll a transaction, and do not stub any of these** — an event that bypasses the outbox can exist without its row, and a transaction that bypasses `withTenantTransaction` can leak a tenant across a pooled connection.

- **Divergence from an assumption in the S5a plan, recorded deliberately.** S5a's Task 11 says "S6a's portal ingestion endpoint … call these" about the *root app's* outbox copy, i.e. it assumed the edge endpoint would live in the listings app. **It lives in `ads-agent` here**, for three reasons: `zod` is already a dependency there and the fixed taxonomy needs closed schemas (adding `zod` to the root app would be a new dependency); `scope-sql.ts` and every `context.*` table this plan adds are already reached by the `adsagent_rw` role; and the endpoint is write-only with no query surface, so co-locating it with the admin app exposes nothing the admin app does not already expose. The root app reaches the edge over HTTP (Task 18) rather than enqueueing `portal.event` itself — **going straight to the outbox from the site would bypass the consent gate**, which is the one thing portal spec §1 says everything downstream depends on. S5a's root-app `portal.event` topic literal is therefore unused by this plan and harmless.
- **S6 must complete before S6a.** Every S6a task that reads or writes ClickHouse (Tasks 9, 11, 14, 19, 20) depends on the cluster S6 stands up. The wave table below marks which S6a tasks are cluster-free and may therefore overlap S6.

## Global Constraints

Every task inherits these. Copy them verbatim into every reviewer dispatch.

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

### Additional constraints this plan imposes

- **ClickHouse is never authoritative and never on the product's critical path.** If ingestion or replication stalls, the product degrades (no analytics, stale rollups); no request handler blocks on ClickHouse.
- **Every ClickHouse table carries `org_id`, leads its `ORDER BY` with `org_id`, and has a row policy** `TO ALL EXCEPT etl_writer`. The tenant profile defaults `SQL_current_tenant_id` to the zero UUID so an unset tenant matches nothing — fail closed.
- **The consent gate is the only entry point.** An event that fails validation, origin, rate limit, or consent is counted and discarded; it never reaches the outbox and therefore never reaches any store.
- **Rejections are counted, never persisted as events.** Counters aggregate in-process and flush as one upsert per `(org_id, reason, minute)`.
- **Withdrawal invalidation must not depend on cache TTL expiry.** Tests set the TTL to 60 s so a pass is only achievable through `LISTEN/NOTIFY` invalidation.
- **ClickHouse DDL is versioned separately** under `infra/clickhouse/migrations/NNN_name[.local|.cloud].up.sql` / `.down.sql`, numbered from `001` (with `000` for databases). PostgreSQL migrations for this plan occupy **050–069** only.
- **Neither app imports across the app boundary.** The root app uses its own `lib/db/scope.ts` and `lib/db/tx.ts` (S5a Task 11); `ads-agent` uses `lib/db/scope-sql.ts` (S3) and `lib/db/tx.ts` (S5a Task 2). Same signatures, deliberately duplicated, because there is no shared package.
- **`context.replication_state`, `context.reconciliation_runs` and `context.ingest_rejection_counters` are control-plane, not domain tables.** Replication reads every tenant's rows by design, exactly like the S5a relay, so those jobs write `context.access_log` with `actor_kind = 'cross_tenant'`.
- **ClickHouse credentials never appear in a migration file.** Migration SQL uses `${ENV_VAR}` placeholders, substituted by the runner, which throws when a variable is missing.

## Parallel execution model

`superpowers:subagent-driven-development` lists "dispatch multiple implementation subagents in parallel" under **Never**, because agents sharing a working tree corrupt each other. Real parallelism therefore means **one git worktree and branch per agent** (the `best-of-n-runner` subagent type), fanned out only where the file sets are provably disjoint, with an explicit fan-in merge task closing each wave. Ceiling: **8 concurrent implementation subagents**; this plan never exceeds 4, because that is what the evidence supports.

| Wave | Tasks | Width | Why that width |
|---|---|---|---|
| W1 | 1, 6, 7, 8 | **4** | Four disjoint file trees, no shared imports: T1 `infra/clickhouse/**` + `lib/clickhouse/{client,migrate}.ts` + `docker-compose.clickhouse.yml`; T6 `ads-agent/lib/db/migrations/052–055*`; T7 `ads-agent/lib/portal/taxonomy.ts`; T8 `infra/gcs/**` + `infra/pubsub/**`. T6–T8 are S6a tasks that touch no ClickHouse object, so the S6a→S6 dependency (the cluster being ingested into) is not violated. T8 needs only the S5a `portal.event` topic. |
| W2 | 2, 9, 10 | **3** | All three need W1 outputs and nothing else. Disjoint files: T2 `infra/clickhouse/migrations/001_*` + `lib/clickhouse/analytics.test.ts`; T9 `infra/clickhouse/migrations/002_*–005_*` + `lib/clickhouse/raw-zone.test.ts`; T10 `ads-agent/lib/portal/{consent,consent-cache}.ts`. T2 and T9 share a directory but no file and no ClickHouse migration number. |
| W3 | 3, 11, 12 | **3** | Stated dependencies: T3 ← T2 (inserts into `analytics.enquiry_fact`); T11 ← T9 (rollup reads `raw.portal_events`); T12 ← T7 + T10. Disjoint files: T3 `lib/clickhouse/replicate.ts` + `scripts/clickhouse/replicate.ts` + PG `050`; T11 `infra/clickhouse/migrations/006_*,007_*`; T12 `ads-agent/lib/portal/{config,rate-limit,rejections,ingest}.ts` + `ads-agent/app/api/v1/ingest/route.ts` + PG `061`. |
| W4 | 4, 13, 14, 16 | **4** | T4 ← T3; T13 ← T10; T14 ← T11; T16 ← T12. Disjoint files: T4 `lib/clickhouse/reconcile.ts` + `lib/observability/alert.ts` + `scripts/clickhouse/reconcile.ts` + PG `051`; T13 `ads-agent/app/api/v1/consent/route.ts`; T14 `lib/clickhouse/project-derived.ts` + PG `056`; T16 `ads-agent/lib/portal/session-links.ts` + PG `057` + **modifies `ads-agent/lib/portal/ingest.ts`** (sole modifier in this wave). |
| W5 | 5, 15, 17 | **3** | T5 is the S6 fan-in gate (← T4). T15 ← T12 + T13 and creates only test files, so it cannot conflict; it is deliberately scheduled *after* T16's edit to `ingest.ts` has merged, so the latency measurement runs against the final gate. T17 ← T13 and lives entirely in the root app (`lib/portal/session.ts`, `components/consent/ConsentBanner.tsx`, `app/api/portal/consent/route.ts`). |
| W6 | 18, 19 | **2** | T18 ← T17 + T12; T19 ← T9 + T16. Disjoint: T18 root app `app/api/spaces/search/route.ts`, `lib/search/query-log.ts`, `lib/portal/emit.ts`, `lib/db/schema.sql`, PG `058`, PG `059`; T19 `lib/clickhouse/{retention,erasure}.ts`, PG `060`. Different PG migration numbers, no shared file. |
| W7 | 20 | **1** | S6a fan-in gate. Runs both suites, the end-to-end path, and the measured withdrawal latency against the merged branch. |

**Migration numbers are claimed per task and never shared inside a wave:** T3→`050`, T4→`051`, T6→`052`–`055`, T12→`061`, T14→`056`, T16→`057`, T18→`058`+`059`, T19→`060`. ClickHouse: T1→`000`, T2→`001`, T9→`002`–`005`, T11→`006`–`007`.

**Review between waves.** After each fan-in, dispatch one `code-reviewer` scaled to the diff. After W7, dispatch one `adversarial-reviewer` on the whole branch with the Global Constraints as its lens, pointed specifically at: the consent gate's rejection paths, the measured withdrawal latency, the row policies, and whether any ClickHouse write path can reach a table without `org_id`.

---

# S6 — ClickHouse mirror and CDC

Gate: **replicated data matches source**, proven by a reconciliation job run repeatedly with a stated lag tolerance and an alert when it is exceeded.

## Task 1: ClickHouse service, client, and migration runner

**Skills:** `senior-devops`, `docker-expert`, `typescript-pro`
**Model:** `inherit` — the Keeper, custom-settings-prefix and user-profile configuration has to be reasoned about against the running server, not typed out.

**Files:**
- Create: `docker-compose.clickhouse.yml`
- Create: `infra/clickhouse/config.d/keeper.xml`
- Create: `infra/clickhouse/config.d/custom-settings.xml`
- Create: `infra/clickhouse/users.d/etl.xml`
- Create: `infra/clickhouse/migrations/000_databases.up.sql`
- Create: `infra/clickhouse/migrations/000_databases.down.sql`
- Create: `lib/clickhouse/client.ts`
- Create: `lib/clickhouse/migrate.ts`
- Create: `scripts/clickhouse/migrate.ts`
- Test: `lib/clickhouse/migrate.test.ts`
- Test: `lib/clickhouse/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `clickhouseConfig(env?: NodeJS.ProcessEnv): ClickHouseConfig` where `ClickHouseConfig = { url: string; user: string; password: string; target: "local" | "cloud" }`
  - `chQuery<T>(sql: string, options?: { params?: Record<string,string>; settings?: Record<string,string>; config?: ClickHouseConfig }): Promise<T[]>`
  - `chExec(sql: string, options?: same): Promise<void>`
  - `selectMigrations(files: string[], target: "local"|"cloud"): string[]`
  - `splitStatements(sql: string): string[]`
  - `substituteEnv(sql: string, env?: NodeJS.ProcessEnv): string`
  - `applyMigrations(options?: { dir?: string; config?: ClickHouseConfig }): Promise<string[]>` — returns the versions newly applied
  - Databases `analytics` and `raw`; ClickHouse users `etl_writer` and `tenant_reader`.

- [ ] **Step 1: Write the failing tests for the pure migration helpers**

```ts
// lib/clickhouse/migrate.test.ts
import { describe, it, expect } from "vitest";
import { selectMigrations, splitStatements, substituteEnv, versionOf } from "./migrate";

describe("selectMigrations", () => {
  const files = [
    "000_databases.up.sql",
    "000_databases.down.sql",
    "003_portal_event_ingest.local.up.sql",
    "003_portal_event_ingest.cloud.up.sql",
    "004_portal_event_mv.up.sql",
  ];

  it("keeps only up files and the variant matching the target", () => {
    expect(selectMigrations(files, "local")).toEqual([
      "000_databases.up.sql",
      "003_portal_event_ingest.local.up.sql",
      "004_portal_event_mv.up.sql",
    ]);
    expect(selectMigrations(files, "cloud")).toEqual([
      "000_databases.up.sql",
      "003_portal_event_ingest.cloud.up.sql",
      "004_portal_event_mv.up.sql",
    ]);
  });
});

describe("splitStatements", () => {
  it("drops comment lines and splits on semicolons", () => {
    const sql = `-- a comment\nCREATE DATABASE a;\n\n-- another\nCREATE DATABASE b;\n`;
    expect(splitStatements(sql)).toEqual(["CREATE DATABASE a", "CREATE DATABASE b"]);
  });
});

describe("substituteEnv", () => {
  it("substitutes present variables", () => {
    expect(substituteEnv("KEY ${A} SECRET ${B}", { A: "one", B: "two" })).toBe("KEY one SECRET two");
  });

  it("throws naming the missing variable rather than emitting an empty credential", () => {
    expect(() => substituteEnv("KEY ${GCS_HMAC_ACCESS_ID}", {})).toThrow("GCS_HMAC_ACCESS_ID");
  });
});

describe("versionOf", () => {
  it("takes the numeric prefix", () => {
    expect(versionOf("003_portal_event_ingest.local.up.sql")).toBe("003");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run lib/clickhouse/migrate.test.ts`
Expected: FAIL — `Failed to resolve import "./migrate"`.

- [ ] **Step 3: Write the HTTP client**

```ts
// lib/clickhouse/client.ts
export type ClickHouseTarget = "local" | "cloud";

export type ClickHouseConfig = {
  url: string;
  user: string;
  password: string;
  target: ClickHouseTarget;
};

export type ClickHouseOptions = {
  params?: Record<string, string>;
  settings?: Record<string, string>;
  config?: ClickHouseConfig;
};

export function clickhouseConfig(env: NodeJS.ProcessEnv = process.env): ClickHouseConfig {
  const url = env.CLICKHOUSE_URL;
  if (!url) throw new Error("CLICKHOUSE_URL is not set");
  return {
    url,
    user: env.CLICKHOUSE_USER ?? "etl_writer",
    password: env.CLICKHOUSE_PASSWORD ?? "",
    target: env.CLICKHOUSE_TARGET === "cloud" ? "cloud" : "local",
  };
}

function searchFor(options: ClickHouseOptions): Record<string, string> {
  const search: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.params ?? {})) search[`param_${key}`] = value;
  for (const [key, value] of Object.entries(options.settings ?? {})) search[key] = value;
  return search;
}

async function post(sql: string, search: Record<string, string>, config: ClickHouseConfig): Promise<string> {
  const url = new URL(config.url);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-ClickHouse-User": config.user,
      "X-ClickHouse-Key": config.password,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

export async function chExec(sql: string, options: ClickHouseOptions = {}): Promise<void> {
  await post(sql, searchFor(options), options.config ?? clickhouseConfig());
}

export async function chQuery<T>(sql: string, options: ClickHouseOptions = {}): Promise<T[]> {
  const text = await post(
    sql,
    { ...searchFor(options), default_format: "JSONEachRow" },
    options.config ?? clickhouseConfig(),
  );
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
```

- [ ] **Step 4: Write the migration runner**

```ts
// lib/clickhouse/migrate.ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chExec, chQuery, clickhouseConfig, type ClickHouseConfig } from "./client";

export const DEFAULT_MIGRATIONS_DIR = path.join(process.cwd(), "infra/clickhouse/migrations");

export function versionOf(file: string): string {
  return file.slice(0, 3);
}

export function selectMigrations(files: string[], target: "local" | "cloud"): string[] {
  const wrongVariant = target === "local" ? ".cloud.up.sql" : ".local.up.sql";
  return files
    .filter((f) => f.endsWith(".up.sql") && !f.endsWith(wrongVariant))
    .sort();
}

// ponytail: naive `;` split. Safe because no statement in infra/clickhouse/migrations
// contains a semicolon inside a string literal. If one ever needs to, switch to a
// tokenising splitter rather than escaping around this.
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function substituteEnv(sql: string, env: NodeJS.ProcessEnv = process.env): string {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = env[name];
    if (!value) throw new Error(`clickhouse migration requires ${name} but it is not set`);
    return value;
  });
}

export async function applyMigrations(
  options: { dir?: string; config?: ClickHouseConfig } = {},
): Promise<string[]> {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const config = options.config ?? clickhouseConfig();

  await chExec(
    `CREATE TABLE IF NOT EXISTS default._ch_migrations (
       version String, file String, applied_at DateTime64(3) DEFAULT now64(3)
     ) ENGINE = ReplacingMergeTree(applied_at) ORDER BY version`,
    { config },
  );

  const applied = new Set(
    (await chQuery<{ version: string }>(
      "SELECT version FROM default._ch_migrations FINAL",
      { config },
    )).map((row) => row.version),
  );

  const newlyApplied: string[] = [];
  for (const file of selectMigrations(readdirSync(dir), config.target)) {
    const version = versionOf(file);
    if (applied.has(version)) continue;
    const sql = substituteEnv(readFileSync(path.join(dir, file), "utf-8"));
    for (const statement of splitStatements(sql)) {
      await chExec(statement, { config });
    }
    await chExec(
      `INSERT INTO default._ch_migrations (version, file) VALUES ({version:String}, {file:String})`,
      { config, params: { version, file } },
    );
    newlyApplied.push(version);
  }
  return newlyApplied;
}
```

```ts
// scripts/clickhouse/migrate.ts
import { applyMigrations } from "../../lib/clickhouse/migrate";

async function main(): Promise<void> {
  const applied = await applyMigrations();
  console.log(applied.length === 0 ? "clickhouse: up to date" : `clickhouse: applied ${applied.join(", ")}`);
}

main().catch((err) => {
  console.error("clickhouse: migration failed", err);
  process.exit(1);
});
```

- [ ] **Step 5: Run the helper tests and watch them pass**

Run: `npx vitest run lib/clickhouse/migrate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the client test**

```ts
// lib/clickhouse/client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { chQuery, clickhouseConfig } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("clickhouseConfig", () => {
  it("throws when the url is absent rather than defaulting to localhost", () => {
    expect(() => clickhouseConfig({})).toThrow("CLICKHOUSE_URL");
  });

  it("defaults the target to local so cloud-only DDL is never applied by accident", () => {
    expect(clickhouseConfig({ CLICKHOUSE_URL: "http://x:8123" }).target).toBe("local");
  });
});

describe("chQuery", () => {
  it("parses JSONEachRow and sends query parameters prefixed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"a":1}\n{"a":2}\n', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const rows = await chQuery<{ a: number }>("SELECT {n:UInt8} AS a", {
      params: { n: "1" },
      config: { url: "http://x:8123", user: "etl_writer", password: "p", target: "local" },
    });

    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    const called = new URL(fetchMock.mock.calls[0][0]);
    expect(called.searchParams.get("param_n")).toBe("1");
    expect(called.searchParams.get("default_format")).toBe("JSONEachRow");
  });

  it("throws with the server body when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Syntax error", { status: 400 })));
    await expect(
      chQuery("NOPE", { config: { url: "http://x:8123", user: "u", password: "", target: "local" } }),
    ).rejects.toThrow("clickhouse 400: Syntax error");
  });
});
```

Run: `npx vitest run lib/clickhouse/client.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the server configuration**

```xml
<!-- infra/clickhouse/config.d/keeper.xml -->
<clickhouse>
  <keeper_server>
    <tcp_port>9181</tcp_port>
    <server_id>1</server_id>
    <log_storage_path>/var/lib/clickhouse/coordination/log</log_storage_path>
    <snapshot_storage_path>/var/lib/clickhouse/coordination/snapshots</snapshot_storage_path>
    <coordination_settings>
      <operation_timeout_ms>10000</operation_timeout_ms>
      <session_timeout_ms>30000</session_timeout_ms>
    </coordination_settings>
    <raft_configuration>
      <server><id>1</id><hostname>127.0.0.1</hostname><port>9234</port></server>
    </raft_configuration>
  </keeper_server>
  <zookeeper>
    <node><host>127.0.0.1</host><port>9181</port></node>
  </zookeeper>
</clickhouse>
```

```xml
<!-- infra/clickhouse/config.d/custom-settings.xml -->
<!-- Without this prefix declaration, getSetting('SQL_current_tenant_id') in every
     row policy fails at query time with "Unknown setting". -->
<clickhouse>
  <custom_settings_prefixes>SQL_</custom_settings_prefixes>
</clickhouse>
```

```xml
<!-- infra/clickhouse/users.d/etl.xml -->
<clickhouse>
  <profiles>
    <etl>
      <max_execution_time>300</max_execution_time>
    </etl>
    <tenant>
      <max_execution_time>30</max_execution_time>
      <!-- readonly=2 permits SET of the tenant setting but forbids writes. -->
      <readonly>2</readonly>
      <!-- Fail closed: the zero UUID matches no row, so an unset tenant sees nothing. -->
      <SQL_current_tenant_id>00000000-0000-0000-0000-000000000000</SQL_current_tenant_id>
    </tenant>
  </profiles>
  <users>
    <etl_writer>
      <password from_env="CLICKHOUSE_ETL_PASSWORD"/>
      <networks><ip>::/0</ip></networks>
      <profile>etl</profile>
      <quota>default</quota>
      <access_management>0</access_management>
    </etl_writer>
    <tenant_reader>
      <password from_env="CLICKHOUSE_TENANT_PASSWORD"/>
      <networks><ip>::/0</ip></networks>
      <profile>tenant</profile>
      <quota>default</quota>
      <access_management>0</access_management>
    </tenant_reader>
  </users>
</clickhouse>
```

```yaml
# docker-compose.clickhouse.yml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:25.8
    container_name: gentle-space-clickhouse
    ports:
      - "8123:8123"
      - "9000:9000"
      - "9181:9181"
    environment:
      CLICKHOUSE_ETL_PASSWORD: ${CLICKHOUSE_ETL_PASSWORD:-etl}
      CLICKHOUSE_TENANT_PASSWORD: ${CLICKHOUSE_TENANT_PASSWORD:-tenant}
      CLICKHOUSE_SKIP_USER_SETUP: "1"
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
    volumes:
      - ./infra/clickhouse/config.d:/etc/clickhouse-server/config.d:ro
      - ./infra/clickhouse/users.d:/etc/clickhouse-server/users.d:ro
      - clickhouse_data:/var/lib/clickhouse

volumes:
  clickhouse_data:
```

```sql
-- infra/clickhouse/migrations/000_databases.up.sql
CREATE DATABASE IF NOT EXISTS analytics;
CREATE DATABASE IF NOT EXISTS raw;
```

```sql
-- infra/clickhouse/migrations/000_databases.down.sql
DROP DATABASE IF EXISTS raw;
DROP DATABASE IF EXISTS analytics;
```

- [ ] **Step 8: Bring the server up and verify version, Keeper and the custom-settings prefix**

```bash
docker compose -f docker-compose.clickhouse.yml up -d
sleep 10
curl -s 'http://localhost:8123/' --data-binary 'SELECT version()'
```
Expected: a version string beginning `25.8.` — record the exact value in the commit message.

```bash
echo ruok | nc 127.0.0.1 9181
```
Expected: `imok` — embedded Keeper is answering, which S3Queue requires.

```bash
curl -s -H 'X-ClickHouse-User: tenant_reader' -H 'X-ClickHouse-Key: tenant' \
  'http://localhost:8123/' --data-binary "SELECT getSetting('SQL_current_tenant_id')"
```
Expected: `00000000-0000-0000-0000-000000000000` — the prefix is declared and the fail-closed default is in place. An error mentioning `Unknown setting` means `custom-settings.xml` is not mounted.

- [ ] **Step 9: Apply migration `000` and confirm idempotence**

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl
npx tsx scripts/clickhouse/migrate.ts
```
Expected: `clickhouse: applied 000`

```bash
npx tsx scripts/clickhouse/migrate.ts
```
Expected: `clickhouse: up to date`

- [ ] **Step 10: Commit**

```bash
git add docker-compose.clickhouse.yml infra/clickhouse lib/clickhouse scripts/clickhouse
git commit -m "feat(clickhouse): self-hosted server, HTTP client, and versioned DDL runner

Embedded Keeper (S3Queue needs it), SQL_ custom-settings prefix so row
policies can read the tenant setting, and a fail-closed zero-UUID default
on the tenant profile. Migrations carry local/cloud variants so cloud-only
DDL is never applied to a dev box."
```

## Task 2: `analytics.enquiry_fact` and its row policy

**Skills:** `senior-data-engineer`, `database-optimizer`
**Model:** `composer-2.5-fast` — the DDL and the test are both fully specified below.

**Files:**
- Create: `infra/clickhouse/migrations/001_enquiry_fact.up.sql`
- Create: `infra/clickhouse/migrations/001_enquiry_fact.down.sql`
- Test: `lib/clickhouse/analytics.test.ts`

**Interfaces:**
- Consumes: `chExec`, `chQuery`, `clickhouseConfig`, `applyMigrations` from Task 1.
- Produces: table `analytics.enquiry_fact` with columns `org_id UUID`, `enquiry_id UUID`, `listing_id Nullable(UUID)`, `corridor_id Nullable(UUID)`, `reply_state LowCardinality(String)`, `first_seen_at DateTime64(3)`, `updated_at DateTime64(3)`, `snapshot_id UUID`, `occurred_on Date MATERIALIZED toDate(first_seen_at)`; row policy `enquiry_fact_tenant`.

**Context — one deliberate deviation from data model §7.** The spec writes `ENGINE = MergeTree`. Watermark CDC re-reads any row whose `updated_at` moved, so a plain `MergeTree` accumulates one duplicate per update and reconciliation can never match. `ReplacingMergeTree(updated_at)` with `enquiry_id` inside the sort key makes the pull idempotent, which §14.3 requires of every consumer. All reads use `FINAL`. The spec's `ORDER BY (org_id, occurred_on, enquiry_id)` is kept exactly.

- [ ] **Step 1: Write the failing test**

```ts
// lib/clickhouse/analytics.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { chExec, chQuery, clickhouseConfig } from "./client";
import { applyMigrations } from "./migrate";

const live = Boolean(process.env.CLICKHOUSE_URL);
const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";

describe.skipIf(!live)("analytics.enquiry_fact", () => {
  beforeAll(async () => {
    await applyMigrations();
    await chExec("TRUNCATE TABLE analytics.enquiry_fact");
    await chExec(
      `INSERT INTO analytics.enquiry_fact
         (org_id, enquiry_id, reply_state, first_seen_at, updated_at, snapshot_id)
       VALUES
         ({a:UUID}, generateUUIDv4(), 'waiting', now64(3), now64(3), toUUID('00000000-0000-0000-0000-000000000000')),
         ({b:UUID}, generateUUIDv4(), 'called',  now64(3), now64(3), toUUID('00000000-0000-0000-0000-000000000000'))`,
      { params: { a: ORG_A, b: ORG_B } },
    );
  });

  it("leads its sort key with org_id", async () => {
    const [row] = await chQuery<{ sorting_key: string }>(
      "SELECT sorting_key FROM system.tables WHERE database = 'analytics' AND name = 'enquiry_fact'",
    );
    expect(row.sorting_key.startsWith("org_id")).toBe(true);
  });

  it("deduplicates a re-replicated row rather than doubling it", async () => {
    const id = "cccccccc-0000-4000-8000-000000000003";
    for (const state of ["waiting", "called"]) {
      await chExec(
        `INSERT INTO analytics.enquiry_fact
           (org_id, enquiry_id, reply_state, first_seen_at, updated_at, snapshot_id)
         VALUES ({a:UUID}, {id:UUID}, {s:String}, toDateTime64('2026-08-01 00:00:00.000', 3),
                 now64(3), toUUID('00000000-0000-0000-0000-000000000000'))`,
        { params: { a: ORG_A, id, s: state } },
      );
    }
    const [row] = await chQuery<{ c: string; reply_state: string }>(
      `SELECT count() AS c, any(reply_state) AS reply_state
         FROM analytics.enquiry_fact FINAL WHERE enquiry_id = {id:UUID}`,
      { params: { id } },
    );
    expect(row.c).toBe("1");
    expect(row.reply_state).toBe("called");
  });

  it("hides other tenants' rows from a policy-covered reader", async () => {
    const tenantConfig = {
      ...clickhouseConfig(),
      user: "tenant_reader",
      password: process.env.CLICKHOUSE_TENANT_PASSWORD ?? "tenant",
    };
    const rows = await chQuery<{ org_id: string }>(
      "SELECT DISTINCT org_id FROM analytics.enquiry_fact FINAL",
      { config: tenantConfig, settings: { SQL_current_tenant_id: ORG_A } },
    );
    expect(rows.map((r) => r.org_id)).toEqual([ORG_A]);
  });

  it("shows nothing when the tenant setting is left at its default", async () => {
    const tenantConfig = {
      ...clickhouseConfig(),
      user: "tenant_reader",
      password: process.env.CLICKHOUSE_TENANT_PASSWORD ?? "tenant",
    };
    const rows = await chQuery("SELECT org_id FROM analytics.enquiry_fact FINAL", { config: tenantConfig });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl npx vitest run lib/clickhouse/analytics.test.ts`
Expected: FAIL — `clickhouse 60: ... Table analytics.enquiry_fact does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- infra/clickhouse/migrations/001_enquiry_fact.up.sql
CREATE TABLE IF NOT EXISTS analytics.enquiry_fact
(
  org_id        UUID,
  enquiry_id    UUID,
  listing_id    Nullable(UUID),
  corridor_id   Nullable(UUID),
  reply_state   LowCardinality(String),
  first_seen_at DateTime64(3),
  updated_at    DateTime64(3),
  snapshot_id   UUID,
  occurred_on   Date MATERIALIZED toDate(first_seen_at)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (org_id, occurred_on, enquiry_id);

CREATE ROW POLICY IF NOT EXISTS enquiry_fact_tenant ON analytics.enquiry_fact
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
```

```sql
-- infra/clickhouse/migrations/001_enquiry_fact.down.sql
DROP ROW POLICY IF EXISTS enquiry_fact_tenant ON analytics.enquiry_fact;
DROP TABLE IF EXISTS analytics.enquiry_fact;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl CLICKHOUSE_TENANT_PASSWORD=tenant npx vitest run lib/clickhouse/analytics.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add infra/clickhouse/migrations lib/clickhouse/analytics.test.ts
git commit -m "feat(clickhouse): enquiry_fact mirror with tenant row policy

ReplacingMergeTree(updated_at) rather than the spec's plain MergeTree:
watermark CDC re-reads updated rows, so a non-replacing engine makes
reconciliation permanently unmatchable. Reads use FINAL."
```

## Task 3: CDC — watermark pull from PostgreSQL into ClickHouse

**Skills:** `senior-data-engineer`, `postgres-pro`
**Model:** `inherit` — the watermark/cutoff boundary conditions and the cross-tenant audit obligation need judgement.

**Files:**
- Create: `ads-agent/lib/db/migrations/050_replication_state.up.sql`
- Create: `ads-agent/lib/db/migrations/050_replication_state.down.sql`
- Create: `lib/clickhouse/replicate.ts`
- Create: `scripts/clickhouse/replicate.ts`
- Test: `lib/clickhouse/replicate.test.ts`

**Interfaces:**
- Consumes: `chExec`, `chQuery`, `clickhouseConfig` (Task 1); `analytics.enquiry_fact` (Task 2); `getPool` from `lib/db/client.ts`.
- Produces:
  - `readWatermark(sourceTable: string): Promise<string>` — `'YYYY-MM-DD HH24:MI:SS.MS'`, `'1970-01-01 00:00:00.000'` when unset
  - `writeWatermark(sourceTable: string, watermark: string, rowsCopied: number): Promise<void>`
  - `computeCutoff(toleranceSeconds: number): Promise<string>` — PostgreSQL `now()` minus tolerance, so both sides share one clock
  - `replicateEnquiries(options?: { toleranceSeconds?: number }): Promise<ReplicationResult>` where `ReplicationResult = { table: string; rowsCopied: number; watermark: string }`
  - table `context.replication_state`

**Context — why this transport.** Datastore §10 open question 1 asks PeerDB/ClickPipes versus self-hosted logical replication. Neither is available under "no new dependencies": both are additional services. ClickHouse's built-in `postgresql()` table function pulls directly with no connector and no npm package, and a watermark makes it restartable. It is additive and reversible, which is the property the build sequence claims for S6. Latency is the poll interval, not milliseconds — acceptable because §12.1 already requires lag to be surfaced and acted on rather than assumed to be zero.

- [ ] **Step 1: Write the failing test**

```ts
// lib/clickhouse/replicate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const chExec = vi.fn();
const chQuery = vi.fn();
vi.mock("./client", () => ({
  chExec: (...args: unknown[]) => chExec(...args),
  chQuery: (...args: unknown[]) => chQuery(...args),
  clickhouseConfig: () => ({ url: "http://x:8123", user: "etl_writer", password: "p", target: "local" }),
}));

beforeEach(() => {
  query.mockReset();
  chExec.mockReset().mockResolvedValue(undefined);
  chQuery.mockReset().mockResolvedValue([{ copied: "3" }]);
});

describe("readWatermark", () => {
  it("returns the epoch when no state row exists, so the first run is a full copy", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { readWatermark } = await import("./replicate");
    expect(await readWatermark("adsagent.enquiries")).toBe("1970-01-01 00:00:00.000");
  });
});

describe("replicateEnquiries", () => {
  it("copies the half-open window (watermark, cutoff] and advances the watermark to the cutoff", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ cutoff: "2026-08-12 09:00:00.000" }] })   // computeCutoff
      .mockResolvedValueOnce({ rows: [{ watermark: "2026-08-12 08:00:00.000" }] }) // readWatermark
      .mockResolvedValueOnce({ rows: [] })                                        // access_log
      .mockResolvedValueOnce({ rows: [] });                                       // writeWatermark

    const { replicateEnquiries } = await import("./replicate");
    const result = await replicateEnquiries({ toleranceSeconds: 120 });

    const [sql, options] = chQuery.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(sql).toContain("INSERT INTO analytics.enquiry_fact");
    expect(sql).toContain("postgresql(");
    expect(sql).toContain("updated_at > {watermark:DateTime64(3)}");
    expect(sql).toContain("updated_at <= {cutoff:DateTime64(3)}");
    expect(options.params.watermark).toBe("2026-08-12 08:00:00.000");
    expect(options.params.cutoff).toBe("2026-08-12 09:00:00.000");
    expect(result).toEqual({ table: "adsagent.enquiries", rowsCopied: 3, watermark: "2026-08-12 09:00:00.000" });
  });

  it("audits itself as a cross-tenant actor, because it reads every tenant's rows", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ cutoff: "2026-08-12 09:00:00.000" }] })
      .mockResolvedValueOnce({ rows: [{ watermark: "2026-08-12 08:00:00.000" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { replicateEnquiries } = await import("./replicate");
    await replicateEnquiries();

    const auditCall = query.mock.calls.find(([sql]) => String(sql).includes("context.access_log"));
    expect(auditCall, "replication must write a cross_tenant access_log row").toBeDefined();
    expect(auditCall?.[1]).toContain("cross_tenant");
    expect(auditCall?.[1]).toContain("cdc-replicator");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/clickhouse/replicate.test.ts`
Expected: FAIL — `Failed to resolve import "./replicate"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/050_replication_state.up.sql
BEGIN;

-- Control plane, not a domain table: one row per replicated source table, no org_id.
-- The replicator reads across tenants by design, exactly like the S5a relay, and
-- audits itself in context.access_log with actor_kind = 'cross_tenant'.
CREATE TABLE IF NOT EXISTS context.replication_state (
  source_table   TEXT PRIMARY KEY,
  watermark      TIMESTAMPTZ NOT NULL,
  rows_copied    BIGINT NOT NULL DEFAULT 0,
  last_run_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.replication_state
  ADD COLUMN IF NOT EXISTS last_error TEXT;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/050_replication_state.down.sql
BEGIN;
DROP TABLE IF EXISTS context.replication_state;
COMMIT;
```

- [ ] **Step 4: Apply the migration**

Run: `psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/050_replication_state.up.sql`
Expected:
```
BEGIN
CREATE TABLE
ALTER TABLE
COMMIT
```

- [ ] **Step 5: Write the replicator**

```ts
// lib/clickhouse/replicate.ts
import { getPool } from "../db/client";
import { chQuery, clickhouseConfig } from "./client";

export type ReplicationResult = { table: string; rowsCopied: number; watermark: string };

const SOURCE_TABLE = "adsagent.enquiries";
const EPOCH = "1970-01-01 00:00:00.000";

export async function readWatermark(sourceTable: string): Promise<string> {
  const { rows } = await getPool().query<{ watermark: string }>(
    `SELECT to_char(watermark, 'YYYY-MM-DD HH24:MI:SS.MS') AS watermark
       FROM context.replication_state WHERE source_table = $1`,
    [sourceTable],
  );
  return rows[0]?.watermark ?? EPOCH;
}

export async function writeWatermark(sourceTable: string, watermark: string, rowsCopied: number): Promise<void> {
  await getPool().query(
    `INSERT INTO context.replication_state (source_table, watermark, rows_copied, last_run_at, last_error)
     VALUES ($1, $2::timestamptz, $3, now(), NULL)
     ON CONFLICT (source_table) DO UPDATE
        SET watermark   = EXCLUDED.watermark,
            rows_copied = context.replication_state.rows_copied + EXCLUDED.rows_copied,
            last_run_at = now(),
            last_error  = NULL`,
    [sourceTable, watermark, rowsCopied],
  );
}

// Both bounds come from PostgreSQL's clock. Taking the cutoff from ClickHouse would
// let skew between the two servers silently skip a window of rows.
export async function computeCutoff(toleranceSeconds: number): Promise<string> {
  const { rows } = await getPool().query<{ cutoff: string }>(
    `SELECT to_char(now() - make_interval(secs => $1), 'YYYY-MM-DD HH24:MI:SS.MS') AS cutoff`,
    [toleranceSeconds],
  );
  return rows[0].cutoff;
}

async function auditCrossTenantRead(rowsCopied: number): Promise<void> {
  await getPool().query(
    `INSERT INTO context.access_log (org_id, actor_kind, actor_ref, subject_kind, subject_ref, action)
     VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, 'table', $3, $4)`,
    ["cross_tenant", "cdc-replicator", SOURCE_TABLE, `replicated ${rowsCopied} rows`],
  );
}

function pgConnectionParts(): { hostPort: string; database: string; user: string; password: string } {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = new URL(raw);
  return {
    hostPort: `${url.hostname}:${url.port || "5432"}`,
    database: url.pathname.replace(/^\//, ""),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export async function replicateEnquiries(
  options: { toleranceSeconds?: number } = {},
): Promise<ReplicationResult> {
  const toleranceSeconds = options.toleranceSeconds ?? Number(process.env.RECONCILE_LAG_TOLERANCE_SECONDS ?? "120");
  const cutoff = await computeCutoff(toleranceSeconds);
  const watermark = await readWatermark(SOURCE_TABLE);
  const pg = pgConnectionParts();

  const [row] = await chQuery<{ copied: string }>(
    `INSERT INTO analytics.enquiry_fact
       (org_id, enquiry_id, listing_id, corridor_id, reply_state, first_seen_at, updated_at, snapshot_id)
     SELECT org_id, id, listing_id, corridor_id, reply_state, first_seen_at, updated_at,
            toUUID('00000000-0000-0000-0000-000000000000')
       FROM postgresql({host:String}, {db:String}, 'enquiries', {user:String}, {password:String}, 'adsagent')
      WHERE updated_at > {watermark:DateTime64(3)}
        AND updated_at <= {cutoff:DateTime64(3)}`,
    {
      config: clickhouseConfig(),
      params: {
        host: pg.hostPort,
        db: pg.database,
        user: pg.user,
        password: pg.password,
        watermark,
        cutoff,
      },
      settings: { send_progress_in_http_headers: "0" },
    },
  ).then(async (inserted) => {
    // INSERT ... SELECT returns no rows; count what the window contained so the
    // caller and the state row agree on how much moved.
    void inserted;
    return chQuery<{ copied: string }>(
      `SELECT count() AS copied FROM analytics.enquiry_fact FINAL
        WHERE updated_at > {watermark:DateTime64(3)} AND updated_at <= {cutoff:DateTime64(3)}`,
      { params: { watermark, cutoff } },
    );
  });

  const rowsCopied = Number(row?.copied ?? "0");
  await auditCrossTenantRead(rowsCopied);
  await writeWatermark(SOURCE_TABLE, cutoff, rowsCopied);
  return { table: SOURCE_TABLE, rowsCopied, watermark: cutoff };
}
```

```ts
// scripts/clickhouse/replicate.ts
import { replicateEnquiries } from "../../lib/clickhouse/replicate";

async function main(): Promise<void> {
  const result = await replicateEnquiries();
  console.log(`cdc: ${result.table} -> analytics.enquiry_fact, ${result.rowsCopied} rows, watermark ${result.watermark}`);
}

main().catch((err) => {
  console.error("cdc: replication failed", err);
  process.exit(1);
});
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx vitest run lib/clickhouse/replicate.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run it against the real pair**

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl
npx tsx --env-file=.env.local scripts/clickhouse/replicate.ts
```
Expected: `cdc: adsagent.enquiries -> analytics.enquiry_fact, <n> rows, watermark <timestamp>` where `<n>` equals the number of `adsagent.enquiries` rows older than the tolerance window.

- [ ] **Step 8: Commit**

```bash
git add lib/clickhouse/replicate.ts lib/clickhouse/replicate.test.ts scripts/clickhouse/replicate.ts ads-agent/lib/db/migrations/050_replication_state.up.sql ads-agent/lib/db/migrations/050_replication_state.down.sql
git commit -m "feat(cdc): watermark replication into analytics.enquiry_fact

Pull executed inside ClickHouse via its built-in postgresql() function --
no connector process and no new dependency. Both window bounds come from
PostgreSQL's clock so server skew cannot skip a window. The replicator
audits itself as actor_kind = 'cross_tenant'."
```

## Task 4: Reconciliation and the CDC lag alert

**Skills:** `senior-qa`, `observability-designer`, `senior-data-engineer`
**Model:** `inherit` — the tolerance model and the alert predicate are judgement calls with a false-alarm cost.

**Files:**
- Create: `ads-agent/lib/db/migrations/051_reconciliation_runs.up.sql`
- Create: `ads-agent/lib/db/migrations/051_reconciliation_runs.down.sql`
- Create: `lib/observability/alert.ts`
- Create: `lib/clickhouse/reconcile.ts`
- Create: `scripts/clickhouse/reconcile.ts`
- Test: `lib/clickhouse/reconcile.test.ts`
- Test: `lib/observability/alert.test.ts`

**Interfaces:**
- Consumes: `replicateEnquiries` and `readWatermark` (Task 3); `chQuery` (Task 1).
- Produces:
  - `compareCounts(source: CountRow[], mirror: CountRow[]): Divergence[]` where `CountRow = { org_id: string; occurred_on: string; rows: number }` and `Divergence = { orgId: string; occurredOn: string; sourceRows: number; mirrorRows: number }`
  - `evaluateReport(report: ReconciliationReport, lagAlertSeconds: number): { ok: boolean; alert: string | null }`
  - `reconcileEnquiries(options?: { toleranceSeconds?: number; sampleSize?: number }): Promise<ReconciliationReport>` where `ReconciliationReport = { cutoff: string; lagSeconds: number; divergences: Divergence[]; sampleMismatches: string[] }`
  - `recordReconciliation(report: ReconciliationReport, ok: boolean): Promise<void>`
  - `sendAlert(signal: string, message: string): Promise<void>`
  - table `context.reconciliation_runs`

**Context — what "matches source" has to mean.** A single equality check between two counts proves nothing: rows land continuously, so any snapshot disagrees. The check therefore (a) excludes the last `toleranceSeconds` of writes on both sides, (b) compares counts per `(org_id, occurred_on)` so a divergence localises to a tenant and a day rather than to "somewhere", (c) field-compares up to `sampleSize` sampled rows so a same-count-different-content divergence is caught, and (d) runs repeatedly, recording every run, so a transient pass is distinguishable from a stable one.

- [ ] **Step 1: Write the failing test for the pure comparison logic**

```ts
// lib/clickhouse/reconcile.test.ts
import { describe, it, expect } from "vitest";
import { compareCounts, evaluateReport } from "./reconcile";

describe("compareCounts", () => {
  it("returns nothing when every tenant-day agrees", () => {
    const rows = [
      { org_id: "a", occurred_on: "2026-08-01", rows: 3 },
      { org_id: "b", occurred_on: "2026-08-01", rows: 5 },
    ];
    expect(compareCounts(rows, rows)).toEqual([]);
  });

  it("localises a shortfall to the tenant and the day", () => {
    expect(
      compareCounts(
        [{ org_id: "a", occurred_on: "2026-08-01", rows: 3 }],
        [{ org_id: "a", occurred_on: "2026-08-01", rows: 2 }],
      ),
    ).toEqual([{ orgId: "a", occurredOn: "2026-08-01", sourceRows: 3, mirrorRows: 2 }]);
  });

  it("reports a tenant-day present only in the mirror as a divergence, not as absence", () => {
    expect(compareCounts([], [{ org_id: "b", occurred_on: "2026-08-02", rows: 1 }])).toEqual([
      { orgId: "b", occurredOn: "2026-08-02", sourceRows: 0, mirrorRows: 1 },
    ]);
  });
});

describe("evaluateReport", () => {
  const clean = { cutoff: "2026-08-12 09:00:00.000", lagSeconds: 30, divergences: [], sampleMismatches: [] };

  it("passes a clean report inside the lag threshold", () => {
    expect(evaluateReport(clean, 900)).toEqual({ ok: true, alert: null });
  });

  it("alerts on lag above the threshold even with no divergence", () => {
    const result = evaluateReport({ ...clean, lagSeconds: 1200 }, 900);
    expect(result.ok).toBe(false);
    expect(result.alert).toContain("cdc lag 1200s");
  });

  it("alerts on divergence even when lag is healthy", () => {
    const result = evaluateReport(
      { ...clean, divergences: [{ orgId: "a", occurredOn: "2026-08-01", sourceRows: 3, mirrorRows: 2 }] },
      900,
    );
    expect(result.ok).toBe(false);
    expect(result.alert).toContain("a/2026-08-01 source=3 mirror=2");
  });

  it("alerts on a sampled field mismatch when counts happen to agree", () => {
    const result = evaluateReport({ ...clean, sampleMismatches: ["enquiry 7 reply_state waiting != called"] }, 900);
    expect(result.ok).toBe(false);
    expect(result.alert).toContain("reply_state");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/clickhouse/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "./reconcile"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/051_reconciliation_runs.up.sql
BEGIN;

-- Control plane. One row per reconciliation run so "it matched once" is
-- distinguishable from "it matches".
CREATE TABLE IF NOT EXISTS context.reconciliation_runs (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  source_table  TEXT NOT NULL,
  cutoff_at     TIMESTAMPTZ NOT NULL,
  lag_seconds   INTEGER NOT NULL,
  ok            BOOLEAN NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}',
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_recent_idx
  ON context.reconciliation_runs (source_table, ran_at DESC);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/051_reconciliation_runs.down.sql
BEGIN;
DROP TABLE IF EXISTS context.reconciliation_runs;
COMMIT;
```

Run: `psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/051_reconciliation_runs.up.sql`
Expected:
```
BEGIN
CREATE TABLE
CREATE INDEX
COMMIT
```

- [ ] **Step 4: Write the alert channel**

```ts
// lib/observability/alert.ts
export async function sendAlert(signal: string, message: string): Promise<void> {
  const line = `[alert] ${signal}: ${message}`;
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    console.error(line);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line }),
    });
    if (!res.ok) console.error(`${line} (webhook ${res.status})`);
  } catch (err) {
    // An alert that throws takes down the job it was meant to report on.
    console.error(line, err);
  }
}
```

```ts
// lib/observability/alert.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendAlert } from "./alert";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALERT_WEBHOOK_URL;
});

describe("sendAlert", () => {
  it("posts the signal and message to the webhook", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendAlert("cdc_lag", "cdc lag 1200s");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toBe("[alert] cdc_lag: cdc lag 1200s");
  });

  it("never throws when the webhook is unreachable", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(sendAlert("cdc_lag", "x")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Write the reconciler**

```ts
// lib/clickhouse/reconcile.ts
import { getPool } from "../db/client";
import { sendAlert } from "../observability/alert";
import { chQuery } from "./client";
import { computeCutoff } from "./replicate";

export type CountRow = { org_id: string; occurred_on: string; rows: number };
export type Divergence = { orgId: string; occurredOn: string; sourceRows: number; mirrorRows: number };
export type ReconciliationReport = {
  cutoff: string;
  lagSeconds: number;
  divergences: Divergence[];
  sampleMismatches: string[];
};

const SOURCE_TABLE = "adsagent.enquiries";

export function compareCounts(source: CountRow[], mirror: CountRow[]): Divergence[] {
  const key = (row: CountRow) => `${row.org_id}|${row.occurred_on}`;
  const mirrorByKey = new Map(mirror.map((row) => [key(row), Number(row.rows)]));
  const divergences: Divergence[] = [];

  for (const row of source) {
    const mirrorRows = mirrorByKey.get(key(row)) ?? 0;
    if (Number(row.rows) !== mirrorRows) {
      divergences.push({
        orgId: row.org_id,
        occurredOn: row.occurred_on,
        sourceRows: Number(row.rows),
        mirrorRows,
      });
    }
    mirrorByKey.delete(key(row));
  }
  for (const [remaining, mirrorRows] of mirrorByKey) {
    const [orgId, occurredOn] = remaining.split("|");
    divergences.push({ orgId, occurredOn, sourceRows: 0, mirrorRows });
  }
  return divergences;
}

export function evaluateReport(
  report: ReconciliationReport,
  lagAlertSeconds: number,
): { ok: boolean; alert: string | null } {
  const problems: string[] = [];
  if (report.lagSeconds > lagAlertSeconds) {
    problems.push(`cdc lag ${report.lagSeconds}s exceeds ${lagAlertSeconds}s`);
  }
  for (const d of report.divergences) {
    problems.push(`${d.orgId}/${d.occurredOn} source=${d.sourceRows} mirror=${d.mirrorRows}`);
  }
  problems.push(...report.sampleMismatches);
  return problems.length === 0 ? { ok: true, alert: null } : { ok: false, alert: problems.join("; ") };
}

export async function reconcileEnquiries(
  options: { toleranceSeconds?: number; sampleSize?: number } = {},
): Promise<ReconciliationReport> {
  const toleranceSeconds = options.toleranceSeconds ?? Number(process.env.RECONCILE_LAG_TOLERANCE_SECONDS ?? "120");
  const sampleSize = options.sampleSize ?? 50;
  const cutoff = await computeCutoff(toleranceSeconds);

  const source = await getPool().query<CountRow>(
    `SELECT org_id::text AS org_id, to_char(first_seen_at::date, 'YYYY-MM-DD') AS occurred_on, count(*)::int AS rows
       FROM adsagent.enquiries
      WHERE updated_at <= $1::timestamptz
      GROUP BY 1, 2`,
    [cutoff],
  );

  const mirror = await chQuery<CountRow>(
    `SELECT toString(org_id) AS org_id, toString(occurred_on) AS occurred_on, toUInt32(count()) AS rows
       FROM analytics.enquiry_fact FINAL
      WHERE updated_at <= {cutoff:DateTime64(3)}
      GROUP BY 1, 2`,
    { params: { cutoff } },
  );

  const { rows: lagRows } = await getPool().query<{ source_max: string | null }>(
    `SELECT to_char(max(updated_at), 'YYYY-MM-DD HH24:MI:SS.MS') AS source_max FROM adsagent.enquiries`,
  );
  const [mirrorMax] = await chQuery<{ mirror_max: string }>(
    `SELECT formatDateTime(max(updated_at), '%Y-%m-%d %H:%i:%S') AS mirror_max FROM analytics.enquiry_fact FINAL`,
  );
  const sourceMs = lagRows[0].source_max ? Date.parse(`${lagRows[0].source_max}Z`) : 0;
  const mirrorMs = mirrorMax?.mirror_max ? Date.parse(`${mirrorMax.mirror_max}Z`) : 0;
  const lagSeconds = sourceMs === 0 ? 0 : Math.max(0, Math.round((sourceMs - mirrorMs) / 1000));

  const sample = await getPool().query<{ id: string; reply_state: string }>(
    `SELECT id::text AS id, reply_state FROM adsagent.enquiries
      WHERE updated_at <= $1::timestamptz ORDER BY id LIMIT $2`,
    [cutoff, sampleSize],
  );
  const sampleMismatches: string[] = [];
  if (sample.rows.length > 0) {
    const mirrored = await chQuery<{ enquiry_id: string; reply_state: string }>(
      `SELECT toString(enquiry_id) AS enquiry_id, reply_state FROM analytics.enquiry_fact FINAL
        WHERE enquiry_id IN ({ids:Array(UUID)})`,
      { params: { ids: JSON.stringify(sample.rows.map((r) => r.id)) } },
    );
    const mirroredById = new Map(mirrored.map((r) => [r.enquiry_id, r.reply_state]));
    for (const row of sample.rows) {
      const mirrorState = mirroredById.get(row.id);
      if (mirrorState === undefined) {
        sampleMismatches.push(`enquiry ${row.id} missing from mirror`);
      } else if (mirrorState !== row.reply_state) {
        sampleMismatches.push(`enquiry ${row.id} reply_state ${row.reply_state} != ${mirrorState}`);
      }
    }
  }

  return { cutoff, lagSeconds, divergences: compareCounts(source.rows, mirror), sampleMismatches };
}

export async function recordReconciliation(report: ReconciliationReport, ok: boolean): Promise<void> {
  await getPool().query(
    `INSERT INTO context.reconciliation_runs (source_table, cutoff_at, lag_seconds, ok, detail)
     VALUES ($1, $2::timestamptz, $3, $4, $5::jsonb)`,
    [
      SOURCE_TABLE,
      report.cutoff,
      report.lagSeconds,
      ok,
      JSON.stringify({ divergences: report.divergences, sampleMismatches: report.sampleMismatches }),
    ],
  );
}

export async function runReconciliation(): Promise<boolean> {
  const report = await reconcileEnquiries();
  const { ok, alert } = evaluateReport(report, Number(process.env.CDC_LAG_ALERT_SECONDS ?? "900"));
  await recordReconciliation(report, ok);
  if (alert) await sendAlert("cdc_reconciliation", alert);
  console.log(`reconcile: ok=${ok} lag=${report.lagSeconds}s divergences=${report.divergences.length}`);
  return ok;
}
```

```ts
// scripts/clickhouse/reconcile.ts
import { runReconciliation } from "../../lib/clickhouse/reconcile";

function argValue(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const repeat = argValue("--repeat", 1);
  const intervalSeconds = argValue("--interval", 300);
  let allOk = true;
  for (let run = 1; run <= repeat; run += 1) {
    const ok = await runReconciliation();
    allOk = allOk && ok;
    if (run < repeat) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("reconcile: failed", err);
  process.exit(1);
});
```

- [ ] **Step 6: Run both tests and watch them pass**

Run: `npx vitest run lib/clickhouse/reconcile.test.ts lib/observability/alert.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Prove the alert fires by holding replication back**

```bash
psql "$DATABASE_URL" -c "UPDATE context.replication_state SET watermark = now() - interval '2 days' WHERE source_table = 'adsagent.enquiries'"
psql "$DATABASE_URL" -c "UPDATE adsagent.enquiries SET updated_at = now() WHERE id = (SELECT id FROM adsagent.enquiries LIMIT 1)"
CDC_LAG_ALERT_SECONDS=60 npx tsx --env-file=.env.local scripts/clickhouse/reconcile.ts
```
Expected: stderr contains `[alert] cdc_reconciliation: cdc lag` and the process exits `1`.

```bash
npx tsx --env-file=.env.local scripts/clickhouse/replicate.ts
npx tsx --env-file=.env.local scripts/clickhouse/reconcile.ts
```
Expected: `reconcile: ok=true lag=<small>s divergences=0`, exit `0`.

- [ ] **Step 8: Record the schedule**

Append to `infra/clickhouse/README.md` (create it):

```markdown
# ClickHouse operations

Two cron entries. Cron is a clock; it finds work and runs the job, and the job
publishes or alerts (datastore §14.5).

    */2 * * * * cd /opt/gentle-space-web && npx tsx --env-file=.env.local scripts/clickhouse/replicate.ts
    */5 * * * * cd /opt/gentle-space-web && npx tsx --env-file=.env.local scripts/clickhouse/reconcile.ts

Signals and their one alert each (datastore §12.4):

| Signal | Alert when | Source |
|---|---|---|
| CDC lag | `lag_seconds > CDC_LAG_ALERT_SECONDS` (default 900) | `context.reconciliation_runs` |
| Mirror divergence | any row with `ok = false` | `context.reconciliation_runs` |
| Ingest rejections | rejection rate above the accepted rate for an org | `context.ingest_rejection_counters` |
| Cross-tenant reads | any `context.access_log` row with `actor_kind = 'cross_tenant'` and `actor_ref` not in (`cdc-replicator`, `outbox-relay`) | `context.access_log` |
```

- [ ] **Step 9: Commit**

```bash
git add lib/clickhouse/reconcile.ts lib/clickhouse/reconcile.test.ts lib/observability scripts/clickhouse/reconcile.ts infra/clickhouse/README.md ads-agent/lib/db/migrations/051_*
git commit -m "feat(cdc): per-tenant-day reconciliation with lag alert

Counts compared per (org_id, occurred_on) so a divergence localises, plus a
50-row field sample so equal counts with unequal content are still caught.
Every run is recorded, so 'it matched once' cannot be mistaken for 'it matches'."
```

## Task 5 (fan-in): S6 gate

**Skills:** `senior-qa`, `tdd-guide`
**Model:** `inherit` — the gate has to be judged, not just executed.

**Files:**
- Test: `lib/clickhouse/s6-gate.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing importable; a passing gate.

- [ ] **Step 1: Merge the W3 and W4 branches for S6**

```bash
git checkout main && git merge --no-ff s6/cdc-replication s6/reconciliation
npx vitest run lib/clickhouse
```
Expected: all ClickHouse tests green.

- [ ] **Step 2: Write the gate test**

```ts
// lib/clickhouse/s6-gate.test.ts
import { describe, it, expect } from "vitest";
import { getPool } from "../db/client";
import { replicateEnquiries } from "./replicate";
import { reconcileEnquiries, evaluateReport } from "./reconcile";

const live = Boolean(process.env.CLICKHOUSE_URL && process.env.TEST_DATABASE_URL);

describe.skipIf(!live)("S6 gate: replicated data matches source", () => {
  it("matches after a fresh insert is replicated, and stays matched across three runs", async () => {
    const org = (
      await getPool().query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")
    ).rows[0].id;

    await getPool().query(
      `INSERT INTO adsagent.enquiries (org_id, reply_state, first_seen_at, last_activity_at, updated_at)
       VALUES ($1, 'waiting', now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '10 minutes')`,
      [org],
    );

    await replicateEnquiries({ toleranceSeconds: 5 });

    for (let run = 0; run < 3; run += 1) {
      const report = await reconcileEnquiries({ toleranceSeconds: 5 });
      const verdict = evaluateReport(report, 900);
      expect(verdict.alert, `run ${run + 1}`).toBeNull();
      expect(verdict.ok).toBe(true);
    }
  }, 60_000);

  it("every ClickHouse table carrying org_id leads its sort key with it", async () => {
    const { chQuery } = await import("./client");
    const rows = await chQuery<{ name: string }>(
      `SELECT concat(database, '.', name) AS name FROM system.tables
        WHERE database IN ('analytics', 'raw')
          AND engine LIKE '%MergeTree'
          AND position(sorting_key, 'org_id') != 1`,
    );
    expect(rows).toEqual([]);
  });

  it("every ClickHouse fact table has a row policy", async () => {
    const { chQuery } = await import("./client");
    const rows = await chQuery<{ name: string }>(
      `SELECT concat(t.database, '.', t.name) AS name FROM system.tables t
        LEFT JOIN system.row_policies p ON p.database = t.database AND p.table = t.name
        WHERE t.database IN ('analytics', 'raw') AND t.engine LIKE '%MergeTree' AND p.name IS NULL`,
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the gate**

Run: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/clickhouse/s6-gate.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Run both full suites**

Run: `npx vitest run` (repo root), then `cd ads-agent && npx vitest run`
Expected: green in both.

- [ ] **Step 5: Commit**

```bash
git add lib/clickhouse/s6-gate.test.ts
git commit -m "test(s6): gate -- replicated data matches source across three runs"
```

**S6 gate:** reconciliation clean three consecutive times with a stated tolerance, the lag alert demonstrably fires when lag is forced, every ClickHouse MergeTree table leads its sort key with `org_id` and carries a row policy. Stop and confirm before S6a's cluster-touching tasks.

---

# S6a — Portal ingestion and consent

Gate: **an event from a broker's site reaches ClickHouse, and a withdrawn consent stops it within seconds** — the second half measured, not asserted from a flag.

## Task 6: Consent and portal-configuration schema

**Skills:** `postgres-pro`, `gdpr-dsgvo-expert`, `database-designer`
**Model:** `inherit` — immutability, the retention floor, and the notify contract carry compliance weight.

**Files:**
- Create: `ads-agent/lib/db/migrations/052_consent_purposes.up.sql` / `.down.sql`
- Create: `ads-agent/lib/db/migrations/053_tenant_portal_config.up.sql` / `.down.sql`
- Create: `ads-agent/lib/db/migrations/054_consent_records.up.sql` / `.down.sql`
- Create: `ads-agent/lib/db/migrations/055_purpose_retention.up.sql` / `.down.sql`
- Test: `ads-agent/lib/portal/consent-schema.test.ts`

**Interfaces:**
- Consumes: `public.orgs`, `public.org_ref`, `public.current_tenant()` from S3.
- Produces: tables `context.consent_purposes`, `context.tenant_portal_config`, `context.consent_records`, `context.purpose_retention`; trigger functions `context.reject_consent_mutation()` and `context.notify_consent_change()`; NOTIFY channel `consent_changed` with payload `"<org_id>:<subject_ref>"`.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/portal/consent-schema.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

const live = Boolean(process.env.TEST_DATABASE_URL);
let pool: Pool;
let orgId: string;

beforeAll(async () => {
  if (!live) return;
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
  orgId = (await pool.query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")).rows[0].id;
});

afterAll(async () => {
  if (live) await pool.end();
});

describe.skipIf(!live)("consent schema", () => {
  it("seeds exactly the three catalogue purposes", async () => {
    const { rows } = await pool.query<{ code: string }>("SELECT code FROM context.consent_purposes ORDER BY code");
    expect(rows.map((r) => r.code)).toEqual(["enquiry_handling", "site_analytics", "space_recommendation"]);
  });

  it("refuses a consent record naming a purpose outside the catalogue", async () => {
    await expect(
      pool.query(
        `INSERT INTO context.consent_records (org_id, subject_ref, purposes, action, notice_version, mechanism)
         VALUES ($1, 'sess-1', ARRAY['whatever_we_feel_like'], 'granted', 1, 'banner')`,
        [orgId],
      ),
    ).rejects.toThrow(/consent_records_purposes_in_catalogue|violates check constraint/);
  });

  it("is append-only: UPDATE and DELETE both raise", async () => {
    await pool.query(
      `INSERT INTO context.consent_records (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, 'sess-immutable', ARRAY['site_analytics'], 'granted', 1, 'banner')`,
      [orgId],
    );
    await expect(
      pool.query("UPDATE context.consent_records SET action = 'withdrawn' WHERE subject_ref = 'sess-immutable'"),
    ).rejects.toThrow("append-only");
    await expect(
      pool.query("DELETE FROM context.consent_records WHERE subject_ref = 'sess-immutable'"),
    ).rejects.toThrow("append-only");
  });

  it("emits consent_changed on insert, carrying org and subject", async () => {
    const listener = await pool.connect();
    const received: string[] = [];
    listener.on("notification", (msg) => { if (msg.payload) received.push(msg.payload); });
    await listener.query("LISTEN consent_changed");

    await pool.query(
      `INSERT INTO context.consent_records (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, 'sess-notify', ARRAY['space_recommendation'], 'granted', 1, 'banner')`,
      [orgId],
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    listener.release();

    expect(received).toContain(`${orgId}:sess-notify`);
  });

  it("forces row level security on every new context table", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relkind = 'r'
          AND c.relname IN ('tenant_portal_config','consent_records')
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });

  it("gives every catalogue purpose a retention window", async () => {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT p.code FROM context.consent_purposes p
         LEFT JOIN context.purpose_retention r ON r.purpose = p.code
        WHERE r.purpose IS NULL`,
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/portal/consent-schema.test.ts`
Expected: FAIL — `relation "context.consent_purposes" does not exist`.

- [ ] **Step 3: Write migration 052 — the fixed purpose catalogue**

```sql
-- ads-agent/lib/db/migrations/052_consent_purposes.up.sql
BEGIN;

-- The catalogue is fixed by us, never by the broker: an event type maps to exactly
-- one purpose so the ingestion gate can decide mechanically. Reference data, shared
-- across tenants, therefore no org_id and no RLS (same shape as public.corridors).
CREATE TABLE IF NOT EXISTS context.consent_purposes (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

INSERT INTO context.consent_purposes (code, description) VALUES
  ('site_analytics',       'Aggregate page and traffic analytics for the broker''s own site'),
  ('space_recommendation', 'Recommending spaces based on browsing, searching and shortlisting'),
  ('enquiry_handling',     'Responding to and working an enquiry the visitor submitted')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/052_consent_purposes.down.sql
BEGIN;
DROP TABLE IF EXISTS context.consent_purposes;
COMMIT;
```

- [ ] **Step 4: Write migration 053 — per-tenant portal configuration**

```sql
-- ads-agent/lib/db/migrations/053_tenant_portal_config.up.sql
BEGIN;

CREATE TABLE IF NOT EXISTS context.tenant_portal_config (
  org_id           public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  ingest_key       TEXT NOT NULL UNIQUE,        -- public identifier, embedded in a page, not a secret
  allowed_origins  TEXT[] NOT NULL DEFAULT '{}',
  purposes_offered TEXT[] NOT NULL DEFAULT '{}',
  notice_version   INTEGER NOT NULL DEFAULT 1,
  notice_copy      JSONB NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expressed as ALTER: a constraint written inside the CREATE TABLE body above never
-- reaches a database where the table already exists.
ALTER TABLE context.tenant_portal_config
  DROP CONSTRAINT IF EXISTS tenant_portal_config_purposes_in_catalogue;
ALTER TABLE context.tenant_portal_config
  ADD CONSTRAINT tenant_portal_config_purposes_in_catalogue CHECK (
    purposes_offered <@ ARRAY['site_analytics','space_recommendation','enquiry_handling']::TEXT[]
  );

ALTER TABLE context.tenant_portal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.tenant_portal_config FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.tenant_portal_config;
CREATE POLICY tenant_isolation ON context.tenant_portal_config
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The ingest edge resolves an unauthenticated public key to a tenant, so it must read
-- this table before any tenant context exists. That single lookup runs as the
-- platform-scope role and is the only cross-tenant read of this table.
DROP POLICY IF EXISTS ingest_key_lookup ON context.tenant_portal_config;
CREATE POLICY ingest_key_lookup ON context.tenant_portal_config
  FOR SELECT TO adsagent_rw
  USING (public.current_tenant() IS NULL);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/053_tenant_portal_config.down.sql
BEGIN;
DROP POLICY IF EXISTS ingest_key_lookup ON context.tenant_portal_config;
DROP POLICY IF EXISTS tenant_isolation ON context.tenant_portal_config;
DROP TABLE IF EXISTS context.tenant_portal_config;
COMMIT;
```

- [ ] **Step 5: Write migration 054 — immutable consent records with a notify trigger**

```sql
-- ads-agent/lib/db/migrations/054_consent_records.up.sql
BEGIN;

CREATE TABLE IF NOT EXISTS context.consent_records (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  subject_ref    TEXT NOT NULL,               -- session id, or enquiry id once linked
  purposes       TEXT[] NOT NULL,
  action         TEXT NOT NULL,
  notice_version INTEGER NOT NULL,
  mechanism      TEXT NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.consent_records DROP CONSTRAINT IF EXISTS consent_records_action_check;
ALTER TABLE context.consent_records
  ADD CONSTRAINT consent_records_action_check CHECK (action IN ('granted','withdrawn'));

ALTER TABLE context.consent_records DROP CONSTRAINT IF EXISTS consent_records_mechanism_check;
ALTER TABLE context.consent_records
  ADD CONSTRAINT consent_records_mechanism_check CHECK (mechanism IN ('banner','form','consent_manager'));

ALTER TABLE context.consent_records DROP CONSTRAINT IF EXISTS consent_records_purposes_in_catalogue;
ALTER TABLE context.consent_records
  ADD CONSTRAINT consent_records_purposes_in_catalogue CHECK (
    cardinality(purposes) > 0
    AND purposes <@ ARRAY['site_analytics','space_recommendation','enquiry_handling']::TEXT[]
  );

CREATE INDEX IF NOT EXISTS consent_records_lookup_idx
  ON context.consent_records (org_id, subject_ref, occurred_at DESC);

ALTER TABLE context.consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.consent_records FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.consent_records;
CREATE POLICY tenant_isolation ON context.consent_records
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Withdrawal is a new row, never an update: you must be able to show what was true
-- at the moment an event was collected. Consent records also survive the erasure of
-- the data they authorised (Rule 8(3)), so there is no legitimate DELETE either.
CREATE OR REPLACE FUNCTION context.reject_consent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'context.consent_records is append-only; record a withdrawal instead';
END;
$$;

DROP TRIGGER IF EXISTS consent_records_append_only ON context.consent_records;
CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE OR DELETE ON context.consent_records
  FOR EACH ROW EXECUTE FUNCTION context.reject_consent_mutation();

-- A withdrawal must take effect in seconds, not at the next cache expiry. The
-- notification is delivered on commit, so no listener can act on an uncommitted row.
CREATE OR REPLACE FUNCTION context.notify_consent_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('consent_changed', NEW.org_id::text || ':' || NEW.subject_ref);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consent_records_notify ON context.consent_records;
CREATE TRIGGER consent_records_notify
  AFTER INSERT ON context.consent_records
  FOR EACH ROW EXECUTE FUNCTION context.notify_consent_change();

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/054_consent_records.down.sql
BEGIN;
DROP TRIGGER IF EXISTS consent_records_notify ON context.consent_records;
DROP TRIGGER IF EXISTS consent_records_append_only ON context.consent_records;
DROP FUNCTION IF EXISTS context.notify_consent_change();
DROP FUNCTION IF EXISTS context.reject_consent_mutation();
DROP POLICY IF EXISTS tenant_isolation ON context.consent_records;
DROP TABLE IF EXISTS context.consent_records;
COMMIT;
```

- [ ] **Step 6: Write migration 055 — retention window per purpose**

```sql
-- ads-agent/lib/db/migrations/055_purpose_retention.up.sql
BEGIN;

-- Purpose limitation cuts both ways: data kept beyond its stated purpose is unlawful
-- regardless of consent. These are configuration rows, tunable without a migration.
-- Portal spec §10 open question 3 (what is defensible per purpose, against the Rule
-- 8(3) one-year floor) is unresolved by the sources; these are the starting values.
CREATE TABLE IF NOT EXISTS context.purpose_retention (
  purpose        TEXT PRIMARY KEY REFERENCES context.consent_purposes(code),
  retention_days INTEGER NOT NULL,
  rationale      TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.purpose_retention DROP CONSTRAINT IF EXISTS purpose_retention_days_positive;
ALTER TABLE context.purpose_retention
  ADD CONSTRAINT purpose_retention_days_positive CHECK (retention_days BETWEEN 1 AND 3650);

INSERT INTO context.purpose_retention (purpose, retention_days, rationale) VALUES
  ('site_analytics',       90,  'Weakest purpose in the catalogue; the product does not need it'),
  ('space_recommendation', 180, 'Two quarters of browsing is enough to recommend against'),
  ('enquiry_handling',     365, 'Rule 8(3) retention floor applies once a session is linked to an enquiry')
ON CONFLICT (purpose) DO UPDATE
  SET retention_days = EXCLUDED.retention_days, rationale = EXCLUDED.rationale, updated_at = now();

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/055_purpose_retention.down.sql
BEGIN;
DROP TABLE IF EXISTS context.purpose_retention;
COMMIT;
```

- [ ] **Step 7: Apply all four and run the test**

```bash
for n in 052_consent_purposes 053_tenant_portal_config 054_consent_records 055_purpose_retention; do
  psql "$DATABASE_URL" -f "ads-agent/lib/db/migrations/${n}.up.sql"
done
```
Expected: each file ends with `COMMIT` and no `ERROR` line.

Run: `cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/portal/consent-schema.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Verify every down migration reverses**

```bash
for n in 055_purpose_retention 054_consent_records 053_tenant_portal_config 052_consent_purposes; do
  psql "$DATABASE_URL" -f "ads-agent/lib/db/migrations/${n}.down.sql"
done
psql "$DATABASE_URL" -c "\dt context.*"
```
Expected: none of `consent_purposes`, `tenant_portal_config`, `consent_records`, `purpose_retention` listed. Re-apply the four up migrations before continuing.

- [ ] **Step 9: Commit**

```bash
git add ads-agent/lib/db/migrations/05[2-5]_* ads-agent/lib/portal/consent-schema.test.ts
git commit -m "feat(consent): fixed purpose catalogue, portal config, immutable consent log

Consent records are append-only in the database, not by convention: UPDATE
and DELETE both raise. An AFTER INSERT trigger publishes consent_changed on
commit so withdrawal can take effect in seconds rather than at cache expiry."
```

## Task 7: The versioned event taxonomy

**Skills:** `typescript-pro`, `api-designer`
**Model:** `composer-2.5-fast` — the taxonomy and its tests are fully specified below.

**Files:**
- Create: `ads-agent/lib/portal/taxonomy.ts`
- Test: `ads-agent/lib/portal/taxonomy.test.ts`

**Interfaces:**
- Consumes: `zod` (already a dependency of `ads-agent`).
- Produces:
  - `TAXONOMY_VERSION = 1`
  - `PURPOSES: readonly ["site_analytics","space_recommendation","enquiry_handling"]`, `type Purpose`
  - `EVENT_NAMES: readonly [...]`, `type EventName`
  - `EVENT_PURPOSE: Record<EventName, Purpose>`
  - `purposeFor(event: EventName): Purpose`
  - `envelopeSchema` — zod schema for the request body, and `type PortalEnvelope = z.infer<typeof envelopeSchema>`
  - `MAX_BODY_BYTES = 8192`, `MAX_EVENTS_PER_REQUEST = 20`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/portal/taxonomy.test.ts
import { describe, it, expect } from "vitest";
import {
  EVENT_NAMES, EVENT_PURPOSE, MAX_EVENTS_PER_REQUEST, TAXONOMY_VERSION,
  envelopeSchema, purposeFor,
} from "./taxonomy";

const envelope = (overrides: Record<string, unknown> = {}) => ({
  taxonomy_version: TAXONOMY_VERSION,
  session_id: "abcdefabcdefabcdef01",
  events: [{ event: "page_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: { path: "/spaces", referrer: "" } }],
  ...overrides,
});

describe("taxonomy", () => {
  it("covers exactly the seven events in portal spec §6", () => {
    expect([...EVENT_NAMES].sort()).toEqual([
      "contact_revealed", "enquiry_submitted", "filter_applied",
      "listing_view", "page_view", "search_performed", "shortlist_added",
    ]);
  });

  it("maps every event to exactly one purpose", () => {
    for (const name of EVENT_NAMES) expect(EVENT_PURPOSE[name]).toBeTypeOf("string");
    expect(purposeFor("search_performed")).toBe("space_recommendation");
    expect(purposeFor("contact_revealed")).toBe("enquiry_handling");
    expect(purposeFor("page_view")).toBe("site_analytics");
  });

  it("accepts a well-formed envelope", () => {
    expect(envelopeSchema.safeParse(envelope()).success).toBe(true);
  });

  it("rejects an unknown event name, because a purpose cannot be stated for an undefined payload", () => {
    const result = envelopeSchema.safeParse(
      envelope({ events: [{ event: "scroll_depth", occurred_at: "2026-08-12T09:00:00.000Z", payload: {} }] }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing a required field for its event", () => {
    const result = envelopeSchema.safeParse(
      envelope({ events: [{ event: "listing_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: {} }] }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a taxonomy version it does not implement", () => {
    expect(envelopeSchema.safeParse(envelope({ taxonomy_version: 2 })).success).toBe(false);
  });

  it("rejects a session id shaped like an email or a phone number", () => {
    expect(envelopeSchema.safeParse(envelope({ session_id: "visitor@example.com" })).success).toBe(false);
    expect(envelopeSchema.safeParse(envelope({ session_id: "919876543210xxxxxxxx" })).success).toBe(false);
  });

  it("caps the number of events per request", () => {
    const one = envelope().events[0];
    const tooMany = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => one);
    expect(envelopeSchema.safeParse(envelope({ events: tooMany })).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/portal/taxonomy.test.ts`
Expected: FAIL — `Failed to resolve import "./taxonomy"`.

- [ ] **Step 3: Write the taxonomy**

```ts
// ads-agent/lib/portal/taxonomy.ts
import { z } from "zod";

/**
 * Fixed and versioned, one purpose per event (portal spec §6, decision PI4).
 * Arbitrary event shapes make purpose limitation unenforceable: you cannot state a
 * purpose for a payload you have not defined. A version bump requires a new notice,
 * because the notice itemises what is collected.
 */
export const TAXONOMY_VERSION = 1;

export const PURPOSES = ["site_analytics", "space_recommendation", "enquiry_handling"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const EVENT_NAMES = [
  "page_view",
  "listing_view",
  "search_performed",
  "filter_applied",
  "shortlist_added",
  "contact_revealed",
  "enquiry_submitted",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const EVENT_PURPOSE: Record<EventName, Purpose> = {
  page_view: "site_analytics",
  listing_view: "space_recommendation",
  search_performed: "space_recommendation",
  filter_applied: "space_recommendation",
  shortlist_added: "space_recommendation",
  contact_revealed: "enquiry_handling",
  enquiry_submitted: "enquiry_handling",
};

export function purposeFor(event: EventName): Purpose {
  return EVENT_PURPOSE[event];
}

export const MAX_BODY_BYTES = 8192;
export const MAX_EVENTS_PER_REQUEST = 20;

const EMAIL_SHAPE = /@/;
const PHONE_SHAPE = /\d{10}/;

// A session id containing a phone number or an email makes every "pseudonymous"
// claim in §5 false on arrival, so the shape is enforced rather than trusted.
const sessionId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/)
  .refine((v) => !EMAIL_SHAPE.test(v) && !PHONE_SHAPE.test(v), {
    message: "session_id must be opaque: no email or phone-shaped content",
  });

const shortText = z.string().max(200);
const filters = z.record(z.string().max(64), z.string().max(200)).refine(
  (value) => Object.keys(value).length <= 20,
  { message: "at most 20 filters" },
);

const event = <N extends EventName, P extends z.ZodTypeAny>(name: N, payload: P) =>
  z.object({
    event: z.literal(name),
    occurred_at: z.string().datetime(),
    payload,
  });

const eventSchema = z.discriminatedUnion("event", [
  event("page_view", z.object({ path: shortText, referrer: shortText })),
  event("listing_view", z.object({ listing_ref: shortText, dwell_seconds: z.number().int().min(0).max(86_400) })),
  event("search_performed", z.object({ query: z.string().max(500), filters, result_count: z.number().int().min(0) })),
  event("filter_applied", z.object({ filters })),
  event("shortlist_added", z.object({ listing_ref: shortText })),
  event("contact_revealed", z.object({ listing_ref: shortText, channel: z.enum(["phone", "email", "whatsapp"]) })),
  event("enquiry_submitted", z.object({ enquiry_ref: z.string().uuid() })),
]);

export const envelopeSchema = z.object({
  taxonomy_version: z.literal(TAXONOMY_VERSION),
  session_id: sessionId,
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
});

export type PortalEnvelope = z.infer<typeof envelopeSchema>;
export type PortalEvent = z.infer<typeof eventSchema>;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/portal/taxonomy.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/portal/taxonomy.ts ads-agent/lib/portal/taxonomy.test.ts
git commit -m "feat(portal): fixed versioned event taxonomy, one purpose per event

Seven events, three purposes, closed payload schemas. The session id is
required to be opaque -- an id carrying an email or a phone number makes the
pseudonymity claim in portal spec §5 false the moment it arrives."
```

## Task 8: GCS raw-events bucket, IAM, and the Pub/Sub export subscription

**Skills:** `gcp-cloud-architect`, `senior-devops`, `security-engineer`
**Model:** `inherit` — IAM scoping and the service-agent grant have to be reasoned about against live output.

**Files:**
- Create: `infra/gcs/raw-events-lifecycle.json`
- Create: `infra/gcs/create-raw-events-bucket.sh`
- Create: `infra/pubsub/create-gcs-export-subscription.sh`
- Create: `infra/gcs/README.md`

**Interfaces:**
- Consumes: the `portal.event` Pub/Sub topic created by S5a.
- Produces: bucket `gs://gs-portal-raw-events-prod`; service account `portal-raw-ingest@propane-galaxy-498403-n8.iam.gserviceaccount.com`; an HMAC key pair exported as `GCS_HMAC_ACCESS_ID` / `GCS_HMAC_SECRET` for Task 9's cloud-variant DDL; subscription `portal-event-gcs-export`.

**Context.** The raw bucket is **transport, not an archive**, and is deliberately separate from the DuckDB snapshot bucket: snapshots use per-tenant prefixes with scoped service accounts (§12.3), while S3Queue authenticates with HMAC keys against the S3-compatible endpoint. Mixing them would let the coarser credential reach snapshot data. Files are deleted after ingest; the lifecycle rule is the backstop for anything not yet ingested and is what bounds erasure exposure to roughly one batch interval.

- [ ] **Step 1: Write the lifecycle rule**

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": { "age": 1 }
      }
    ]
  }
}
```

- [ ] **Step 2: Write the bucket script**

```bash
#!/usr/bin/env bash
# infra/gcs/create-raw-events-bucket.sh
# Creates the raw portal-event transport bucket, its writer service account, and the
# HMAC key S3Queue needs. Idempotent: safe to re-run.
set -euo pipefail

PROJECT="${GCP_PROJECT:-propane-galaxy-498403-n8}"
BUCKET="${GCS_RAW_EVENTS_BUCKET:-gs-portal-raw-events-prod}"
LOCATION="${GCP_LOCATION:-asia-south1}"
SA="portal-raw-ingest@${PROJECT}.iam.gserviceaccount.com"

gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${LOCATION}" \
    --uniform-bucket-level-access \
    --public-access-prevention

gcloud storage buckets update "gs://${BUCKET}" \
  --project="${PROJECT}" \
  --lifecycle-file=infra/gcs/raw-events-lifecycle.json

gcloud iam service-accounts describe "${SA}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create portal-raw-ingest \
    --project="${PROJECT}" \
    --display-name="Portal raw event ingest (ClickHouse S3Queue)"

# Scoped to this bucket only, never project-wide. S3Queue deletes files after
# processing, so it needs objectAdmin rather than objectViewer.
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --project="${PROJECT}" \
  --member="serviceAccount:${SA}" \
  --role="roles/storage.objectAdmin"

# The Pub/Sub service agent is the writer of the exported batches.
PUBSUB_AGENT="$(gcloud storage service-agent --project="${PROJECT}")"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --project="${PROJECT}" \
  --member="serviceAccount:${PUBSUB_AGENT}" \
  --role="roles/storage.objectCreator"

echo "bucket gs://${BUCKET} ready; writer ${SA}; pubsub agent ${PUBSUB_AGENT}"
echo "create the HMAC key with:"
echo "  gcloud storage hmac create ${SA} --project=${PROJECT}"
```

- [ ] **Step 3: Write the subscription script**

```bash
#!/usr/bin/env bash
# infra/pubsub/create-gcs-export-subscription.sh
# Native Cloud Storage export subscription: configuration, not consumer code.
# The portal.event topic is created by S5a; this script fails loudly if it is absent.
set -euo pipefail

PROJECT="${GCP_PROJECT:-propane-galaxy-498403-n8}"
BUCKET="${GCS_RAW_EVENTS_BUCKET:-gs-portal-raw-events-prod}"
TOPIC="portal.event"
SUBSCRIPTION="portal-event-gcs-export"
DEAD_LETTER="portal.event.dead"

gcloud pubsub topics describe "${TOPIC}" --project="${PROJECT}" >/dev/null
gcloud pubsub topics describe "${DEAD_LETTER}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud pubsub topics create "${DEAD_LETTER}" --project="${PROJECT}"

gcloud pubsub subscriptions describe "${SUBSCRIPTION}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud pubsub subscriptions create "${SUBSCRIPTION}" \
    --project="${PROJECT}" \
    --topic="${TOPIC}" \
    --cloud-storage-bucket="${BUCKET}" \
    --cloud-storage-file-prefix="portal-event/" \
    --cloud-storage-file-suffix=".json" \
    --cloud-storage-output-format=text \
    --cloud-storage-max-bytes=10000000 \
    --cloud-storage-max-duration=60s \
    --dead-letter-topic="${DEAD_LETTER}" \
    --max-delivery-attempts=5

echo "subscription ${SUBSCRIPTION} exporting ${TOPIC} to gs://${BUCKET}/portal-event/"
```

- [ ] **Step 4: Run both scripts**

```bash
chmod +x infra/gcs/create-raw-events-bucket.sh infra/pubsub/create-gcs-export-subscription.sh
./infra/gcs/create-raw-events-bucket.sh
```
Expected final lines: `bucket gs://gs-portal-raw-events-prod ready; writer portal-raw-ingest@propane-galaxy-498403-n8.iam.gserviceaccount.com; pubsub agent service-<number>@gcp-sa-pubsub.iam.gserviceaccount.com`

```bash
gcloud storage hmac create portal-raw-ingest@propane-galaxy-498403-n8.iam.gserviceaccount.com --project=propane-galaxy-498403-n8
```
Expected: YAML containing `accessId: GOOG1E...` and `secret: <40+ chars>`. Put them in `.env.local` as `GCS_HMAC_ACCESS_ID` and `GCS_HMAC_SECRET`; they are consumed only by Task 9's cloud-variant migration and must never be committed.

```bash
./infra/pubsub/create-gcs-export-subscription.sh
```
Expected: `Created subscription [projects/propane-galaxy-498403-n8/subscriptions/portal-event-gcs-export].` followed by the summary line.

- [ ] **Step 5: Verify the export actually writes**

```bash
gcloud pubsub topics publish portal.event --project=propane-galaxy-498403-n8 \
  --message='{"event_id":"00000000-0000-4000-8000-000000000000","org_id":"00000000-0000-0000-0000-000000000000","event":"page_view","purpose":"site_analytics","session_id":"smoketestsmoketest01","taxonomy_version":1,"occurred_at":"2026-08-12T09:00:00.000Z","payload":{"path":"/","referrer":""}}' \
  --ordering-key=00000000-0000-0000-0000-000000000000
sleep 75
gcloud storage ls "gs://gs-portal-raw-events-prod/portal-event/**"
```
Expected: at least one object listed. If empty after 75 s, the Pub/Sub service agent lacks `objectCreator` — re-run step 4's first script and check its final line.

- [ ] **Step 6: Document and commit**

```markdown
<!-- infra/gcs/README.md -->
# Raw portal-event bucket

`gs://gs-portal-raw-events-prod` is **transport, not an archive**. Pub/Sub's native
Cloud Storage export subscription writes batches here; ClickHouse's S3Queue engine
consumes them and deletes each file after processing.

Deliberately a different bucket from the DuckDB snapshot bucket: snapshots use
per-tenant prefixes with scoped service accounts (datastore §12.3), this one uses HMAC
keys against the S3-compatible endpoint. One bucket for both would let the coarser
credential reach snapshot data.

Erasure: files are batched and multi-subject, so they are not addressable per subject.
The one-day lifecycle rule plus delete-after-ingest bounds exposure to roughly one
batch interval; per-subject erasure targets the ClickHouse raw table instead.

Rotate the HMAC key with `gcloud storage hmac update ... --deactivate` then
`gcloud storage hmac create ...`, updating `GCS_HMAC_ACCESS_ID` / `GCS_HMAC_SECRET`
and re-running `scripts/clickhouse/migrate.ts` against the cloud target.
```

```bash
git add infra/gcs infra/pubsub
git commit -m "feat(infra): raw portal-event bucket, scoped IAM, GCS export subscription

Bucket-scoped objectAdmin for the S3Queue writer and objectCreator for the
Pub/Sub service agent -- no project-wide storage roles. One-day lifecycle
rule bounds erasure exposure to about one batch interval."
```

## Task 9: The ClickHouse raw zone — ingest table, target table, materialized view

**Skills:** `senior-data-engineer`, `database-optimizer`
**Model:** `inherit` — the local/cloud ingest-table split and the S3Queue settings need judgement about how the transform stays testable.

**Files:**
- Create: `infra/clickhouse/migrations/002_portal_events.up.sql` / `.down.sql`
- Create: `infra/clickhouse/migrations/003_portal_event_ingest.local.up.sql` / `003_portal_event_ingest.local.down.sql`
- Create: `infra/clickhouse/migrations/003_portal_event_ingest.cloud.up.sql` / `003_portal_event_ingest.cloud.down.sql`
- Create: `infra/clickhouse/migrations/004_portal_event_mv.up.sql` / `.down.sql`
- Create: `infra/clickhouse/migrations/005_portal_events_policy.up.sql` / `.down.sql`
- Test: `lib/clickhouse/raw-zone.test.ts`

**Interfaces:**
- Consumes: `chExec`, `chQuery`, `applyMigrations` (Task 1).
- Produces: `raw.portal_event_ingest` (one column, `raw String`), `raw.portal_events`, `raw.portal_event_mv`, row policy `portal_events_tenant`.

**Context — how this is testable without cloud credentials.** The materialized view names exactly one source table, `raw.portal_event_ingest`. In cloud that table is the S3Queue engine; locally it is `ENGINE = Null`. ClickHouse discards rows written to a `Null` table **but still fires materialized views attached to it**, so inserting a line locally exercises the identical transform, the identical target table, and the identical column types as production. No second copy of the transform exists, so the two cannot drift.

- [ ] **Step 1: Write the failing test**

```ts
// lib/clickhouse/raw-zone.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { chExec, chQuery, clickhouseConfig } from "./client";
import { applyMigrations } from "./migrate";

const live = Boolean(process.env.CLICKHOUSE_URL);
const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";

function line(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_id: "11111111-0000-4000-8000-000000000001",
    org_id: ORG_A,
    event: "listing_view",
    purpose: "space_recommendation",
    session_id: "abcdefabcdefabcdef01",
    taxonomy_version: 1,
    occurred_at: "2026-08-12T09:00:00.000Z",
    payload: { listing_ref: "listing-7", dwell_seconds: 42 },
    ...overrides,
  });
}

async function insertLines(lines: string[]): Promise<void> {
  await chExec(
    `INSERT INTO raw.portal_event_ingest (raw) FORMAT JSONEachRow\n` +
      lines.map((l) => JSON.stringify({ raw: l })).join("\n"),
  );
}

describe.skipIf(!live)("raw zone", () => {
  beforeAll(async () => {
    await applyMigrations();
    await chExec("TRUNCATE TABLE raw.portal_events");
  });

  it("materialises a published event into typed columns", async () => {
    await insertLines([line()]);
    const [row] = await chQuery<{
      org_id: string; event: string; purpose: string; session_id: string;
      taxonomy_version: number; payload: string;
    }>(
      `SELECT toString(org_id) AS org_id, event, purpose, session_id, taxonomy_version, payload
         FROM raw.portal_events FINAL WHERE event_id = '11111111-0000-4000-8000-000000000001'`,
    );
    expect(row.org_id).toBe(ORG_A);
    expect(row.event).toBe("listing_view");
    expect(row.purpose).toBe("space_recommendation");
    expect(row.session_id).toBe("abcdefabcdefabcdef01");
    expect(row.taxonomy_version).toBe(1);
    expect(JSON.parse(row.payload)).toEqual({ listing_ref: "listing-7", dwell_seconds: 42 });
  });

  it("is idempotent under at-least-once delivery: the same event_id lands once", async () => {
    await insertLines([line({ event_id: "22222222-0000-4000-8000-000000000002" })]);
    await insertLines([line({ event_id: "22222222-0000-4000-8000-000000000002" })]);
    const [row] = await chQuery<{ c: string }>(
      `SELECT count() AS c FROM raw.portal_events FINAL
        WHERE event_id = '22222222-0000-4000-8000-000000000002'`,
    );
    expect(row.c).toBe("1");
  });

  it("partitions by purpose and day so retention expiry is a partition drop", async () => {
    const [row] = await chQuery<{ partition_key: string }>(
      "SELECT partition_key FROM system.tables WHERE database = 'raw' AND name = 'portal_events'",
    );
    expect(row.partition_key).toContain("purpose");
    expect(row.partition_key).toContain("occurred_on");
  });

  it("hides other tenants' events from a policy-covered reader", async () => {
    await insertLines([line({ event_id: "33333333-0000-4000-8000-000000000003", org_id: ORG_B })]);
    const tenantConfig = {
      ...clickhouseConfig(),
      user: "tenant_reader",
      password: process.env.CLICKHOUSE_TENANT_PASSWORD ?? "tenant",
    };
    const rows = await chQuery<{ org_id: string }>(
      "SELECT DISTINCT toString(org_id) AS org_id FROM raw.portal_events FINAL",
      { config: tenantConfig, settings: { SQL_current_tenant_id: ORG_B } },
    );
    expect(rows.map((r) => r.org_id)).toEqual([ORG_B]);
  });

  it("drops a line with no org_id rather than storing an untenanted event", async () => {
    await insertLines(['{"event":"page_view","payload":{}}']);
    const [row] = await chQuery<{ c: string }>(
      "SELECT count() AS c FROM raw.portal_events FINAL WHERE org_id = toUUID('00000000-0000-0000-0000-000000000000')",
    );
    expect(row.c).toBe("0");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl npx vitest run lib/clickhouse/raw-zone.test.ts`
Expected: FAIL — `Table raw.portal_event_ingest does not exist`.

- [ ] **Step 3: Write migration 002 — the target table**

```sql
-- infra/clickhouse/migrations/002_portal_events.up.sql
CREATE TABLE IF NOT EXISTS raw.portal_events
(
  org_id           UUID,
  event_id         UUID,
  event            LowCardinality(String),
  purpose          LowCardinality(String),
  session_id       String,
  taxonomy_version UInt16,
  occurred_at      DateTime64(3),
  payload          String,
  ingested_at      DateTime64(3) DEFAULT now64(3),
  occurred_on      Date MATERIALIZED toDate(occurred_at)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (purpose, occurred_on)
ORDER BY (org_id, occurred_on, session_id, event_id);
```

```sql
-- infra/clickhouse/migrations/002_portal_events.down.sql
DROP TABLE IF EXISTS raw.portal_events;
```

- [ ] **Step 4: Write migration 003 in both variants**

```sql
-- infra/clickhouse/migrations/003_portal_event_ingest.local.up.sql
-- Null engine: rows are discarded, but attached materialized views still fire, so the
-- transform in 004 is exercised locally with no cloud credentials and no second copy.
CREATE TABLE IF NOT EXISTS raw.portal_event_ingest (raw String) ENGINE = Null;
```

```sql
-- infra/clickhouse/migrations/003_portal_event_ingest.local.down.sql
DROP TABLE IF EXISTS raw.portal_event_ingest;
```

```sql
-- infra/clickhouse/migrations/003_portal_event_ingest.cloud.up.sql
-- GCS through its S3-compatible endpoint, authenticated with the HMAC key from
-- infra/gcs/create-raw-events-bucket.sh. Credentials are substituted by the runner,
-- never committed. after_processing = 'delete' keeps the bucket as transport.
-- Keeper tracks processed files; the two bounds below stop that state growing without limit.
CREATE TABLE IF NOT EXISTS raw.portal_event_ingest (raw String)
ENGINE = S3Queue(
  'https://storage.googleapis.com/${GCS_RAW_EVENTS_BUCKET}/portal-event/*.json',
  '${GCS_HMAC_ACCESS_ID}',
  '${GCS_HMAC_SECRET}',
  'LineAsString'
)
SETTINGS
  mode = 'unordered',
  after_processing = 'delete',
  keeper_path = '/clickhouse/s3queue/portal_events',
  tracked_files_limit = 10000,
  tracked_file_ttl_sec = 604800,
  polling_min_timeout_ms = 1000,
  polling_max_timeout_ms = 10000;
```

```sql
-- infra/clickhouse/migrations/003_portal_event_ingest.cloud.down.sql
DROP TABLE IF EXISTS raw.portal_event_ingest;
```

- [ ] **Step 5: Write migration 004 — the materialized view, identical in both targets**

```sql
-- infra/clickhouse/migrations/004_portal_event_mv.up.sql
-- The view is what starts ingestion: with no view attached, the S3Queue engine
-- collects nothing. One view, one source table name, both targets.
CREATE MATERIALIZED VIEW IF NOT EXISTS raw.portal_event_mv TO raw.portal_events AS
SELECT
  toUUIDOrZero(JSONExtractString(raw, 'org_id'))                       AS org_id,
  toUUIDOrZero(JSONExtractString(raw, 'event_id'))                     AS event_id,
  JSONExtractString(raw, 'event')                                      AS event,
  JSONExtractString(raw, 'purpose')                                    AS purpose,
  JSONExtractString(raw, 'session_id')                                 AS session_id,
  toUInt16(JSONExtractUInt(raw, 'taxonomy_version'))                   AS taxonomy_version,
  parseDateTime64BestEffortOrZero(JSONExtractString(raw, 'occurred_at'), 3) AS occurred_at,
  JSONExtractRaw(raw, 'payload')                                       AS payload
FROM raw.portal_event_ingest
WHERE toUUIDOrZero(JSONExtractString(raw, 'org_id')) != toUUID('00000000-0000-0000-0000-000000000000')
  AND JSONExtractString(raw, 'event') != '';
```

```sql
-- infra/clickhouse/migrations/004_portal_event_mv.down.sql
DROP VIEW IF EXISTS raw.portal_event_mv;
```

- [ ] **Step 6: Write migration 005 — the row policy**

```sql
-- infra/clickhouse/migrations/005_portal_events_policy.up.sql
CREATE ROW POLICY IF NOT EXISTS portal_events_tenant ON raw.portal_events
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
```

```sql
-- infra/clickhouse/migrations/005_portal_events_policy.down.sql
DROP ROW POLICY IF EXISTS portal_events_tenant ON raw.portal_events;
```

- [ ] **Step 7: Apply and run the test**

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl CLICKHOUSE_TARGET=local
npx tsx scripts/clickhouse/migrate.ts
```
Expected: `clickhouse: applied 002, 003, 004, 005`

Run: `CLICKHOUSE_TENANT_PASSWORD=tenant npx vitest run lib/clickhouse/raw-zone.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Verify the cloud variant is accepted by the server**

```bash
CLICKHOUSE_TARGET=cloud \
GCS_RAW_EVENTS_BUCKET=gs-portal-raw-events-prod \
GCS_HMAC_ACCESS_ID="$GCS_HMAC_ACCESS_ID" \
GCS_HMAC_SECRET="$GCS_HMAC_SECRET" \
npx tsx -e "
import { readFileSync } from 'node:fs';
import { substituteEnv, splitStatements } from './lib/clickhouse/migrate';
const sql = substituteEnv(readFileSync('infra/clickhouse/migrations/003_portal_event_ingest.cloud.up.sql','utf-8'));
console.log(splitStatements(sql).length === 1 ? 'cloud DDL renders to one statement' : 'unexpected statement count');
"
```
Expected: `cloud DDL renders to one statement`. Applying it for real happens on the deployment host, where the HMAC key exists; the local box keeps the `Null` variant.

- [ ] **Step 9: Commit**

```bash
git add infra/clickhouse/migrations lib/clickhouse/raw-zone.test.ts
git commit -m "feat(clickhouse): raw portal-event zone, S3Queue in cloud, Null locally

The materialized view names one source table. In cloud that table is S3Queue
over the GCS S3-compatible endpoint; locally it is ENGINE = Null, which still
fires attached views -- so the transform is tested with no cloud credentials
and there is no second copy of it to drift.

Partitioned by (purpose, occurred_on) so per-purpose retention expiry is a
partition drop rather than a scan-and-delete."
```

## Task 10: Consent state, cache, and `LISTEN/NOTIFY` invalidation

**Skills:** `senior-backend`, `typescript-pro`, `gdpr-dsgvo-expert`
**Model:** `inherit` — the current-state derivation over an append-only log and the invalidation lifecycle are the load-bearing logic of the whole plan.

**Files:**
- Create: `ads-agent/lib/portal/consent.ts`
- Create: `ads-agent/lib/portal/consent-cache.ts`
- Test: `ads-agent/lib/portal/consent.test.ts`
- Test: `ads-agent/lib/portal/consent-cache.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` from `ads-agent/lib/db/scope-sql.ts` (S3); `getPool` from `ads-agent/lib/db/client.ts`; `enqueueEvent` from `ads-agent/lib/db/outbox.ts` and `withTenantTransaction` from `ads-agent/lib/db/tx.ts` (S5a); `context.consent_records` (Task 6).
- Produces:
  - `type ConsentState = { purposes: string[]; latestAt: string | null }`
  - `loadConsentState(scope: Scope, subjectRef: string): Promise<ConsentState>`
  - `recordConsent(scope: Scope, input: { subjectRef: string; purposes: string[]; action: "granted" | "withdrawn"; noticeVersion: number; mechanism: "banner" | "form" | "consent_manager" }): Promise<string>` — returns the consent record id; a withdrawal also publishes `deletion.requested` in the same transaction
  - `consentCacheTtlMs(env?): number`, `cacheKey(orgId, subjectRef): string`, `invalidateConsent(key): void`, `clearConsentCache(): void`
  - `getConsentStateCached(scope: Scope, orgId: string, subjectRef: string, now?: number): Promise<ConsentState>`
  - `startConsentInvalidator(pool: Pool): Promise<() => Promise<void>>`, `ensureConsentInvalidator(): Promise<void>`

- [ ] **Step 1: Write the failing test for state derivation**

```ts
// ads-agent/lib/portal/consent.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const enqueueEvent = vi.fn().mockResolvedValue("outbox-1");
vi.mock("../db/outbox", () => ({ enqueueEvent: (...a: unknown[]) => enqueueEvent(...a) }));

// The real withTenantTransaction (S5a) is exercised by its own tests; here it is a
// pass-through so this suite tests the consent logic rather than transaction plumbing.
const clientQuery = vi.fn();
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: clientQuery }),
}));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset().mockResolvedValue({ rows: [{ id: "consent-1" }] });
  enqueueEvent.mockClear();
});

describe("loadConsentState", () => {
  it("returns only purposes whose latest record is a grant", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { purpose: "space_recommendation", latest_at: "2026-08-12T09:00:00.000Z" },
        { purpose: "site_analytics", latest_at: "2026-08-12T08:00:00.000Z" },
      ],
    });
    const { loadConsentState } = await import("./consent");
    const state = await loadConsentState(scope, "sess-1");
    expect(state.purposes.sort()).toEqual(["site_analytics", "space_recommendation"]);
    expect(state.latestAt).toBe("2026-08-12T09:00:00.000Z");
  });

  it("scopes the query by tenant and by subject", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { loadConsentState } = await import("./consent");
    await loadConsentState(scope, "sess-1");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("context.consent_records");
    expect(sql).toContain("subject_ref");
    expect(params).toContain(ORG);
    expect(params).toContain("sess-1");
  });

  it("returns an empty state when nothing was ever recorded, so the gate denies", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { loadConsentState } = await import("./consent");
    expect(await loadConsentState(scope, "unknown")).toEqual({ purposes: [], latestAt: null });
  });
});

describe("recordConsent", () => {
  it("inserts the grant through the shared transaction helper and publishes nothing", async () => {
    const { recordConsent } = await import("./consent");
    const id = await recordConsent(scope, {
      subjectRef: "sess-1", purposes: ["site_analytics"], action: "granted",
      noticeVersion: 1, mechanism: "banner",
    });
    expect(id).toBe("consent-1");
    expect(String(clientQuery.mock.calls[0][0])).toContain("context.consent_records");
    expect(enqueueEvent).not.toHaveBeenCalled();
  });

  it("raises deletion.requested through the outbox when consent is withdrawn", async () => {
    const { recordConsent } = await import("./consent");
    await recordConsent(scope, {
      subjectRef: "sess-1", purposes: ["space_recommendation"], action: "withdrawn",
      noticeVersion: 1, mechanism: "banner",
    });
    expect(enqueueEvent).toHaveBeenCalledTimes(1);
    const [passedScope, , event] = enqueueEvent.mock.calls[0];
    expect(passedScope).toEqual(scope);
    expect(event.topic).toBe("deletion.requested");
    expect(event.payload).toMatchObject({
      subject_kind: "enquirer", subject_ref: "sess-1", reason: "consent_withdrawn",
    });
  });

  it("invalidates the local cache immediately, without waiting for its own NOTIFY", async () => {
    const cache = await import("./consent-cache");
    const spy = vi.spyOn(cache, "invalidateConsent");
    const { recordConsent } = await import("./consent");
    await recordConsent(scope, {
      subjectRef: "sess-1", purposes: ["space_recommendation"], action: "withdrawn",
      noticeVersion: 1, mechanism: "banner",
    });
    expect(spy).toHaveBeenCalledWith(`${ORG}:sess-1`);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/portal/consent.test.ts`
Expected: FAIL — `Failed to resolve import "./consent"`.

- [ ] **Step 3: Write the consent data layer**

```ts
// ads-agent/lib/portal/consent.ts
import { getPool } from "../db/client";
import { enqueueEvent } from "../db/outbox";
import { scopeClause, type Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { cacheKey, invalidateConsent } from "./consent-cache";

export type ConsentAction = "granted" | "withdrawn";
export type ConsentMechanism = "banner" | "form" | "consent_manager";
export type ConsentState = { purposes: string[]; latestAt: string | null };

export type RecordConsentInput = {
  subjectRef: string;
  purposes: string[];
  action: ConsentAction;
  noticeVersion: number;
  mechanism: ConsentMechanism;
};

/**
 * Current state derived from an append-only log: for each purpose, the latest record
 * mentioning it decides. Withdrawal is a new row, so state is never read from a
 * mutable flag -- which is what lets us show what was true when an event arrived.
 * scopeClause is composed first so its `$1` numbering stays valid.
 */
export async function loadConsentState(scope: Scope, subjectRef: string): Promise<ConsentState> {
  const clause = scopeClause(scope, "cr.org_id");
  const { rows } = await getPool().query<{ purpose: string; latest_at: string }>(
    `SELECT purpose, latest_at FROM (
       SELECT p AS purpose,
              cr.action,
              to_char(cr.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS latest_at,
              row_number() OVER (PARTITION BY p ORDER BY cr.occurred_at DESC, cr.id DESC) AS rn
         FROM context.consent_records cr, unnest(cr.purposes) AS p
        WHERE ${clause.sql} AND cr.subject_ref = $${clause.params.length + 1}
     ) ranked
     WHERE rn = 1 AND action = 'granted'`,
    [...clause.params, subjectRef],
  );

  const latestAt = rows.reduce<string | null>(
    (newest, row) => (newest === null || row.latest_at > newest ? row.latest_at : newest),
    null,
  );
  return { purposes: rows.map((r) => r.purpose), latestAt };
}

export async function recordConsent(scope: Scope, input: RecordConsentInput): Promise<string> {
  if (scope.kind !== "org") throw new Error("recordConsent requires org scope");
  const orgId = scope.orgId;

  const consentId = await withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO context.consent_records
         (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, $2, $3::text[], $4, $5, $6)
       RETURNING id::text AS id`,
      [orgId, input.subjectRef, input.purposes, input.action, input.noticeVersion, input.mechanism],
    );

    // Withdrawal does two things, and this is the one systems miss: prior data is
    // erased, through the same ledger as any other erasure request. Same transaction
    // as the consent row, so neither can exist without the other.
    if (input.action === "withdrawn") {
      await enqueueEvent(scope, client, {
        topic: "deletion.requested",
        payload: {
          subject_kind: "enquirer",
          subject_ref: input.subjectRef,
          purposes: input.purposes,
          reason: "consent_withdrawn",
          consent_record_id: rows[0].id,
        },
      });
    }

    return rows[0].id;
  });

  // Our own process must not wait for its own notification to come back.
  invalidateConsent(cacheKey(orgId, input.subjectRef));
  return consentId;
}
```

- [ ] **Step 4: Write the failing test for the cache**

```ts
// ads-agent/lib/portal/consent-cache.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const loadConsentState = vi.fn();
vi.mock("./consent", () => ({ loadConsentState: (...a: unknown[]) => loadConsentState(...a) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(async () => {
  loadConsentState.mockReset().mockResolvedValue({ purposes: ["space_recommendation"], latestAt: null });
  const { clearConsentCache } = await import("./consent-cache");
  clearConsentCache();
});

describe("getConsentStateCached", () => {
  it("hits the database once inside the TTL", async () => {
    const { getConsentStateCached } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    await getConsentStateCached(scope, ORG, "sess-1", 1_500);
    expect(loadConsentState).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL", async () => {
    const { getConsentStateCached, consentCacheTtlMs } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    await getConsentStateCached(scope, ORG, "sess-1", 1_000 + consentCacheTtlMs() + 1);
    expect(loadConsentState).toHaveBeenCalledTimes(2);
  });

  it("reloads immediately after invalidation, TTL notwithstanding", async () => {
    const { getConsentStateCached, invalidateConsent, cacheKey } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    invalidateConsent(cacheKey(ORG, "sess-1"));
    await getConsentStateCached(scope, ORG, "sess-1", 1_001);
    expect(loadConsentState).toHaveBeenCalledTimes(2);
  });

  it("keys separately per tenant, so one tenant cannot poison another's entry", async () => {
    const { getConsentStateCached } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    await getConsentStateCached({ kind: "org", orgId: "bbbb" } as const, "bbbb", "sess-1", 1_000);
    expect(loadConsentState).toHaveBeenCalledTimes(2);
  });
});

describe("startConsentInvalidator", () => {
  it("drops the entry named by a consent_changed notification", async () => {
    const handlers: Array<(msg: { channel: string; payload?: string }) => void> = [];
    const client = {
      on: (_event: string, handler: (msg: { channel: string; payload?: string }) => void) => handlers.push(handler),
      removeAllListeners: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };

    const { startConsentInvalidator, getConsentStateCached } = await import("./consent-cache");
    const stop = await startConsentInvalidator(pool as never);
    expect(client.query).toHaveBeenCalledWith("LISTEN consent_changed");

    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    handlers.forEach((h) => h({ channel: "consent_changed", payload: `${ORG}:sess-1` }));
    await getConsentStateCached(scope, ORG, "sess-1", 1_001);
    expect(loadConsentState).toHaveBeenCalledTimes(2);

    await stop();
    expect(client.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Write the cache and invalidator**

```ts
// ads-agent/lib/portal/consent-cache.ts
import type { Pool, PoolClient } from "pg";
import { getPool } from "../db/client";
import type { Scope } from "../db/scope-sql";
import { loadConsentState, type ConsentState } from "./consent";

type Entry = { state: ConsentState; expiresAt: number };

const cache = new Map<string, Entry>();

export function consentCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.CONSENT_CACHE_TTL_MS ?? "5000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

export function cacheKey(orgId: string, subjectRef: string): string {
  return `${orgId}:${subjectRef}`;
}

export function invalidateConsent(key: string): void {
  cache.delete(key);
}

export function clearConsentCache(): void {
  cache.clear();
}

export async function getConsentStateCached(
  scope: Scope,
  orgId: string,
  subjectRef: string,
  now: number = Date.now(),
): Promise<ConsentState> {
  const key = cacheKey(orgId, subjectRef);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.state;

  const state = await loadConsentState(scope, subjectRef);
  cache.set(key, { state, expiresAt: now + consentCacheTtlMs() });
  return state;
}

/**
 * A withdrawal must take effect in seconds, not at the next cache expiry, so the
 * cache is invalidated by a database notification rather than by time. Each app
 * instance holds its own cache and its own listener, so a multi-instance deployment
 * invalidates everywhere without a shared cache to coordinate.
 */
export async function startConsentInvalidator(pool: Pool): Promise<() => Promise<void>> {
  const client: PoolClient = await pool.connect();
  client.on("notification", (msg) => {
    if (msg.channel === "consent_changed" && msg.payload) invalidateConsent(msg.payload);
  });
  await client.query("LISTEN consent_changed");
  return async () => {
    client.removeAllListeners("notification");
    try {
      await client.query("UNLISTEN consent_changed");
    } finally {
      client.release();
    }
  };
}

let invalidatorStarted: Promise<() => Promise<void>> | null = null;

export async function ensureConsentInvalidator(): Promise<void> {
  if (!invalidatorStarted) invalidatorStarted = startConsentInvalidator(getPool());
  await invalidatorStarted;
}
```

- [ ] **Step 6: Run both tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/portal/consent.test.ts lib/portal/consent-cache.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/portal/consent.ts ads-agent/lib/portal/consent-cache.ts ads-agent/lib/portal/consent.test.ts ads-agent/lib/portal/consent-cache.test.ts
git commit -m "feat(consent): state from the append-only log, cache invalidated by NOTIFY

Current consent is derived per purpose from the latest record mentioning it,
never from a mutable flag. The hot-path cache is invalidated by the
consent_changed notification, so a withdrawal does not wait for TTL expiry;
the withdrawing process also invalidates locally rather than waiting for its
own notification to return."
```

## Task 11: ClickHouse rollups

**Skills:** `senior-data-engineer`, `database-optimizer`
**Model:** `composer-2.5-fast` — DDL and tests are fully specified.

**Files:**
- Create: `infra/clickhouse/migrations/006_portal_event_daily.up.sql` / `.down.sql`
- Create: `infra/clickhouse/migrations/007_search_performed_daily.up.sql` / `.down.sql`
- Test: `lib/clickhouse/rollups.test.ts`

**Interfaces:**
- Consumes: `raw.portal_events`, `raw.portal_event_ingest` (Task 9).
- Produces: `analytics.portal_event_daily`, `analytics.search_performed_daily` and their materialized views.

**Context.** `analytics.search_performed_daily` is the replacement reader for `search_queries`, which Task 18 retires. It keeps the demand-ledger question answerable — the zero-result search is the most valuable row in the system, and `search_queries` could not distinguish it from a successful one because it had no session, no tenant, and no outcome. Here `result_count = 0` is a first-class dimension.

- [ ] **Step 1: Write the failing test**

```ts
// lib/clickhouse/rollups.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { chExec, chQuery } from "./client";
import { applyMigrations } from "./migrate";

const live = Boolean(process.env.CLICKHOUSE_URL);
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

function searchLine(eventId: string, resultCount: number): string {
  return JSON.stringify({
    event_id: eventId,
    org_id: ORG,
    event: "search_performed",
    purpose: "space_recommendation",
    session_id: "abcdefabcdefabcdef01",
    taxonomy_version: 1,
    occurred_at: "2026-08-12T09:00:00.000Z",
    payload: { query: "hsr layout 20 desks", filters: {}, result_count: resultCount },
  });
}

describe.skipIf(!live)("rollups", () => {
  beforeAll(async () => {
    await applyMigrations();
    await chExec("TRUNCATE TABLE raw.portal_events");
    await chExec("TRUNCATE TABLE analytics.portal_event_daily");
    await chExec("TRUNCATE TABLE analytics.search_performed_daily");
    await chExec(
      "INSERT INTO raw.portal_event_ingest (raw) FORMAT JSONEachRow\n" +
        [
          JSON.stringify({ raw: searchLine("44444444-0000-4000-8000-000000000004", 0) }),
          JSON.stringify({ raw: searchLine("55555555-0000-4000-8000-000000000005", 7) }),
        ].join("\n"),
    );
  });

  it("counts events per tenant, day and event kind", async () => {
    const [row] = await chQuery<{ events: string }>(
      `SELECT toString(sum(events)) AS events FROM analytics.portal_event_daily
        WHERE org_id = {org:UUID} AND event = 'search_performed'`,
      { params: { org: ORG } },
    );
    expect(row.events).toBe("2");
  });

  it("keeps zero-result searches distinguishable, which search_queries could not", async () => {
    const rows = await chQuery<{ zero_result: number; searches: string }>(
      `SELECT zero_result, toString(sum(searches)) AS searches
         FROM analytics.search_performed_daily
        WHERE org_id = {org:UUID}
        GROUP BY zero_result ORDER BY zero_result`,
      { params: { org: ORG } },
    );
    expect(rows).toEqual([
      { zero_result: 0, searches: "1" },
      { zero_result: 1, searches: "1" },
    ]);
  });

  it("leads both rollup sort keys with org_id", async () => {
    const rows = await chQuery<{ name: string }>(
      `SELECT name FROM system.tables
        WHERE database = 'analytics' AND name LIKE '%_daily' AND position(sorting_key, 'org_id') != 1`,
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl npx vitest run lib/clickhouse/rollups.test.ts`
Expected: FAIL — `Table analytics.portal_event_daily does not exist`.

- [ ] **Step 3: Write migration 006**

```sql
-- infra/clickhouse/migrations/006_portal_event_daily.up.sql
CREATE TABLE IF NOT EXISTS analytics.portal_event_daily
(
  org_id      UUID,
  occurred_on Date,
  event       LowCardinality(String),
  purpose     LowCardinality(String),
  events      SimpleAggregateFunction(sum, UInt64),
  sessions    AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (org_id, occurred_on, event, purpose);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.portal_event_daily_mv
TO analytics.portal_event_daily AS
SELECT
  org_id,
  toDate(occurred_at) AS occurred_on,
  event,
  purpose,
  toUInt64(count())   AS events,
  uniqState(session_id) AS sessions
FROM raw.portal_events
GROUP BY org_id, occurred_on, event, purpose;

CREATE ROW POLICY IF NOT EXISTS portal_event_daily_tenant ON analytics.portal_event_daily
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
```

```sql
-- infra/clickhouse/migrations/006_portal_event_daily.down.sql
DROP ROW POLICY IF EXISTS portal_event_daily_tenant ON analytics.portal_event_daily;
DROP VIEW IF EXISTS analytics.portal_event_daily_mv;
DROP TABLE IF EXISTS analytics.portal_event_daily;
```

- [ ] **Step 4: Write migration 007**

```sql
-- infra/clickhouse/migrations/007_search_performed_daily.up.sql
-- Replaces the reporting job public.search_queries used to serve. zero_result is a
-- dimension rather than a derivable afterthought: an unmet-demand search is the
-- highest-value row here, and the retired table could not tell it from a good one.
CREATE TABLE IF NOT EXISTS analytics.search_performed_daily
(
  org_id       UUID,
  occurred_on  Date,
  zero_result  UInt8,
  searches     SimpleAggregateFunction(sum, UInt64),
  sessions     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (org_id, occurred_on, zero_result);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.search_performed_daily_mv
TO analytics.search_performed_daily AS
SELECT
  org_id,
  toDate(occurred_at) AS occurred_on,
  toUInt8(JSONExtractUInt(payload, 'result_count') = 0) AS zero_result,
  toUInt64(count())     AS searches,
  uniqState(session_id) AS sessions
FROM raw.portal_events
WHERE event = 'search_performed'
GROUP BY org_id, occurred_on, zero_result;

CREATE ROW POLICY IF NOT EXISTS search_performed_daily_tenant ON analytics.search_performed_daily
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
```

```sql
-- infra/clickhouse/migrations/007_search_performed_daily.down.sql
DROP ROW POLICY IF EXISTS search_performed_daily_tenant ON analytics.search_performed_daily;
DROP VIEW IF EXISTS analytics.search_performed_daily_mv;
DROP TABLE IF EXISTS analytics.search_performed_daily;
```

- [ ] **Step 5: Apply, run the test, commit**

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl CLICKHOUSE_TARGET=local
npx tsx scripts/clickhouse/migrate.ts
npx vitest run lib/clickhouse/rollups.test.ts
```
Expected: `clickhouse: applied 006, 007` then PASS, 3 tests.

```bash
git add infra/clickhouse/migrations/006_* infra/clickhouse/migrations/007_* lib/clickhouse/rollups.test.ts
git commit -m "feat(clickhouse): portal event and search rollups

search_performed_daily carries zero_result as a dimension, which is what
search_queries structurally could not do -- an unmet-demand search was
indistinguishable from a successful one there."
```

## Task 12: The ingestion edge

**Skills:** `senior-backend`, `api-designer`, `security-engineer`
**Model:** `inherit` — the rejection ordering is a cost-and-correctness decision, and CORS on a public write-only endpoint is easy to get wrong.

**Files:**
- Create: `ads-agent/lib/db/migrations/061_ingest_rejection_counters.up.sql` / `.down.sql`
- Create: `ads-agent/lib/portal/config.ts`
- Create: `ads-agent/lib/portal/rate-limit.ts`
- Create: `ads-agent/lib/portal/rejections.ts`
- Create: `ads-agent/lib/portal/ingest.ts`
- Create: `ads-agent/app/api/v1/ingest/route.ts`
- Test: `ads-agent/lib/portal/ingest.test.ts`
- Test: `ads-agent/lib/portal/rate-limit.test.ts`

**Interfaces:**
- Consumes: `envelopeSchema`, `purposeFor`, `MAX_BODY_BYTES` (Task 7); `getConsentStateCached`, `ensureConsentInvalidator` (Task 10); `enqueueEvent` and `withTenantTransaction` (S5a); `context.tenant_portal_config` (Task 6).
- Produces:
  - `resolveIngestKey(scope: Scope, ingestKey: string): Promise<TenantPortalConfig | null>` where `TenantPortalConfig = { orgId: string; allowedOrigins: string[]; purposesOffered: string[]; noticeVersion: number }` — **platform scope only; throws on org scope**
  - `PLATFORM_SCOPE: Scope`, `clearPortalConfigCache(): void`
  - `originAllowed(origin: string | null, allowed: string[]): boolean`
  - `checkRateLimit(ingestKey: string, sessionId: string, now?: number): boolean`, `resetRateLimits(): void`, `TENANT_LIMIT_PER_MINUTE`, `SESSION_LIMIT_PER_MINUTE`
  - `recordRejection(orgId: string | null, reason: RejectionReason): void`, `flushRejectionCounters(): Promise<void>`
  - `type RejectionReason = "too_large" | "invalid_json" | "invalid_shape" | "unknown_key" | "origin_not_allowed" | "rate_limited" | "no_consent"`
  - `ingest(input: { body: string; ingestKey: string | null; origin: string | null }): Promise<IngestOutcome>` where `IngestOutcome = { ok: true; accepted: number; eventIds: string[] } | { ok: false; status: 400 | 403 | 404 | 413 | 429; reason: RejectionReason }`

**Context — the tenant key is an identifier, not a secret.** It is embedded in a public page, so three controls compensate: an origin allowlist per tenant, rate limits per tenant and per session, and size and shape caps before any downstream cost. The endpoint is write-only with no query surface, so a leaked key lets someone send junk attributed to that tenant and nothing else. Checks run cheapest-first: size, parse, shape, rate limit (keyed on the public key, before any database round trip), then the key lookup, origin, and consent.

- [ ] **Step 1: Write the failing rate-limit test**

```ts
// ads-agent/lib/portal/rate-limit.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimits, SESSION_LIMIT_PER_MINUTE } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("checkRateLimit", () => {
  it("allows traffic inside the session limit", () => {
    for (let i = 0; i < SESSION_LIMIT_PER_MINUTE; i += 1) {
      expect(checkRateLimit("key-1", "sess-1", 1_000)).toBe(true);
    }
  });

  it("blocks the session once over the limit, in the same window", () => {
    for (let i = 0; i < SESSION_LIMIT_PER_MINUTE; i += 1) checkRateLimit("key-1", "sess-1", 1_000);
    expect(checkRateLimit("key-1", "sess-1", 1_000)).toBe(false);
  });

  it("does not let one session's abuse block another", () => {
    for (let i = 0; i <= SESSION_LIMIT_PER_MINUTE; i += 1) checkRateLimit("key-1", "sess-1", 1_000);
    expect(checkRateLimit("key-1", "sess-2", 1_000)).toBe(true);
  });

  it("resets on the next window", () => {
    for (let i = 0; i <= SESSION_LIMIT_PER_MINUTE; i += 1) checkRateLimit("key-1", "sess-1", 1_000);
    expect(checkRateLimit("key-1", "sess-1", 1_000 + 60_001)).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing ingest test**

```ts
// ads-agent/lib/portal/ingest.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const enqueueEvent = vi.fn().mockResolvedValue("outbox-1");
vi.mock("../db/outbox", () => ({ enqueueEvent: (...a: unknown[]) => enqueueEvent(...a) }));

const clientQuery = vi.fn();
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: clientQuery }),
}));

const getConsentStateCached = vi.fn();
vi.mock("./consent-cache", () => ({
  getConsentStateCached: (...a: unknown[]) => getConsentStateCached(...a),
  ensureConsentInvalidator: vi.fn().mockResolvedValue(undefined),
  cacheKey: (o: string, s: string) => `${o}:${s}`,
  invalidateConsent: vi.fn(),
}));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    taxonomy_version: 1,
    session_id: "abcdefabcdefabcdef01",
    events: [{ event: "listing_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: { listing_ref: "l-1", dwell_seconds: 5 } }],
    ...overrides,
  });
}

beforeEach(async () => {
  query.mockReset().mockResolvedValue({
    rows: [{
      org_id: ORG,
      allowed_origins: ["https://broker.example"],
      purposes_offered: ["space_recommendation", "site_analytics"],
      notice_version: 1,
    }],
  });
  clientQuery.mockReset().mockResolvedValue({ rows: [] });
  enqueueEvent.mockClear();
  getConsentStateCached.mockReset().mockResolvedValue({ purposes: ["space_recommendation"], latestAt: null });
  const { resetRateLimits } = await import("./rate-limit");
  resetRateLimits();
});

describe("ingest", () => {
  const good = { body: body(), ingestKey: "pk_live_broker", origin: "https://broker.example" };

  it("accepts a consented event and publishes it through the outbox", async () => {
    const { ingest } = await import("./ingest");
    const outcome = await ingest(good);
    expect(outcome).toMatchObject({ ok: true, accepted: 1 });
    expect(enqueueEvent).toHaveBeenCalledTimes(1);
    const [passedScope, , event] = enqueueEvent.mock.calls[0];
    expect(passedScope).toEqual({ kind: "org", orgId: ORG });
    expect(event.topic).toBe("portal.event");
    expect(event.payload).toMatchObject({
      org_id: ORG,
      event: "listing_view",
      purpose: "space_recommendation",
      session_id: "abcdefabcdefabcdef01",
      taxonomy_version: 1,
    });
  });

  it("rejects an unknown ingest key with 404, never 403", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { ingest } = await import("./ingest");
    expect(await ingest({ ...good, ingestKey: "pk_nope" })).toEqual({ ok: false, status: 404, reason: "unknown_key" });
  });

  it("rejects an origin the broker never registered", async () => {
    const { ingest } = await import("./ingest");
    expect(await ingest({ ...good, origin: "https://evil.example" })).toEqual({
      ok: false, status: 403, reason: "origin_not_allowed",
    });
  });

  it("rejects an event with no consent at all, and stores nothing", async () => {
    getConsentStateCached.mockResolvedValue({ purposes: [], latestAt: null });
    const { ingest } = await import("./ingest");
    expect(await ingest(good)).toEqual({ ok: false, status: 403, reason: "no_consent" });
    expect(enqueueEvent).not.toHaveBeenCalled();
  });

  it("rejects an event whose purpose is not the one consented to", async () => {
    getConsentStateCached.mockResolvedValue({ purposes: ["site_analytics"], latestAt: null });
    const { ingest } = await import("./ingest");
    expect(await ingest(good)).toEqual({ ok: false, status: 403, reason: "no_consent" });
    expect(enqueueEvent).not.toHaveBeenCalled();
  });

  it("rejects an event whose purpose the broker does not even offer", async () => {
    query.mockResolvedValue({
      rows: [{ org_id: ORG, allowed_origins: ["https://broker.example"], purposes_offered: ["site_analytics"], notice_version: 1 }],
    });
    getConsentStateCached.mockResolvedValue({ purposes: ["space_recommendation"], latestAt: null });
    const { ingest } = await import("./ingest");
    expect(await ingest(good)).toEqual({ ok: false, status: 403, reason: "no_consent" });
  });

  it("rejects a body over the size cap before parsing it", async () => {
    const { ingest } = await import("./ingest");
    const outcome = await ingest({ ...good, body: "x".repeat(9000) });
    expect(outcome).toEqual({ ok: false, status: 413, reason: "too_large" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects malformed json and an unknown event shape", async () => {
    const { ingest } = await import("./ingest");
    expect(await ingest({ ...good, body: "{not json" })).toEqual({ ok: false, status: 400, reason: "invalid_json" });
    expect(
      await ingest({ ...good, body: body({ events: [{ event: "scroll", occurred_at: "2026-08-12T09:00:00.000Z", payload: {} }] }) }),
    ).toEqual({ ok: false, status: 400, reason: "invalid_shape" });
  });

  it("rate limits before touching the database", async () => {
    const { ingest } = await import("./ingest");
    const { SESSION_LIMIT_PER_MINUTE } = await import("./rate-limit");
    for (let i = 0; i < SESSION_LIMIT_PER_MINUTE; i += 1) await ingest(good);
    const calls = query.mock.calls.length;
    expect(await ingest(good)).toEqual({ ok: false, status: 429, reason: "rate_limited" });
    expect(query.mock.calls.length).toBe(calls);
  });

  it("publishes only the consented events from a mixed batch", async () => {
    const { ingest } = await import("./ingest");
    const mixed = body({
      events: [
        { event: "listing_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: { listing_ref: "l-1", dwell_seconds: 5 } },
        { event: "contact_revealed", occurred_at: "2026-08-12T09:00:01.000Z", payload: { listing_ref: "l-1", channel: "phone" } },
      ],
    });
    const outcome = await ingest({ ...good, body: mixed });
    expect(outcome).toMatchObject({ ok: true, accepted: 1 });
    expect(enqueueEvent).toHaveBeenCalledTimes(1);
  });
});

describe("resolveIngestKey", () => {
  it("throws on org scope, because the lookup is inherently cross-tenant", async () => {
    const { resolveIngestKey } = await import("./config");
    await expect(resolveIngestKey({ kind: "org", orgId: ORG }, "pk")).rejects.toThrow("platform scope");
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `cd ads-agent && npx vitest run lib/portal/ingest.test.ts lib/portal/rate-limit.test.ts`
Expected: FAIL — `Failed to resolve import "./ingest"` and `"./rate-limit"`.

- [ ] **Step 4: Write the migration for rejection counters**

```sql
-- ads-agent/lib/db/migrations/061_ingest_rejection_counters.up.sql
BEGIN;

-- Rejected events are counted, never persisted (portal spec PI2). One row per
-- (org, reason, minute), so an abusive key costs one upsert per minute rather than
-- one write per request. org_id is nullable because a rejection can precede tenant
-- resolution -- that is the whole point of rejecting early.
CREATE TABLE IF NOT EXISTS context.ingest_rejection_counters (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        UUID,
  reason        TEXT NOT NULL,
  minute_bucket TIMESTAMPTZ NOT NULL,
  events        BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE context.ingest_rejection_counters
  DROP CONSTRAINT IF EXISTS ingest_rejection_counters_unique;
ALTER TABLE context.ingest_rejection_counters
  ADD CONSTRAINT ingest_rejection_counters_unique UNIQUE (org_id, reason, minute_bucket);

CREATE INDEX IF NOT EXISTS ingest_rejection_counters_recent_idx
  ON context.ingest_rejection_counters (org_id, minute_bucket DESC);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/061_ingest_rejection_counters.down.sql
BEGIN;
DROP TABLE IF EXISTS context.ingest_rejection_counters;
COMMIT;
```

Run: `psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/061_ingest_rejection_counters.up.sql`
Expected: `BEGIN`, `CREATE TABLE`, `ALTER TABLE`, `ALTER TABLE`, `CREATE INDEX`, `COMMIT`.

- [ ] **Step 5: Write the rate limiter**

```ts
// ads-agent/lib/portal/rate-limit.ts
type Bucket = { count: number; windowStart: number };

const WINDOW_MS = 60_000;
export const TENANT_LIMIT_PER_MINUTE = 6_000;
export const SESSION_LIMIT_PER_MINUTE = 120;

const tenantBuckets = new Map<string, Bucket>();
const sessionBuckets = new Map<string, Bucket>();

function take(buckets: Map<string, Bucket>, key: string, limit: number, now: number): boolean {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const bucket = buckets.get(key);
  if (!bucket || bucket.windowStart !== windowStart) {
    buckets.set(key, { count: 1, windowStart });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * ponytail: in-process counters. Ceiling: limits are per app instance, so N instances
 * permit N times the traffic. Upgrade path when that matters is a shared counter --
 * the caller contract does not change.
 */
export function checkRateLimit(ingestKey: string, sessionId: string, now: number = Date.now()): boolean {
  if (!take(sessionBuckets, `${ingestKey}:${sessionId}`, SESSION_LIMIT_PER_MINUTE, now)) return false;
  return take(tenantBuckets, ingestKey, TENANT_LIMIT_PER_MINUTE, now);
}

export function resetRateLimits(): void {
  tenantBuckets.clear();
  sessionBuckets.clear();
}
```

- [ ] **Step 6: Write the config resolver and the rejection counter**

```ts
// ads-agent/lib/portal/config.ts
import { getPool } from "../db/client";
import type { Scope } from "../db/scope-sql";

export type TenantPortalConfig = {
  orgId: string;
  allowedOrigins: string[];
  purposesOffered: string[];
  noticeVersion: number;
};

type Entry = { config: TenantPortalConfig | null; expiresAt: number };

const CONFIG_TTL_MS = 60_000;
const cache = new Map<string, Entry>();

/**
 * Platform scope for the one lookup that has no tenant yet. `scopeClause` yields TRUE
 * with no parameters for platform scope, so the org id here is never used in a
 * predicate; the zero UUID makes that explicit rather than implying a real tenant.
 */
export const PLATFORM_SCOPE: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000000" };

export function clearPortalConfigCache(): void {
  cache.clear();
}

/**
 * Platform scope only. The ingest key is a public identifier on an unauthenticated
 * request, so resolving it to a tenant necessarily happens before any tenant context
 * exists -- the same shape as listOrgBalances in S3. Passing org scope is a bug, so it
 * throws rather than silently returning nothing.
 */
export async function resolveIngestKey(scope: Scope, ingestKey: string): Promise<TenantPortalConfig | null> {
  if (scope.kind !== "platform") {
    throw new Error("resolveIngestKey requires platform scope: the key lookup precedes tenant context");
  }
  const now = Date.now();
  const hit = cache.get(ingestKey);
  if (hit && hit.expiresAt > now) return hit.config;

  const { rows } = await getPool().query<{
    org_id: string;
    allowed_origins: string[];
    purposes_offered: string[];
    notice_version: number;
  }>(
    `SELECT org_id::text AS org_id, allowed_origins, purposes_offered, notice_version
       FROM context.tenant_portal_config WHERE ingest_key = $1`,
    [ingestKey],
  );

  const config: TenantPortalConfig | null = rows[0]
    ? {
        orgId: rows[0].org_id,
        allowedOrigins: rows[0].allowed_origins,
        purposesOffered: rows[0].purposes_offered,
        noticeVersion: rows[0].notice_version,
      }
    : null;
  cache.set(ingestKey, { config, expiresAt: now + CONFIG_TTL_MS });
  return config;
}

export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  if (!origin) return false;
  return allowed.includes(origin);
}
```

```ts
// ads-agent/lib/portal/rejections.ts
import { getPool } from "../db/client";

export type RejectionReason =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "unknown_key"
  | "origin_not_allowed"
  | "rate_limited"
  | "no_consent";

type Key = string;
const pending = new Map<Key, { orgId: string | null; reason: RejectionReason; minute: string; count: number }>();

export function recordRejection(orgId: string | null, reason: RejectionReason): void {
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const key = `${orgId ?? "-"}|${reason}|${minute}`;
  const entry = pending.get(key);
  if (entry) entry.count += 1;
  else pending.set(key, { orgId, reason, minute, count: 1 });
}

export async function flushRejectionCounters(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending.values()];
  pending.clear();
  for (const row of batch) {
    await getPool().query(
      `INSERT INTO context.ingest_rejection_counters (org_id, reason, minute_bucket, events)
       VALUES ($1, $2, $3::timestamptz, $4)
       ON CONFLICT (org_id, reason, minute_bucket)
       DO UPDATE SET events = context.ingest_rejection_counters.events + EXCLUDED.events`,
      [row.orgId, row.reason, row.minute, row.count],
    );
  }
}

let flushTimer: NodeJS.Timeout | null = null;

export function startRejectionFlush(intervalMs = 5_000): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushRejectionCounters().catch((err) => console.error("rejection flush failed", err));
  }, intervalMs);
  flushTimer.unref();
}
```

- [ ] **Step 7: Write the gate**

```ts
// ads-agent/lib/portal/ingest.ts
import { randomUUID } from "node:crypto";
import { enqueueEvent } from "../db/outbox";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { originAllowed, PLATFORM_SCOPE, resolveIngestKey } from "./config";
import { ensureConsentInvalidator, getConsentStateCached } from "./consent-cache";
import { checkRateLimit } from "./rate-limit";
import { recordRejection, startRejectionFlush, type RejectionReason } from "./rejections";
import { envelopeSchema, MAX_BODY_BYTES, purposeFor } from "./taxonomy";

export type IngestInput = { body: string; ingestKey: string | null; origin: string | null };
export type IngestOutcome =
  | { ok: true; accepted: number; eventIds: string[] }
  | { ok: false; status: 400 | 403 | 404 | 413 | 429; reason: RejectionReason };

function reject(
  orgId: string | null,
  status: 400 | 403 | 404 | 413 | 429,
  reason: RejectionReason,
): IngestOutcome {
  recordRejection(orgId, reason);
  return { ok: false, status, reason };
}

export async function ingest(input: IngestInput): Promise<IngestOutcome> {
  startRejectionFlush();

  // Cheapest checks first: nothing below costs a database round trip until the key
  // lookup, and nothing costs storage until the publish.
  if (Buffer.byteLength(input.body, "utf8") > MAX_BODY_BYTES) return reject(null, 413, "too_large");
  if (!input.ingestKey) return reject(null, 404, "unknown_key");

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return reject(null, 400, "invalid_json");
  }

  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) return reject(null, 400, "invalid_shape");

  if (!checkRateLimit(input.ingestKey, envelope.data.session_id)) return reject(null, 429, "rate_limited");

  const config = await resolveIngestKey(PLATFORM_SCOPE, input.ingestKey);
  if (!config) return reject(null, 404, "unknown_key");
  if (!originAllowed(input.origin, config.allowedOrigins)) {
    return reject(config.orgId, 403, "origin_not_allowed");
  }

  const scope: Scope = { kind: "org", orgId: config.orgId };
  await ensureConsentInvalidator();
  const consent = await getConsentStateCached(scope, config.orgId, envelope.data.session_id);

  const permitted = envelope.data.events.filter((event) => {
    const purpose = purposeFor(event.event);
    return config.purposesOffered.includes(purpose) && consent.purposes.includes(purpose);
  });

  if (permitted.length === 0) return reject(config.orgId, 403, "no_consent");
  if (permitted.length < envelope.data.events.length) recordRejection(config.orgId, "no_consent");

  const eventIds = await withTenantTransaction(scope, async (client) => {
    const ids: string[] = [];
    for (const event of permitted) {
      const eventId = randomUUID();
      ids.push(eventId);
      await enqueueEvent(scope, client, {
        topic: "portal.event",
        payload: {
          event_id: eventId,
          org_id: config.orgId,
          event: event.event,
          purpose: purposeFor(event.event),
          session_id: envelope.data.session_id,
          taxonomy_version: envelope.data.taxonomy_version,
          occurred_at: event.occurred_at,
          payload: event.payload,
        },
      });
    }
    return ids;
  });

  return { ok: true, accepted: permitted.length, eventIds };
}
```

- [ ] **Step 8: Write the route**

```ts
// ads-agent/app/api/v1/ingest/route.ts
import { ingest } from "@/lib/portal/ingest";
import { originAllowed, PLATFORM_SCOPE, resolveIngestKey } from "@/lib/portal/config";
import { MAX_BODY_BYTES } from "@/lib/portal/taxonomy";

export const runtime = "nodejs";

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const ingestKey = req.headers.get("x-ingest-key");
  if (!ingestKey) return new Response(null, { status: 404 });
  const config = await resolveIngestKey(PLATFORM_SCOPE, ingestKey);
  if (!config || !originAllowed(origin, config.allowedOrigins)) return new Response(null, { status: 404 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const ingestKey = req.headers.get("x-ingest-key");

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413, headers: corsHeaders(origin) });
  }

  const body = await req.text();
  const outcome = await ingest({ body, ingestKey, origin });
  if (!outcome.ok) {
    return Response.json({ error: outcome.reason }, { status: outcome.status, headers: corsHeaders(origin) });
  }
  return Response.json({ accepted: outcome.accepted }, { status: 202, headers: corsHeaders(origin) });
}
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/portal/ingest.test.ts lib/portal/rate-limit.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 10: Commit**

```bash
git add ads-agent/lib/portal/config.ts ads-agent/lib/portal/rate-limit.ts ads-agent/lib/portal/rejections.ts ads-agent/lib/portal/ingest.ts ads-agent/app/api/v1/ingest/route.ts ads-agent/lib/portal/ingest.test.ts ads-agent/lib/portal/rate-limit.test.ts ads-agent/lib/db/migrations/061_*
git commit -m "feat(portal): consent-gated write-only ingestion edge

Checks run cheapest-first: size, parse, shape, rate limit, then the key
lookup, origin and consent -- so junk costs no database round trip and no
storage. No consent, withdrawn consent, and consent for a different purpose
are each rejected, proven by test. Unknown key returns 404, never 403."
```

## Task 13: The consent API route

**Skills:** `senior-backend`, `gdpr-dsgvo-expert`
**Model:** `composer-2.5-fast` — the code and tests are specified; the compliance reasoning is already settled in Task 10.

**Files:**
- Create: `ads-agent/app/api/v1/consent/route.ts`
- Test: `ads-agent/app/api/v1/consent/route.test.ts`

**Interfaces:**
- Consumes: `recordConsent` (Task 10), `resolveIngestKey`, `originAllowed` (Task 12).
- Produces: `POST /api/v1/consent` accepting `{ ingest_key, session_id, purposes, action, mechanism }`, returning `202` with `{ consent_id }`.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/app/api/v1/consent/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveIngestKey = vi.fn();
const recordConsent = vi.fn();
vi.mock("@/lib/portal/config", () => ({
  resolveIngestKey: (...a: unknown[]) => resolveIngestKey(...a),
  originAllowed: (origin: string | null, allowed: string[]) => Boolean(origin) && allowed.includes(origin!),
}));
vi.mock("@/lib/portal/consent", () => ({ recordConsent: (...a: unknown[]) => recordConsent(...a) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

function request(body: Record<string, unknown>, origin = "https://broker.example"): Request {
  return new Request("https://ads.example/api/v1/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

const grant = {
  ingest_key: "pk_live_broker",
  session_id: "abcdefabcdefabcdef01",
  purposes: ["space_recommendation"],
  action: "granted",
  mechanism: "banner",
};

beforeEach(() => {
  resolveIngestKey.mockReset().mockResolvedValue({
    orgId: ORG,
    allowedOrigins: ["https://broker.example"],
    purposesOffered: ["space_recommendation", "site_analytics"],
    noticeVersion: 3,
  });
  recordConsent.mockReset().mockResolvedValue("consent-1");
});

describe("POST /api/v1/consent", () => {
  it("records a grant with the tenant's current notice version", async () => {
    const { POST } = await import("./route");
    const res = await POST(request(grant));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ consent_id: "consent-1" });
    const [, input] = recordConsent.mock.calls[0];
    expect(input).toEqual({
      subjectRef: "abcdefabcdefabcdef01",
      purposes: ["space_recommendation"],
      action: "granted",
      noticeVersion: 3,
      mechanism: "banner",
    });
  });

  it("records a withdrawal", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ ...grant, action: "withdrawn" }));
    expect(res.status).toBe(202);
    expect(recordConsent.mock.calls[0][1].action).toBe("withdrawn");
  });

  it("returns 404 for an unknown key", async () => {
    resolveIngestKey.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(request(grant))).status).toBe(404);
  });

  it("returns 403 for an unregistered origin", async () => {
    const { POST } = await import("./route");
    expect((await POST(request(grant, "https://evil.example"))).status).toBe(403);
  });

  it("rejects a purpose the broker does not offer", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ ...grant, purposes: ["enquiry_handling"] }));
    expect(res.status).toBe(400);
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("rejects an unknown action rather than storing it", async () => {
    const { POST } = await import("./route");
    expect((await POST(request({ ...grant, action: "maybe" }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run app/api/v1/consent/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Write the route**

```ts
// ads-agent/app/api/v1/consent/route.ts
import { z } from "zod";
import type { Scope } from "@/lib/db/scope-sql";
import { originAllowed, PLATFORM_SCOPE, resolveIngestKey } from "@/lib/portal/config";
import { recordConsent } from "@/lib/portal/consent";
import { PURPOSES } from "@/lib/portal/taxonomy";

export const runtime = "nodejs";

const bodySchema = z.object({
  ingest_key: z.string().min(8).max(128),
  session_id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  purposes: z.array(z.enum(PURPOSES)).min(1).max(PURPOSES.length),
  action: z.enum(["granted", "withdrawn"]),
  mechanism: z.enum(["banner", "form", "consent_manager"]),
});

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const headers = cors(origin);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid_shape" }, { status: 400, headers });

  const config = await resolveIngestKey(PLATFORM_SCOPE, parsed.data.ingest_key);
  if (!config) return Response.json({ error: "unknown_key" }, { status: 404, headers });
  if (!originAllowed(origin, config.allowedOrigins)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403, headers });
  }

  // A broker cannot obtain consent for a purpose their notice never offered.
  const offered = parsed.data.purposes.every((p) => config.purposesOffered.includes(p));
  if (!offered) return Response.json({ error: "purpose_not_offered" }, { status: 400, headers });

  const scope: Scope = { kind: "org", orgId: config.orgId };
  const consentId = await recordConsent(scope, {
    subjectRef: parsed.data.session_id,
    purposes: parsed.data.purposes,
    action: parsed.data.action,
    // The version shown is the tenant's current one, taken server-side: a client
    // claiming it saw notice version 1 is not evidence of anything.
    noticeVersion: config.noticeVersion,
    mechanism: parsed.data.mechanism,
  });

  return Response.json({ consent_id: consentId }, { status: 202, headers });
}
```

- [ ] **Step 4: Run the test and commit**

Run: `cd ads-agent && npx vitest run app/api/v1/consent/route.test.ts`
Expected: PASS, 6 tests.

```bash
git add ads-agent/app/api/v1/consent
git commit -m "feat(consent): public grant and withdrawal endpoint

Notice version is taken server-side from the tenant's configuration: a client
claiming which notice it displayed is not evidence. A purpose the broker's
notice never offered cannot be consented to."
```

## Task 14: The `derived` schema quarantine (dataflow A-5)

**Skills:** `postgres-pro`, `senior-data-engineer`, `adversarial-reviewer`
**Model:** `inherit` — the quarantine is enforced by catalogue assertions that have to be reasoned about, not copied.

**Files:**
- Create: `ads-agent/lib/db/migrations/056_derived_portal_sessions.up.sql` / `.down.sql`
- Create: `lib/clickhouse/project-derived.ts`
- Test: `lib/clickhouse/project-derived.test.ts`
- Test: `ads-agent/lib/db/derived-quarantine.test.ts`

**Interfaces:**
- Consumes: `chQuery` (Task 1); `raw.portal_events` (Task 9); `type Scope` from `lib/db/scope.ts` and `withTenantTransaction` from `lib/db/tx.ts` (S5a Task 11).
- Produces:
  - `rebuildPortalSessionSpaces(scope: Scope, options?: { sinceDays?: number }): Promise<number>` — returns rows written
  - table `derived.portal_session_spaces`

**Context — why this is a quarantine.** Clickstream is owned by ClickHouse. Anything projected back into Postgres from it is a convenience, not a record: truncatable and rebuildable at any time, never the input to another derivation, and never the sole justification for a proposal. Without the boundary, observational data quietly acquires the authority of fact. The boundary is enforced by three catalogue assertions rather than by a comment, because a comment does not fail a build.

**Note on the `Scope` constraint.** The root app's `Scope` and `withTenantTransaction` come from S5a Task 11 (`lib/db/scope.ts`, `lib/db/tx.ts`), which are deliberate duplicates of the `ads-agent` originals because there is no shared package. Use them; do not add a third transaction wrapper.

- [ ] **Step 1: Write the failing quarantine test**

```ts
// ads-agent/lib/db/derived-quarantine.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

const live = Boolean(process.env.TEST_DATABASE_URL);
let pool: Pool;

beforeAll(async () => {
  if (live) pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
});
afterAll(async () => {
  if (live) await pool.end();
});

describe.skipIf(!live)("derived schema is a quarantine", () => {
  it("has at least one table, so this suite is not vacuously green", async () => {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'derived' AND c.relkind = 'r'`,
    );
    expect(Number(rows[0].c)).toBeGreaterThan(0);
  });

  it("is never the input to another derivation: no view outside derived reads it", async () => {
    const { rows } = await pool.query<{ dependent_object: string }>(
      `SELECT DISTINCT dn.nspname || '.' || dependent.relname AS dependent_object
         FROM pg_depend d
         JOIN pg_rewrite r      ON r.oid = d.objid
         JOIN pg_class dependent ON dependent.oid = r.ev_class
         JOIN pg_namespace dn    ON dn.oid = dependent.relnamespace
         JOIN pg_class source    ON source.oid = d.refobjid
         JOIN pg_namespace sn    ON sn.oid = source.relnamespace
        WHERE sn.nspname = 'derived' AND dn.nspname <> 'derived'`,
    );
    expect(rows.map((r) => r.dependent_object)).toEqual([]);
  });

  it("no table outside derived has a foreign key into it", async () => {
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t   ON t.oid = c.conrelid
         JOIN pg_namespace n  ON n.oid = t.relnamespace
         JOIN pg_class rt  ON rt.oid = c.confrelid
         JOIN pg_namespace rn ON rn.oid = rt.relnamespace
        WHERE c.contype = 'f' AND rn.nspname = 'derived' AND n.nspname <> 'derived'`,
    );
    expect(rows.map((r) => r.conname)).toEqual([]);
  });

  it("forces RLS on every derived table, because these rows are personal data too", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'derived' AND c.relkind = 'r'
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });

  it("says so on the schema, so a reader of the catalogue learns the rule", async () => {
    const { rows } = await pool.query<{ description: string | null }>(
      `SELECT obj_description(oid, 'pg_namespace') AS description FROM pg_namespace WHERE nspname = 'derived'`,
    );
    expect(rows[0].description).toContain("truncatable");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/derived-quarantine.test.ts`
Expected: FAIL — the first assertion, `expected 0 to be greater than 0` (no derived table exists yet).

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/056_derived_portal_sessions.up.sql
BEGIN;

COMMENT ON SCHEMA derived IS
  'Quarantine (dataflow review A-5). Tables projected into Postgres from observational '
  'stores. Every table here is truncatable and rebuildable at any time, is never the '
  'input to another derivation, and must never be the sole justification for a proposal. '
  'A table in derived is a convenience, not a record.';

CREATE TABLE IF NOT EXISTS derived.portal_session_spaces (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  session_id     TEXT NOT NULL,
  listing_ref    TEXT NOT NULL,
  view_count     INTEGER NOT NULL DEFAULT 0,
  dwell_seconds  INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ NOT NULL,
  rebuilt_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- listing_ref is deliberately TEXT with no foreign key into listings.listings: a
-- derived row must never be able to block or cascade a delete in a source of truth.
ALTER TABLE derived.portal_session_spaces
  DROP CONSTRAINT IF EXISTS portal_session_spaces_unique;
ALTER TABLE derived.portal_session_spaces
  ADD CONSTRAINT portal_session_spaces_unique UNIQUE (org_id, session_id, listing_ref);

CREATE INDEX IF NOT EXISTS portal_session_spaces_org_session_idx
  ON derived.portal_session_spaces (org_id, session_id, last_viewed_at DESC);

ALTER TABLE derived.portal_session_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived.portal_session_spaces FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON derived.portal_session_spaces;
CREATE POLICY tenant_isolation ON derived.portal_session_spaces
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/056_derived_portal_sessions.down.sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON derived.portal_session_spaces;
DROP TABLE IF EXISTS derived.portal_session_spaces;
COMMENT ON SCHEMA derived IS NULL;
COMMIT;
```

Run: `psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/056_derived_portal_sessions.up.sql`
Expected: `BEGIN`, `COMMENT`, `CREATE TABLE`, `ALTER TABLE`, `ALTER TABLE`, `CREATE INDEX`, `ALTER TABLE`, `ALTER TABLE`, `DROP POLICY`, `CREATE POLICY`, `COMMIT`.

Run: `cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/derived-quarantine.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 4: Write the failing projection test**

```ts
// lib/clickhouse/project-derived.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const chQuery = vi.fn();
vi.mock("./client", () => ({ chQuery: (...a: unknown[]) => chQuery(...a) }));

const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: clientQuery }),
}));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(() => {
  chQuery.mockReset();
  clientQuery.mockReset().mockResolvedValue({ rows: [] });
});

describe("rebuildPortalSessionSpaces", () => {
  it("truncates the tenant's rows before inserting, because the table is rebuildable", async () => {
    chQuery.mockResolvedValue([
      { session_id: "sess-1", listing_ref: "l-1", view_count: "2", dwell_seconds: "40", last_viewed_at: "2026-08-12 09:00:00" },
    ]);
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    const written = await rebuildPortalSessionSpaces(scope);

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("DELETE FROM derived.portal_session_spaces"))).toBe(true);
    const deleteIndex = statements.findIndex((s) => s.includes("DELETE FROM"));
    const insertIndex = statements.findIndex((s) => s.includes("INSERT INTO derived.portal_session_spaces"));
    expect(deleteIndex).toBeLessThan(insertIndex);
    expect(written).toBe(1);
  });

  it("reads only listing_view events for the requested tenant", async () => {
    chQuery.mockResolvedValue([]);
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    await rebuildPortalSessionSpaces(scope);
    const [sql, options] = chQuery.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(sql).toContain("raw.portal_events");
    expect(sql).toContain("listing_view");
    expect(options.params.org).toBe(ORG);
  });

  it("writes nothing when the tenant has no clickstream, and still truncates", async () => {
    chQuery.mockResolvedValue([]);
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    expect(await rebuildPortalSessionSpaces(scope)).toBe(0);
    expect(clientQuery.mock.calls.map(([sql]) => String(sql)).some((s) => s.includes("DELETE FROM"))).toBe(true);
  });

  it("refuses platform scope, because a projection has to name its tenant", async () => {
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    await expect(rebuildPortalSessionSpaces({ kind: "platform", orgId: ORG })).rejects.toThrow("org scope");
  });
});
```

- [ ] **Step 5: Write the projection**

```ts
// lib/clickhouse/project-derived.ts
import type { Scope } from "../db/scope";
import { withTenantTransaction } from "../db/tx";
import { chQuery } from "./client";

type SessionSpaceRow = {
  session_id: string;
  listing_ref: string;
  view_count: string;
  dwell_seconds: string;
  last_viewed_at: string;
};

/**
 * Projects "spaces this visitor viewed" from ClickHouse into the derived quarantine.
 * Truncate-then-insert per tenant, because a derived table is rebuildable by
 * definition; an incremental merge would make it stateful and therefore a record.
 */
export async function rebuildPortalSessionSpaces(
  scope: Scope,
  options: { sinceDays?: number } = {},
): Promise<number> {
  if (scope.kind !== "org") {
    throw new Error("rebuildPortalSessionSpaces requires org scope: a projection is per tenant");
  }
  const orgId = scope.orgId;
  const sinceDays = options.sinceDays ?? 30;

  const rows = await chQuery<SessionSpaceRow>(
    `SELECT session_id,
            JSONExtractString(payload, 'listing_ref')                    AS listing_ref,
            toString(count())                                            AS view_count,
            toString(sum(JSONExtractUInt(payload, 'dwell_seconds')))      AS dwell_seconds,
            formatDateTime(max(occurred_at), '%Y-%m-%d %H:%i:%S')         AS last_viewed_at
       FROM raw.portal_events
      WHERE org_id = {org:UUID}
        AND event = 'listing_view'
        AND occurred_at >= now() - toIntervalDay({days:UInt16})
      GROUP BY session_id, listing_ref
      HAVING listing_ref != ''`,
    { params: { org: orgId, days: String(sinceDays) } },
  );

  return withTenantTransaction(scope, async (client) => {
    await client.query("DELETE FROM derived.portal_session_spaces WHERE org_id = $1", [orgId]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO derived.portal_session_spaces
           (org_id, session_id, listing_ref, view_count, dwell_seconds, last_viewed_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
        [orgId, row.session_id, row.listing_ref, Number(row.view_count), Number(row.dwell_seconds), row.last_viewed_at],
      );
    }
    return rows.length;
  });
}
```

- [ ] **Step 6: Run the tests and commit**

Run: `npx vitest run lib/clickhouse/project-derived.test.ts`
Expected: PASS, 4 tests.

Run: `cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/derived-quarantine.test.ts`
Expected: PASS, 5 tests.

```bash
git add ads-agent/lib/db/migrations/056_* ads-agent/lib/db/derived-quarantine.test.ts lib/clickhouse/project-derived.ts lib/clickhouse/project-derived.test.ts
git commit -m "feat(derived): clickstream projection inside an enforced quarantine

A-5 enforced by catalogue assertions rather than a comment: nothing outside
the schema may read a derived table through a view, nothing may hold a
foreign key into it, and every table forces RLS. listing_ref is TEXT with no
FK so a convenience row can never block a delete in a source of truth."
```

## Task 15: Withdrawal takes effect within seconds — measured

**Skills:** `senior-qa`, `tdd-guide`, `performance-engineer`
**Model:** `inherit` — this is the hardest requirement in the plan and its failure modes are subtle.

**Files:**
- Test: `ads-agent/lib/portal/withdrawal-latency.test.ts`

**Interfaces:**
- Consumes: `startConsentInvalidator`, `getConsentStateCached`, `clearConsentCache`, `consentCacheTtlMs` (Task 10); `recordConsent` (Task 10); `POST` from `ads-agent/app/api/v1/ingest/route.ts` (Task 12).
- Produces: nothing importable; the measurement that the gate's second half rests on.

**Context — why a flag check is not enough.** "A withdrawn consent stops it within seconds" is a latency claim. A test that inserts a withdrawal and then asserts the state is empty proves only that the row was written; it passes identically whether invalidation takes 40 ms or 40 minutes, because the assertion runs after an `await` that has no deadline. Three things make the measurement real:

1. **The cache TTL is set to 60 s for the duration of the test.** Any pass inside that window can only have come from `LISTEN/NOTIFY` invalidation. If the notify trigger were dropped, the test would fail on time rather than on correctness.
2. **The elapsed time is measured and asserted**, from the moment the withdrawal commits to the first observation of the new state.
3. **A control case runs with no invalidator attached** and asserts the stale value survives past the budget — proving the test can actually fail. Without the control, a test that passes for the wrong reason is indistinguishable from one that passes for the right one.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/portal/withdrawal-latency.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

const live = Boolean(process.env.TEST_DATABASE_URL);

// Deliberately far longer than the budget: a pass inside the budget can only come
// from NOTIFY-driven invalidation, never from expiry.
const TTL_MS = 60_000;
const BUDGET_MS = 2_000;

let pool: Pool;
let orgId: string;
let ingestKey: string;

const SESSION = "withdrawlatency00001";
const scopeFor = (org: string) => ({ kind: "org", orgId: org }) as const;

beforeAll(async () => {
  if (!live) return;
  process.env.CONSENT_CACHE_TTL_MS = String(TTL_MS);
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  orgId = (await pool.query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")).rows[0].id;
  ingestKey = `pk_test_${Date.now()}`;
  await pool.query(
    `INSERT INTO context.tenant_portal_config
       (org_id, ingest_key, allowed_origins, purposes_offered, notice_version)
     VALUES ($1, $2, ARRAY['https://broker.test'], ARRAY['space_recommendation'], 1)
     ON CONFLICT (org_id) DO UPDATE
       SET ingest_key = EXCLUDED.ingest_key,
           allowed_origins = EXCLUDED.allowed_origins,
           purposes_offered = EXCLUDED.purposes_offered`,
    [orgId, ingestKey],
  );
});

afterAll(async () => {
  if (!live) return;
  delete process.env.CONSENT_CACHE_TTL_MS;
  await pool.end();
});

beforeEach(async () => {
  if (!live) return;
  const { clearConsentCache } = await import("./consent-cache");
  clearConsentCache();
  const { clearPortalConfigCache } = await import("./config");
  clearPortalConfigCache();
  const { resetRateLimits } = await import("./rate-limit");
  resetRateLimits();
});

async function grant(): Promise<void> {
  const { recordConsent } = await import("./consent");
  await recordConsent(scopeFor(orgId), {
    subjectRef: SESSION,
    purposes: ["space_recommendation"],
    action: "granted",
    noticeVersion: 1,
    mechanism: "banner",
  });
}

/** Withdraws from a second pool, so the process under test learns about it only
 *  through the database — exactly as a broker's withdrawal route would. */
async function withdrawFromElsewhere(): Promise<number> {
  const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    await other.query("BEGIN");
    await other.query("SELECT public.set_tenant($1)", [orgId]);
    await other.query(
      `INSERT INTO context.consent_records
         (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, $2, ARRAY['space_recommendation'], 'withdrawn', 1, 'banner')`,
      [orgId, SESSION],
    );
    await other.query("COMMIT");
    return performance.now();
  } finally {
    await other.end();
  }
}

function ingestRequest(): Request {
  return new Request("https://ads.test/api/v1/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://broker.test", "X-Ingest-Key": ingestKey },
    body: JSON.stringify({
      taxonomy_version: 1,
      session_id: SESSION,
      events: [{ event: "listing_view", occurred_at: new Date().toISOString(), payload: { listing_ref: "l-1", dwell_seconds: 1 } }],
    }),
  });
}

describe.skipIf(!live)("withdrawal takes effect within seconds", () => {
  it("invalidates the consent cache within the budget, and the TTL cannot be the reason", async () => {
    const { getConsentStateCached, startConsentInvalidator, consentCacheTtlMs } = await import("./consent-cache");
    expect(consentCacheTtlMs()).toBe(TTL_MS);

    const stop = await startConsentInvalidator(pool);
    try {
      await grant();
      const primed = await getConsentStateCached(scopeFor(orgId), orgId, SESSION);
      expect(primed.purposes).toContain("space_recommendation");

      const withdrawnAt = await withdrawFromElsewhere();
      let observedAt: number | null = null;
      while (performance.now() - withdrawnAt < BUDGET_MS + 500) {
        const state = await getConsentStateCached(scopeFor(orgId), orgId, SESSION);
        if (!state.purposes.includes("space_recommendation")) {
          observedAt = performance.now();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(observedAt, "withdrawal was never observed").not.toBeNull();
      const elapsed = observedAt! - withdrawnAt;
      console.log(`withdrawal observed after ${elapsed.toFixed(0)}ms (budget ${BUDGET_MS}ms, ttl ${TTL_MS}ms)`);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    } finally {
      await stop();
    }
  }, 30_000);

  it("control: with no invalidator attached, the stale grant survives past the budget", async () => {
    const { getConsentStateCached, clearConsentCache } = await import("./consent-cache");
    clearConsentCache();
    await grant();
    await getConsentStateCached(scopeFor(orgId), orgId, SESSION);

    const withdrawnAt = await withdrawFromElsewhere();
    await new Promise((resolve) => setTimeout(resolve, BUDGET_MS));
    const state = await getConsentStateCached(scopeFor(orgId), orgId, SESSION);

    expect(performance.now() - withdrawnAt).toBeGreaterThanOrEqual(BUDGET_MS);
    expect(
      state.purposes,
      "control failed: the cache expired on its own, so the first test proves nothing about NOTIFY",
    ).toContain("space_recommendation");
  }, 30_000);

  it("the endpoint stops accepting the event within the budget", async () => {
    const { startConsentInvalidator } = await import("./consent-cache");
    const { POST } = await import("../../app/api/v1/ingest/route");

    const stop = await startConsentInvalidator(pool);
    try {
      await grant();
      const accepted = await POST(ingestRequest());
      expect(accepted.status).toBe(202);

      const withdrawnAt = await withdrawFromElsewhere();
      let rejectedAt: number | null = null;
      let lastStatus = 0;
      while (performance.now() - withdrawnAt < BUDGET_MS + 500) {
        const res = await POST(ingestRequest());
        lastStatus = res.status;
        if (res.status === 403) {
          expect(await res.json()).toEqual({ error: "no_consent" });
          rejectedAt = performance.now();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(rejectedAt, `endpoint still returning ${lastStatus} after the budget`).not.toBeNull();
      const elapsed = rejectedAt! - withdrawnAt;
      console.log(`endpoint refused after ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    } finally {
      await stop();
    }
  }, 30_000);
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Temporarily drop the notify trigger, so the failure is the one the test exists to catch:

```bash
psql "$DATABASE_URL" -c "DROP TRIGGER consent_records_notify ON context.consent_records"
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/portal/withdrawal-latency.test.ts
```
Expected: FAIL on the first and third tests with `withdrawal was never observed` / `endpoint still returning 202 after the budget`; the control test PASSES. That combination is the proof the measurement is real: without invalidation the budget is missed, and the cache does not expire on its own inside the window.

- [ ] **Step 3: Restore the trigger and run again**

```bash
psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/054_consent_records.up.sql
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/portal/withdrawal-latency.test.ts
```
Expected: PASS, 3 tests, with two console lines of the form `withdrawal observed after 40ms (budget 2000ms, ttl 60000ms)` and `endpoint refused after 55ms`. Record both numbers in the commit message.

- [ ] **Step 4: Commit**

```bash
git add ads-agent/lib/portal/withdrawal-latency.test.ts
git commit -m "test(consent): measure that withdrawal stops collection within seconds

Three tests, not one. The cache TTL is forced to 60s so a pass inside the
2s budget can only come from NOTIFY invalidation; the elapsed time is
measured from commit to first observation; and a control with no invalidator
asserts the stale grant survives past the budget, so the measurement can
actually fail. Observed: cache <Xms>, endpoint <Yms>."
```

## Task 16: The pseudonymity link and erasure expansion

**Skills:** `postgres-pro`, `gdpr-dsgvo-expert`, `senior-backend`
**Model:** `inherit` — §5 is a correctness requirement with retrospective consequences, not a legal footnote.

**Files:**
- Create: `ads-agent/lib/db/migrations/057_session_links.up.sql` / `.down.sql`
- Create: `ads-agent/lib/portal/session-links.ts`
- Modify: `ads-agent/lib/portal/ingest.ts` (the publish loop, to link on `enquiry_submitted`)
- Test: `ads-agent/lib/portal/session-links.test.ts`

**Interfaces:**
- Consumes: `adsagent.enquiries` (S4); `scopeClause`, `type Scope` (S3); `ingest` (Task 12).
- Produces:
  - `linkSession(scope: Scope, input: { sessionId: string; enquiryId: string }, client?: PoolClient): Promise<void>`
  - `sessionsForEnquiry(scope: Scope, enquiryId: string): Promise<string[]>`
  - `erasureSubjects(scope: Scope, subjectRef: string): Promise<{ enquiryIds: string[]; sessionIds: string[] }>`
  - `unlinkedSessionsOlderThan(scope: Scope, days: number): Promise<string[]>`
  - table `context.session_links`

**Context — the trap, and what it forces.** Clickstream is collected against a `session_id`, not a person, and that is genuinely pseudonymous — **until the visitor submits an enquiry.** At that moment the session becomes linkable to a named individual with a phone number, and every prior event in it becomes personal data retrospectively. Three consequences, all implemented here: the link is recorded explicitly when it happens; erasure for an enquirer covers **their linked sessions**, not just the enquiry row; and unlinked sessions still expire on a schedule, because pseudonymous is not exempt.

**Note on a spec tension.** Portal spec §8 declares `context.session_links` with a composite primary key `(org_id, session_id, enquiry_id)` and no surrogate id, which is narrower than this plan's `id UUID PRIMARY KEY DEFAULT uuidv7()` convention. The spec's explicit DDL wins: a surrogate key on a pure link table buys nothing and would weaken the natural uniqueness the composite key states. The convention is followed everywhere it has latitude.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/portal/session-links.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const ENQUIRY = "eeeeeeee-0000-4000-8000-00000000000e";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(() => query.mockReset());

describe("linkSession", () => {
  it("records the link idempotently, because the event can be delivered twice", async () => {
    query.mockResolvedValue({ rows: [] });
    const { linkSession } = await import("./session-links");
    await linkSession(scope, { sessionId: "sess-1", enquiryId: ENQUIRY });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("context.session_links");
    expect(sql).toContain("ON CONFLICT");
    expect(params).toEqual([ORG, "sess-1", ENQUIRY]);
  });
});

describe("erasureSubjects", () => {
  it("expands an enquiry into the enquiry and every session linked to it", async () => {
    query.mockResolvedValueOnce({ rows: [{ session_id: "sess-1" }, { session_id: "sess-2" }] });
    const { erasureSubjects } = await import("./session-links");
    expect(await erasureSubjects(scope, ENQUIRY)).toEqual({
      enquiryIds: [ENQUIRY],
      sessionIds: ["sess-1", "sess-2"],
    });
  });

  it("expands a session into the session and every enquiry it was linked to", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })                       // not an enquiry id
      .mockResolvedValueOnce({ rows: [{ enquiry_id: ENQUIRY }] }); // linked enquiries
    const { erasureSubjects } = await import("./session-links");
    expect(await erasureSubjects(scope, "sess-1")).toEqual({
      enquiryIds: [ENQUIRY],
      sessionIds: ["sess-1"],
    });
  });

  it("returns the subject alone when nothing is linked, never an empty set", async () => {
    query.mockResolvedValue({ rows: [] });
    const { erasureSubjects } = await import("./session-links");
    expect(await erasureSubjects(scope, "sess-lonely")).toEqual({
      enquiryIds: [],
      sessionIds: ["sess-lonely"],
    });
  });
});

describe("unlinkedSessionsOlderThan", () => {
  it("asks only for sessions with no link row, because pseudonymous is not exempt", async () => {
    query.mockResolvedValue({ rows: [{ session_id: "sess-old" }] });
    const { unlinkedSessionsOlderThan } = await import("./session-links");
    expect(await unlinkedSessionsOlderThan(scope, 90)).toEqual(["sess-old"]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("context.session_links");
    expect(params).toContain(90);
  });
});

describe("ingest links a submitted enquiry to its session", () => {
  it("writes the link in the same transaction as the publish", async () => {
    vi.resetModules();
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock("../db/client", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({
          rows: [{
            org_id: ORG,
            allowed_origins: ["https://broker.example"],
            purposes_offered: ["enquiry_handling"],
            notice_version: 1,
          }],
        }),
      }),
    }));
    vi.doMock("../db/tx", () => ({
      withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
        fn({ query: clientQuery }),
    }));
    vi.doMock("../db/outbox", () => ({ enqueueEvent: vi.fn().mockResolvedValue("outbox-1") }));
    vi.doMock("./consent-cache", () => ({
      getConsentStateCached: vi.fn().mockResolvedValue({ purposes: ["enquiry_handling"], latestAt: null }),
      ensureConsentInvalidator: vi.fn().mockResolvedValue(undefined),
      cacheKey: (o: string, s: string) => `${o}:${s}`,
      invalidateConsent: vi.fn(),
    }));

    const { ingest } = await import("./ingest");
    const outcome = await ingest({
      ingestKey: "pk_live_broker",
      origin: "https://broker.example",
      body: JSON.stringify({
        taxonomy_version: 1,
        session_id: "abcdefabcdefabcdef01",
        events: [{ event: "enquiry_submitted", occurred_at: "2026-08-12T09:00:00.000Z", payload: { enquiry_ref: ENQUIRY } }],
      }),
    });

    expect(outcome).toMatchObject({ ok: true, accepted: 1 });
    // The link is written on the transaction's client, not on the pool: that is what
    // makes it impossible for the link to exist without the event, or vice versa.
    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("context.session_links"))).toBe(true);
    expect(statements.some((s) => s.includes("ON CONFLICT"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/portal/session-links.test.ts`
Expected: FAIL — `Failed to resolve import "./session-links"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/057_session_links.up.sql
BEGIN;

-- The pseudonymity link (portal spec §5). Composite primary key exactly as declared
-- in the spec's §8 DDL: this is a pure link table and the natural key is the
-- uniqueness constraint that matters.
CREATE TABLE IF NOT EXISTS context.session_links (
  org_id     public.org_ref NOT NULL REFERENCES public.orgs(id),
  session_id TEXT NOT NULL,
  enquiry_id UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id, enquiry_id)
);

CREATE INDEX IF NOT EXISTS session_links_org_enquiry_idx
  ON context.session_links (org_id, enquiry_id);

ALTER TABLE context.session_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.session_links FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.session_links;
CREATE POLICY tenant_isolation ON context.session_links
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/057_session_links.down.sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON context.session_links;
DROP TABLE IF EXISTS context.session_links;
COMMIT;
```

Run: `psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/057_session_links.up.sql`
Expected: `BEGIN`, `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `ALTER TABLE`, `DROP POLICY`, `CREATE POLICY`, `COMMIT`.

- [ ] **Step 4: Write the module**

```ts
// ads-agent/lib/portal/session-links.ts
import type { PoolClient } from "pg";
import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";

export async function linkSession(
  scope: Scope,
  input: { sessionId: string; enquiryId: string },
  client?: PoolClient,
): Promise<void> {
  if (scope.kind !== "org") throw new Error("linkSession requires org scope");
  const runner = client ?? getPool();
  await runner.query(
    `INSERT INTO context.session_links (org_id, session_id, enquiry_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, session_id, enquiry_id) DO NOTHING`,
    [scope.orgId, input.sessionId, input.enquiryId],
  );
}

export async function sessionsForEnquiry(scope: Scope, enquiryId: string): Promise<string[]> {
  const clause = scopeClause(scope, "org_id");
  const { rows } = await getPool().query<{ session_id: string }>(
    `SELECT session_id FROM context.session_links
      WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1}::uuid
      ORDER BY session_id`,
    [...clause.params, enquiryId],
  );
  return rows.map((r) => r.session_id);
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Erasure for an enquirer covers their linked sessions, not just the enquiry row:
 * once a session is linked, every prior event in it is personal data retrospectively.
 * Works from either end -- an enquiry id expands to its sessions, a session id
 * expands to the enquiries it reached.
 */
export async function erasureSubjects(
  scope: Scope,
  subjectRef: string,
): Promise<{ enquiryIds: string[]; sessionIds: string[] }> {
  if (UUID_SHAPE.test(subjectRef)) {
    const sessionIds = await sessionsForEnquiry(scope, subjectRef);
    return { enquiryIds: [subjectRef], sessionIds };
  }

  const clause = scopeClause(scope, "org_id");
  const { rows } = await getPool().query<{ enquiry_id: string }>(
    `SELECT enquiry_id::text AS enquiry_id FROM context.session_links
      WHERE ${clause.sql} AND session_id = $${clause.params.length + 1}
      ORDER BY enquiry_id`,
    [...clause.params, subjectRef],
  );
  return { enquiryIds: rows.map((r) => r.enquiry_id), sessionIds: [subjectRef] };
}

/**
 * Unlinked sessions still expire: "pseudonymous" is not "exempt" while
 * re-identification remains possible.
 */
export async function unlinkedSessionsOlderThan(scope: Scope, days: number): Promise<string[]> {
  const clause = scopeClause(scope, "l.org_id");
  const { rows } = await getPool().query<{ session_id: string }>(
    `SELECT DISTINCT l.session_id
       FROM derived.portal_session_spaces l
      WHERE ${clause.sql}
        AND l.last_viewed_at < now() - make_interval(days => $${clause.params.length + 1})
        AND NOT EXISTS (
          SELECT 1 FROM context.session_links sl
           WHERE sl.org_id = l.org_id AND sl.session_id = l.session_id
        )`,
    [...clause.params, days],
  );
  return rows.map((r) => r.session_id);
}
```

- [ ] **Step 5: Wire the link into the ingest publish loop**

In `ads-agent/lib/portal/ingest.ts`, add the import and extend the loop body. The link and the publish share one transaction, so a session can never be recorded as linked without its event existing, or vice versa.

```ts
// ads-agent/lib/portal/ingest.ts — add to the imports
import { linkSession } from "./session-links";
```

```ts
// ads-agent/lib/portal/ingest.ts — replace the body of the `for (const event of permitted)` loop
    for (const event of permitted) {
      const eventId = randomUUID();
      ids.push(eventId);
      await enqueueEvent(scope, client, {
        topic: "portal.event",
        payload: {
          event_id: eventId,
          org_id: config.orgId,
          event: event.event,
          purpose: purposeFor(event.event),
          session_id: envelope.data.session_id,
          taxonomy_version: envelope.data.taxonomy_version,
          occurred_at: event.occurred_at,
          payload: event.payload,
        },
      });

      // The moment the session stops being pseudonymous, recorded explicitly and in
      // the same transaction as the event that caused it (portal spec §5).
      if (event.event === "enquiry_submitted") {
        await linkSession(
          scope,
          { sessionId: envelope.data.session_id, enquiryId: event.payload.enquiry_ref },
          client,
        );
      }
    }
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/portal/session-links.test.ts lib/portal/ingest.test.ts`
Expected: PASS — 5 session-link tests plus the 11 from Task 12, still green.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migrations/057_* ads-agent/lib/portal/session-links.ts ads-agent/lib/portal/session-links.test.ts ads-agent/lib/portal/ingest.ts
git commit -m "feat(portal): record the pseudonymity link and expand erasure through it

A session is pseudonymous until an enquiry is submitted, after which every
prior event in it is personal data retrospectively. The link is written in
the same transaction as the event that causes it, erasure expands from
either end, and unlinked sessions still have an expiry path."
```

## Task 17: First-party consent surface

**Skills:** `senior-frontend`, `gdpr-dsgvo-expert`
**Model:** `inherit` — the notice is the broker's liability surface even when the broker is us; the copy and the granularity are judgement.

**Files:**
- Create: `lib/portal/session.ts`
- Create: `lib/portal/session.test.ts`
- Create: `app/api/portal/consent/route.ts`
- Create: `app/api/portal/consent/route.test.ts`
- Create: `components/consent/ConsentBanner.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/consent` in the `ads-agent` app (Task 13), reached server-side via `PORTAL_INGEST_ORIGIN`.
- Produces:
  - `SESSION_COOKIE = "gs_sid"`, `newSessionId(): string`, `readSessionId(cookieHeader: string | null): string | null`, `sessionCookie(sessionId: string): string`
  - `POST /api/portal/consent` — proxies a grant or withdrawal for the Gentle Space org and sets the session cookie
  - `<ConsentBanner />` — three granular choices, not one toggle

**Context — why the first-party site needs this at all.** A-2 routes the Gentle Space site's own searches through the portal pipeline, which means the site is a tenant of its own product. The pipeline rejects an event with no consent, so without a consent surface the site's searches simply stop being recorded — and the demand ledger is the asset the data-MOAT work identified as the most valuable thing the workflow generates. Tracking consent requires **granular choices**, not an all-or-nothing toggle, so the banner offers the three catalogue purposes separately.

- [ ] **Step 1: Write the failing session test**

```ts
// lib/portal/session.test.ts
import { describe, it, expect } from "vitest";
import { newSessionId, readSessionId, sessionCookie, SESSION_COOKIE } from "./session";

describe("session id", () => {
  it("generates an opaque id the taxonomy accepts", () => {
    const id = newSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(id).not.toContain("@");
  });

  it("generates a different id each time", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it("reads the id from a cookie header alongside others", () => {
    expect(readSessionId(`theme=dark; ${SESSION_COOKIE}=abcdefabcdefabcdef01; x=1`)).toBe("abcdefabcdefabcdef01");
  });

  it("returns null for a missing or malformed cookie rather than inventing one", () => {
    expect(readSessionId(null)).toBeNull();
    expect(readSessionId("theme=dark")).toBeNull();
    expect(readSessionId(`${SESSION_COOKIE}=short`)).toBeNull();
  });

  it("sets the cookie HttpOnly, SameSite=Lax and Secure", () => {
    const cookie = sessionCookie("abcdefabcdefabcdef01");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/portal/session.test.ts`
Expected: FAIL — `Failed to resolve import "./session"`.

- [ ] **Step 3: Write the session helper**

```ts
// lib/portal/session.ts
import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "gs_sid";
const SESSION_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function newSessionId(): string {
  return randomBytes(15).toString("base64url");
}

export function readSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const value = rest.join("=");
    return SESSION_SHAPE.test(value) ? value : null;
  }
  return null;
}

export function sessionCookie(sessionId: string): string {
  return [
    `${SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join("; ");
}
```

- [ ] **Step 4: Write the failing proxy-route test**

```ts
// app/api/portal/consent/route.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

beforeEach(() => {
  process.env.PORTAL_INGEST_ORIGIN = "https://ads.test";
  process.env.GENTLE_SPACE_INGEST_KEY = "pk_live_gentlespace";
  process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://gentlespace.test";
});
afterEach(() => vi.unstubAllGlobals());

function request(body: Record<string, unknown>, cookie?: string): Request {
  return new Request("https://gentlespace.test/api/portal/consent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/portal/consent", () => {
  it("forwards the grant with the site's own ingest key and mints a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ consent_id: "c-1" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(request({ purposes: ["space_recommendation"], action: "granted" }));

    expect(res.status).toBe(202);
    expect(res.headers.get("set-cookie")).toContain("gs_sid=");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://ads.test/api/v1/consent");
    const forwarded = JSON.parse(init.body);
    expect(forwarded.ingest_key).toBe("pk_live_gentlespace");
    expect(forwarded.mechanism).toBe("banner");
    expect(forwarded.session_id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(init.headers.Origin).toBe("https://gentlespace.test");
  });

  it("reuses an existing session cookie rather than starting a new session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ consent_id: "c-2" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");
    await POST(request({ purposes: ["site_analytics"], action: "withdrawn" }, "gs_sid=abcdefabcdefabcdef01"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).session_id).toBe("abcdefabcdefabcdef01");
  });

  it("passes the upstream failure status through instead of claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "unknown_key" }, { status: 404 })));
    const { POST } = await import("./route");
    expect((await POST(request({ purposes: ["site_analytics"], action: "granted" }))).status).toBe(404);
  });

  it("rejects a purpose outside the catalogue without calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");
    expect((await POST(request({ purposes: ["everything"], action: "granted" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Write the proxy route and the banner**

```ts
// app/api/portal/consent/route.ts
import { NextResponse } from "next/server";
import { newSessionId, readSessionId, sessionCookie } from "../../../../lib/portal/session";

export const runtime = "nodejs";

const PURPOSES = ["site_analytics", "space_recommendation", "enquiry_handling"];
const ACTIONS = ["granted", "withdrawn"];

export async function POST(req: Request): Promise<Response> {
  let body: { purposes?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const purposes = Array.isArray(body.purposes) ? body.purposes : [];
  const action = typeof body.action === "string" ? body.action : "";
  if (purposes.length === 0 || !purposes.every((p) => typeof p === "string" && PURPOSES.includes(p))) {
    return NextResponse.json({ error: "invalid purposes" }, { status: 400 });
  }
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });

  const existing = readSessionId(req.headers.get("cookie"));
  const sessionId = existing ?? newSessionId();

  const upstream = await fetch(`${process.env.PORTAL_INGEST_ORIGIN}/api/v1/consent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "",
    },
    body: JSON.stringify({
      ingest_key: process.env.GENTLE_SPACE_INGEST_KEY,
      session_id: sessionId,
      purposes,
      action,
      mechanism: "banner",
    }),
  });

  const payload = await upstream.json().catch(() => ({}));
  const res = NextResponse.json(payload, { status: upstream.status });
  if (!existing) res.headers.set("Set-Cookie", sessionCookie(sessionId));
  return res;
}
```

```tsx
// components/consent/ConsentBanner.tsx
"use client";

import { useEffect, useState } from "react";

/**
 * Per DPDP Rule 3 a notice must be standalone, itemise what is collected, state the
 * specific purpose, and link to withdrawal. Tracking consent needs granular choices,
 * so each purpose is its own decision rather than one all-or-nothing toggle.
 */
const PURPOSES = [
  { code: "site_analytics", label: "Site analytics", detail: "Which pages are visited, and where visits arrive from." },
  { code: "space_recommendation", label: "Space recommendations", detail: "Searches, filters, listings viewed and shortlisted, so we can recommend spaces." },
  { code: "enquiry_handling", label: "Enquiry handling", detail: "Contact details revealed and enquiries submitted, so we can respond." },
] as const;

const STORAGE_KEY = "gs_consent_decided";

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [chosen, setChosen] = useState<string[]>(["space_recommendation"]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVisible(window.localStorage.getItem(STORAGE_KEY) === null);
  }, []);

  async function submit(purposes: string[], action: "granted" | "withdrawn") {
    setBusy(true);
    try {
      await fetch("/api/portal/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purposes, action }),
      });
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <aside
      aria-label="Privacy choices"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white p-4 text-sm text-neutral-800 shadow-lg"
    >
      <p className="mb-3 max-w-3xl">
        We record what you look for on this site so we can recommend spaces and respond to enquiries.
        Choose what you are happy for us to collect. You can withdraw any choice at any time.
      </p>
      <ul className="mb-3 space-y-2">
        {PURPOSES.map((purpose) => (
          <li key={purpose.code} className="flex items-start gap-2">
            <input
              id={`consent-${purpose.code}`}
              type="checkbox"
              className="mt-1"
              checked={chosen.includes(purpose.code)}
              onChange={(e) =>
                setChosen((prev) =>
                  e.target.checked ? [...prev, purpose.code] : prev.filter((c) => c !== purpose.code),
                )
              }
            />
            <label htmlFor={`consent-${purpose.code}`}>
              <span className="font-medium">{purpose.label}</span> — {purpose.detail}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={() => submit(chosen, "granted")}
          className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40"
        >
          Accept selected
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(PURPOSES.map((p) => p.code), "withdrawn")}
          className="rounded border border-neutral-300 px-3 py-1.5"
        >
          Reject all
        </button>
        <a href="/privacy" className="px-3 py-1.5 underline">
          Privacy notice and withdrawal
        </a>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Run the tests and commit**

Run: `npx vitest run lib/portal/session.test.ts app/api/portal/consent/route.test.ts`
Expected: PASS, 9 tests.

```bash
git add lib/portal/session.ts lib/portal/session.test.ts app/api/portal/consent components/consent/ConsentBanner.tsx
git commit -m "feat(site): granular consent surface for the first-party portal

A-2 makes the Gentle Space site a tenant of its own pipeline, and the
pipeline rejects unconsented events -- so the site needs its own notice.
Three purposes, three separate decisions, withdrawal in one click. The
session id is HttpOnly and opaque, and the notice version is resolved
server-side upstream."
```

## Task 18: Route first-party searches through the pipeline and retire `search_queries` (dataflow A-2)

**Skills:** `senior-backend`, `postgres-pro`, `code-reviewer`
**Model:** `inherit` — the retirement must be reversible and correctly sequenced, and the writer/reader inventory has to be trusted.

**Files:**
- Create: `ads-agent/lib/db/migrations/058_search_queries_scope_comment.up.sql` / `.down.sql`
- Create: `lib/portal/emit.ts`
- Create: `lib/portal/emit.test.ts`
- Modify: `app/api/spaces/search/route.ts:6,26-31`
- Delete: `lib/search/query-log.ts`
- Modify: `lib/db/schema.sql:54-64`
- Create: `ads-agent/lib/db/migrations/059_retire_search_queries.up.sql` / `.down.sql`
- Test: `app/api/spaces/search/route.test.ts` (modify the existing file)

**Interfaces:**
- Consumes: `readSessionId`, `newSessionId`, `sessionCookie` (Task 17); `POST /api/v1/ingest` (Task 12).
- Produces: `emitSearchPerformed(input: { sessionId: string; query: string; filters: Record<string,string>; resultCount: number }): Promise<void>` — soft-fails, exactly as `logSearchQuery` did.
- Removes: `logSearchQuery`, `SearchQueryLogInput`, and the table `public.search_queries`.

**Context — the complete inventory, from the code graph.** One writer: `logSearchQuery` in `lib/search/query-log.ts:17`. One call site: `app/api/spaces/search/route.ts:26`, imported at line 6. **No readers anywhere in the codebase** — every other mention of `search_queries` is documentation. Two definitions: `lib/db/migrations/008_search_queries.sql:6` and `lib/db/schema.sql:54` (the latter unqualified, which is the AGE `search_path` hazard the migration comment already warns about). The reporting the table would have served is now `analytics.search_performed_daily` from Task 11, which additionally distinguishes zero-result searches.

**Sequencing, and why the drop is a rename.** The comment lands first, so if execution stops midway the table still says what it covers. The routing change lands next. The retirement lands last, and it is `ALTER TABLE ... RENAME` rather than `DROP TABLE`: a rename is reversible in one statement and preserves rows, which the DPDP Rule 8(3) retention floor requires of anything that might be personal data. The physical drop is a scheduled hard-erase after the floor passes, not part of this migration.

- [ ] **Step 1: Land the interim scope comment**

```sql
-- ads-agent/lib/db/migrations/058_search_queries_scope_comment.up.sql
BEGIN;

-- Dataflow review A-2. Until first-party searches route through the portal pipeline,
-- this table and analytics.search_performed_daily measure the same concept with
-- neither aware of the other. Say so on the object, so nobody compares the counts.
COMMENT ON TABLE public.search_queries IS
  'RETIRING (dataflow review A-2). Covers ONLY the first-party Gentle Space site, '
  'with no tenant, session, or consent context. Not comparable with the '
  'search_performed event stream or analytics.search_performed_daily. '
  'Superseded by the portal ingestion pipeline; do not add columns or new writers.';

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/058_search_queries_scope_comment.down.sql
BEGIN;
COMMENT ON TABLE public.search_queries IS NULL;
COMMIT;
```

```bash
psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/058_search_queries_scope_comment.up.sql
git add ads-agent/lib/db/migrations/058_*
git commit -m "docs(db): mark search_queries' limited scope on the object itself (A-2)"
```

- [ ] **Step 2: Write the failing emit test**

```ts
// lib/portal/emit.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitSearchPerformed } from "./emit";

beforeEach(() => {
  process.env.PORTAL_INGEST_ORIGIN = "https://ads.test";
  process.env.GENTLE_SPACE_INGEST_KEY = "pk_live_gentlespace";
  process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://gentlespace.test";
});
afterEach(() => vi.unstubAllGlobals());

const input = { sessionId: "abcdefabcdefabcdef01", query: "hsr 20 desks", filters: { area: "HSR" }, resultCount: 0 };

describe("emitSearchPerformed", () => {
  it("posts a taxonomy-shaped search_performed event to the ingestion edge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ accepted: 1 }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await emitSearchPerformed(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://ads.test/api/v1/ingest");
    expect(init.headers["X-Ingest-Key"]).toBe("pk_live_gentlespace");
    expect(init.headers.Origin).toBe("https://gentlespace.test");
    const body = JSON.parse(init.body);
    expect(body.taxonomy_version).toBe(1);
    expect(body.session_id).toBe("abcdefabcdefabcdef01");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event).toBe("search_performed");
    expect(body.events[0].payload).toEqual({ query: "hsr 20 desks", filters: { area: "HSR" }, result_count: 0 });
  });

  it("soft-fails on a rejection, because logging must never break search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "no_consent" }, { status: 403 })));
    await expect(emitSearchPerformed(input)).resolves.toBeUndefined();
  });

  it("soft-fails when the edge is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(emitSearchPerformed(input)).resolves.toBeUndefined();
  });

  it("does nothing when the site has no ingest key configured", async () => {
    delete process.env.GENTLE_SPACE_INGEST_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await emitSearchPerformed(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run lib/portal/emit.test.ts`
Expected: FAIL — `Failed to resolve import "./emit"`.

- [ ] **Step 3: Write the emitter**

```ts
// lib/portal/emit.ts
export type SearchPerformedInput = {
  sessionId: string;
  query: string;
  filters: Record<string, string>;
  resultCount: number;
};

/**
 * Replaces logSearchQuery. The Gentle Space site is itself a portal (dataflow A-2),
 * so its searches go through the same consent-gated edge as any broker's. Soft-fails
 * for the same reason the old writer did: logging must never break search. An event
 * rejected for want of consent is the gate working, not an error.
 */
export async function emitSearchPerformed(input: SearchPerformedInput): Promise<void> {
  const origin = process.env.PORTAL_INGEST_ORIGIN;
  const ingestKey = process.env.GENTLE_SPACE_INGEST_KEY;
  if (!origin || !ingestKey) return;

  try {
    await fetch(`${origin}/api/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ingest-Key": ingestKey,
        Origin: process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "",
      },
      body: JSON.stringify({
        taxonomy_version: 1,
        session_id: input.sessionId,
        events: [
          {
            event: "search_performed",
            occurred_at: new Date().toISOString(),
            payload: {
              query: input.query.slice(0, 500),
              filters: input.filters,
              result_count: input.resultCount,
            },
          },
        ],
      }),
    });
  } catch (err) {
    console.error("portal search event failed", err);
  }
}
```

- [ ] **Step 4: Reroute the search route**

Replace line 6 and lines 26–31 of `app/api/spaces/search/route.ts`, and return the session cookie when one is minted:

```ts
// app/api/spaces/search/route.ts
import { NextResponse } from "next/server";
import { isAiSearchConfigured } from "@/lib/ai/client";
import { maxPossibleOverlap } from "../../../../lib/graph/score";
import { toPublicListing } from "../../../../lib/listings/public";
import { retrieveListings } from "../../../../lib/search/retrieve";
import { emitSearchPerformed } from "../../../../lib/portal/emit";
import { newSessionId, readSessionId, sessionCookie } from "../../../../lib/portal/session";

export async function POST(req: Request) {
  if (!isAiSearchConfigured()) {
    return NextResponse.json({ error: "search unavailable" }, { status: 503 });
  }
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const query = body.query?.trim() ?? "";
  if (!query || query.length > 500) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }
  try {
    const { interpretedQuery, queryEntities, listings } = await retrieveListings(query);
    const matchedEntities = maxPossibleOverlap(queryEntities) > 0 ? queryEntities : undefined;

    const existingSession = readSessionId(req.headers.get("cookie"));
    const sessionId = existingSession ?? newSessionId();
    await emitSearchPerformed({
      sessionId,
      query,
      filters: { interpreted_query: interpretedQuery.slice(0, 200) },
      resultCount: listings.length,
    });

    const res = NextResponse.json({
      interpretedQuery,
      listings: listings.map(toPublicListing),
      matchedEntities,
    });
    if (!existingSession) res.headers.set("Set-Cookie", sessionCookie(sessionId));
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "search failed" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Update the route test and delete the retired writer**

In `app/api/spaces/search/route.test.ts`, replace the `logSearchQuery` mock with an `emitSearchPerformed` mock and add one assertion:

```ts
// app/api/spaces/search/route.test.ts — replace the query-log mock
const emitSearchPerformed = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/portal/emit", () => ({
  emitSearchPerformed: (...args: unknown[]) => emitSearchPerformed(...args),
}));
```

```ts
// app/api/spaces/search/route.test.ts — add inside the existing describe block
  it("emits search_performed through the portal pipeline rather than writing search_queries", async () => {
    const res = await postSearch({ query: "hsr layout 20 desks" });
    expect(res.status).toBe(200);
    expect(emitSearchPerformed).toHaveBeenCalledTimes(1);
    const [input] = emitSearchPerformed.mock.calls[0];
    expect(input.query).toBe("hsr layout 20 desks");
    expect(input.sessionId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(res.headers.get("set-cookie")).toContain("gs_sid=");
  });
```

```bash
git rm lib/search/query-log.ts
npx vitest run app/api/spaces/search/route.test.ts lib/portal/emit.test.ts
```
Expected: PASS. A TypeScript error naming `lib/search/query-log` means a call site was missed — the code graph showed exactly one, at `app/api/spaces/search/route.ts:6`.

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 6: Remove the table from `schema.sql` for fresh databases**

Delete lines 54–64 of `lib/db/schema.sql` (the `search_queries` `CREATE TABLE` and its index). Fresh databases then never create it; existing ones are handled by the rename in step 7.

- [ ] **Step 7: Retire the table, reversibly**

```sql
-- ads-agent/lib/db/migrations/059_retire_search_queries.up.sql
BEGIN;

-- A-2 complete: first-party searches now flow through the portal pipeline, and
-- analytics.search_performed_daily is the reader. The code graph confirmed one
-- writer (lib/search/query-log.ts, deleted) and zero readers.
--
-- RENAME, not DROP. A rename is reversible in one statement and keeps the rows,
-- which the Rule 8(3) retention floor requires of anything that may be personal
-- data. The physical drop is a scheduled hard-erase after the floor passes.
ALTER TABLE IF EXISTS public.search_queries RENAME TO search_queries_retired_20260812;

ALTER INDEX IF EXISTS public.search_queries_created_at_idx
  RENAME TO search_queries_retired_20260812_created_at_idx;

COMMENT ON TABLE public.search_queries_retired_20260812 IS
  'RETIRED 2026-08-12 (dataflow review A-2). Replaced by the portal ingestion '
  'pipeline and analytics.search_performed_daily. Retained access-blocked for the '
  'DPDP Rule 8(3) one-year floor; hard-erase no earlier than 2027-08-12.';

REVOKE ALL ON public.search_queries_retired_20260812 FROM PUBLIC;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/059_retire_search_queries.down.sql
BEGIN;
ALTER INDEX IF EXISTS public.search_queries_retired_20260812_created_at_idx
  RENAME TO search_queries_created_at_idx;
ALTER TABLE IF EXISTS public.search_queries_retired_20260812 RENAME TO search_queries;
COMMENT ON TABLE public.search_queries IS NULL;
COMMIT;
```

```bash
psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/059_retire_search_queries.up.sql
psql "$DATABASE_URL" -c "\d public.search_queries_retired_20260812"
```
Expected: the table exists with its original columns and a row count unchanged from before the rename.

```bash
psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/059_retire_search_queries.down.sql
psql "$DATABASE_URL" -c "SELECT count(*) FROM public.search_queries"
psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/059_retire_search_queries.up.sql
```
Expected: the count matches the pre-rename count, proving the retirement is reversible with no data loss. Re-apply the up migration to leave the database retired.

- [ ] **Step 8: Commit**

```bash
git add lib/portal/emit.ts lib/portal/emit.test.ts app/api/spaces/search/route.ts app/api/spaces/search/route.test.ts lib/db/schema.sql ads-agent/lib/db/migrations/059_*
git commit -m "refactor(search): route first-party searches through the portal pipeline (A-2)

One writer and zero readers, per the code graph, so the swap is a single call
site. search_queries is renamed rather than dropped: reversible in one
statement and rows retained for the Rule 8(3) floor. Reporting moves to
analytics.search_performed_daily, which can tell a zero-result search from a
successful one -- the thing the retired table structurally could not."
```

## Task 19: Retention and erasure across the raw zone

**Skills:** `senior-data-engineer`, `gdpr-dsgvo-expert`, `compliance-auditor`
**Model:** `inherit` — the partition arithmetic and the ledger semantics both carry compliance weight.

**Files:**
- Create: `ads-agent/lib/db/migrations/060_deletion_store_gcs_raw.up.sql` / `.down.sql`
- Create: `lib/clickhouse/retention.ts`
- Create: `lib/clickhouse/erasure.ts`
- Create: `scripts/clickhouse/retention.ts`
- Test: `lib/clickhouse/retention.test.ts`
- Test: `lib/clickhouse/erasure.test.ts`

**Interfaces:**
- Consumes: `raw.portal_events` (Task 9), `analytics.enquiry_fact` (Task 2), `context.purpose_retention` (Task 6), `context.deletion_propagations` (S3/S4 compliance tables), `erasureSubjects` semantics from Task 16.
- Produces:
  - `loadPurposeWindows(): Promise<PurposeWindow[]>` where `PurposeWindow = { purpose: string; retentionDays: number }`
  - `expiredPartitions(windows: PurposeWindow[], partitions: PartitionRow[], today: Date): string[]` where `PartitionRow = { partition: string; purpose: string; occurred_on: string }` — pure
  - `dropExpiredPartitions(): Promise<string[]>`
  - `eraseSubject(input: { orgId: string; requestId: string; enquiryIds: string[]; sessionIds: string[] }): Promise<void>`

**Context — the asymmetry.** The raw zone is not a permanent archive: purpose limitation makes data kept beyond its stated purpose unlawful regardless of consent. Expiry is therefore a partition drop, which is why `raw.portal_events` is partitioned by `(purpose, occurred_on)`. Per-subject erasure is different: it targets ClickHouse, where events are queryable, because GCS files are batched, multi-subject and short-lived. Consent records are **retained** — they are the evidence that collection was lawful, and erasing them would destroy the proof that prior processing was authorised.

**Contradiction resolved.** Portal spec §8 says `context.deletion_propagations.store` gains `bigquery`. Datastore §14.6 and portal §PI3 both state that BigQuery is not used, and the data model §6.1 `CHECK` already carries `clickhouse_raw`. The `bigquery` value is a leftover from the rejected design; this migration adds `gcs_raw` instead, which is the store §7's erasure table actually names.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/clickhouse/retention.test.ts
import { describe, it, expect } from "vitest";
import { expiredPartitions } from "./retention";

const windows = [
  { purpose: "site_analytics", retentionDays: 90 },
  { purpose: "space_recommendation", retentionDays: 180 },
  { purpose: "enquiry_handling", retentionDays: 365 },
];
const today = new Date("2026-08-12T00:00:00.000Z");

describe("expiredPartitions", () => {
  it("keeps a partition inside its purpose's window", () => {
    expect(
      expiredPartitions(windows, [{ partition: "('site_analytics','2026-07-01')", purpose: "site_analytics", occurred_on: "2026-07-01" }], today),
    ).toEqual([]);
  });

  it("expires a partition past its purpose's window", () => {
    expect(
      expiredPartitions(windows, [{ partition: "('site_analytics','2026-01-01')", purpose: "site_analytics", occurred_on: "2026-01-01" }], today),
    ).toEqual(["('site_analytics','2026-01-01')"]);
  });

  it("applies each purpose's own window, not one global window", () => {
    const partitions = [
      { partition: "('site_analytics','2026-04-01')", purpose: "site_analytics", occurred_on: "2026-04-01" },
      { partition: "('enquiry_handling','2026-04-01')", purpose: "enquiry_handling", occurred_on: "2026-04-01" },
    ];
    expect(expiredPartitions(windows, partitions, today)).toEqual(["('site_analytics','2026-04-01')"]);
  });

  it("never expires a partition whose purpose has no configured window", () => {
    expect(
      expiredPartitions(windows, [{ partition: "('mystery','2020-01-01')", purpose: "mystery", occurred_on: "2020-01-01" }], today),
    ).toEqual([]);
  });
});
```

```ts
// lib/clickhouse/erasure.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const chExec = vi.fn().mockResolvedValue(undefined);
vi.mock("./client", () => ({ chExec: (...a: unknown[]) => chExec(...a) }));

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const REQUEST = "rrrrrrrr-0000-4000-8000-00000000000r";

beforeEach(() => {
  chExec.mockClear();
  query.mockClear();
});

describe("eraseSubject", () => {
  const input = { orgId: ORG, requestId: REQUEST, enquiryIds: ["eeeeeeee-0000-4000-8000-00000000000e"], sessionIds: ["sess-1", "sess-2"] };

  it("deletes every linked session's raw events, not just the enquiry row", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    const rawDelete = chExec.mock.calls.map(([sql]) => String(sql)).find((s) => s.includes("raw.portal_events"));
    expect(rawDelete).toContain("ALTER TABLE raw.portal_events DELETE");
    expect(rawDelete).toContain("session_id IN");
    const params = (chExec.mock.calls.find(([sql]) => String(sql).includes("raw.portal_events")) as [string, { params: Record<string, string> }])[1].params;
    expect(JSON.parse(params.sessions)).toEqual(["sess-1", "sess-2"]);
    expect(params.org).toBe(ORG);
  });

  it("deletes the enquiry from the analytical mirror too", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    expect(chExec.mock.calls.map(([sql]) => String(sql)).some((s) => s.includes("analytics.enquiry_fact"))).toBe(true);
  });

  it("waits for the mutation instead of assuming it finished", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    expect(chExec.mock.calls.every(([sql]) => String(sql).includes("mutations_sync = 2"))).toBe(true);
  });

  it("records propagation for clickhouse_raw, clickhouse, and gcs_raw", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    const stores = query.mock.calls.filter(([sql]) => String(sql).includes("deletion_propagations")).map(([, p]) => (p as unknown[])[1]);
    expect(stores).toContain("clickhouse_raw");
    expect(stores).toContain("clickhouse");
    expect(stores).toContain("gcs_raw");
  });

  it("never touches consent records: they are the evidence collection was lawful", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    const touched = [...chExec.mock.calls, ...query.mock.calls].map(([sql]) => String(sql)).join(" ");
    expect(touched).not.toContain("consent_records");
  });

  it("does nothing to the raw zone when no session was ever linked", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject({ ...input, sessionIds: [] });
    expect(chExec.mock.calls.map(([sql]) => String(sql)).some((s) => s.includes("raw.portal_events"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run lib/clickhouse/retention.test.ts lib/clickhouse/erasure.test.ts`
Expected: FAIL — both imports unresolved.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/060_deletion_store_gcs_raw.up.sql
BEGIN;

-- Portal spec §8 says this CHECK gains 'bigquery'. It does not: datastore §14.6 and
-- portal PI3 both record that BigQuery was rejected once a self-hosted path with the
-- same zero-code property was confirmed, so 'bigquery' is a leftover from the
-- superseded design. The store portal §7's erasure table actually names is the GCS
-- raw bucket, which is not addressable per subject and is closed out by lifecycle.
ALTER TABLE context.deletion_propagations DROP CONSTRAINT IF EXISTS deletion_propagations_store_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_store_check CHECK (store IN
    ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
     'vector_index','objectstore','langfuse','clickhouse_raw','gcs_raw'));

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/060_deletion_store_gcs_raw.down.sql
BEGIN;
DELETE FROM context.deletion_propagations WHERE store = 'gcs_raw';
ALTER TABLE context.deletion_propagations DROP CONSTRAINT IF EXISTS deletion_propagations_store_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_store_check CHECK (store IN
    ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
     'vector_index','objectstore','langfuse','clickhouse_raw'));
COMMIT;
```

Run: `psql "$DATABASE_URL" -f ads-agent/lib/db/migrations/060_deletion_store_gcs_raw.up.sql`
Expected: `BEGIN`, `ALTER TABLE`, `ALTER TABLE`, `COMMIT`.

- [ ] **Step 4: Write retention**

```ts
// lib/clickhouse/retention.ts
import { getPool } from "../db/client";
import { chExec, chQuery } from "./client";

export type PurposeWindow = { purpose: string; retentionDays: number };
export type PartitionRow = { partition: string; purpose: string; occurred_on: string };

export async function loadPurposeWindows(): Promise<PurposeWindow[]> {
  const { rows } = await getPool().query<{ purpose: string; retention_days: number }>(
    "SELECT purpose, retention_days FROM context.purpose_retention ORDER BY purpose",
  );
  return rows.map((r) => ({ purpose: r.purpose, retentionDays: r.retention_days }));
}

const DAY_MS = 86_400_000;

/**
 * Each purpose expires on its own clock. A partition whose purpose has no configured
 * window is never dropped: an unknown retention rule is not a licence to delete.
 */
export function expiredPartitions(
  windows: PurposeWindow[],
  partitions: PartitionRow[],
  today: Date,
): string[] {
  const byPurpose = new Map(windows.map((w) => [w.purpose, w.retentionDays]));
  return partitions
    .filter((partition) => {
      const retentionDays = byPurpose.get(partition.purpose);
      if (retentionDays === undefined) return false;
      const ageDays = (today.getTime() - Date.parse(`${partition.occurred_on}T00:00:00.000Z`)) / DAY_MS;
      return ageDays > retentionDays;
    })
    .map((partition) => partition.partition);
}

export async function dropExpiredPartitions(): Promise<string[]> {
  const windows = await loadPurposeWindows();

  // The partition dimensions are read from the data rather than parsed out of
  // system.parts.partition, which is an opaque expression string.
  const partitions = await chQuery<PartitionRow>(
    `SELECT DISTINCT
            concat('(''', purpose, ''',''', toString(occurred_on), ''')') AS partition,
            purpose,
            toString(occurred_on) AS occurred_on
       FROM raw.portal_events
      ORDER BY purpose, occurred_on`,
  );

  const expired = expiredPartitions(windows, partitions, new Date());
  for (const partition of expired) {
    await chExec(`ALTER TABLE raw.portal_events DROP PARTITION ${partition} SETTINGS mutations_sync = 2`);
  }
  return expired;
}
```

```ts
// scripts/clickhouse/retention.ts
import { dropExpiredPartitions } from "../../lib/clickhouse/retention";

async function main(): Promise<void> {
  const dropped = await dropExpiredPartitions();
  console.log(dropped.length === 0 ? "retention: nothing expired" : `retention: dropped ${dropped.join(", ")}`);
}

main().catch((err) => {
  console.error("retention: failed", err);
  process.exit(1);
});
```

- [ ] **Step 5: Write erasure**

```ts
// lib/clickhouse/erasure.ts
import { getPool } from "../db/client";
import { chExec } from "./client";

export type EraseSubjectInput = {
  orgId: string;
  requestId: string;
  enquiryIds: string[];
  sessionIds: string[];
};

async function recordPropagation(
  requestId: string,
  store: "clickhouse_raw" | "clickhouse" | "gcs_raw",
  state: "erased" | "failed",
  detail: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO context.deletion_propagations (request_id, store, state, detail, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (request_id, store) DO UPDATE
        SET state = EXCLUDED.state, detail = EXCLUDED.detail, updated_at = now()`,
    [requestId, store, state, detail],
  );
}

/**
 * Erasure targets ClickHouse, where events are queryable. The GCS bucket is not
 * addressable per subject -- files are batched and multi-subject -- so its ledger row
 * records the lifecycle bound rather than a delete. Consent records are deliberately
 * untouched: they are the evidence the collection was lawful.
 */
export async function eraseSubject(input: EraseSubjectInput): Promise<void> {
  if (input.sessionIds.length > 0) {
    await chExec(
      `ALTER TABLE raw.portal_events
         DELETE WHERE org_id = {org:UUID} AND session_id IN ({sessions:Array(String)})
         SETTINGS mutations_sync = 2`,
      { params: { org: input.orgId, sessions: JSON.stringify(input.sessionIds) } },
    );
    await recordPropagation(
      input.requestId,
      "clickhouse_raw",
      "erased",
      `${input.sessionIds.length} session(s) deleted from raw.portal_events`,
    );
  }

  if (input.enquiryIds.length > 0) {
    await chExec(
      `ALTER TABLE analytics.enquiry_fact
         DELETE WHERE org_id = {org:UUID} AND enquiry_id IN ({enquiries:Array(UUID)})
         SETTINGS mutations_sync = 2`,
      { params: { org: input.orgId, enquiries: JSON.stringify(input.enquiryIds) } },
    );
    await recordPropagation(
      input.requestId,
      "clickhouse",
      "erased",
      `${input.enquiryIds.length} enquiry row(s) deleted from analytics.enquiry_fact`,
    );
  }

  await recordPropagation(
    input.requestId,
    "gcs_raw",
    "erased",
    "not addressable per subject: batched multi-subject files, deleted after ingest, " +
      "one-day lifecycle rule. Residual exposure is one batch interval.",
  );
}
```

- [ ] **Step 6: Run the tests and add the cron entry**

Run: `npx vitest run lib/clickhouse/retention.test.ts lib/clickhouse/erasure.test.ts`
Expected: PASS, 10 tests.

Append to `infra/clickhouse/README.md`:

```markdown
Retention runs daily; expiry is a partition drop, not a scan-and-delete.

    15 3 * * * cd /opt/gentle-space-web && npx tsx --env-file=.env.local scripts/clickhouse/retention.ts

Windows live in `context.purpose_retention` and are configuration, not code. A purpose
with no configured window is never dropped.
```

- [ ] **Step 7: Verify a real partition drop**

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl
curl -s -H "X-ClickHouse-User: etl_writer" -H "X-ClickHouse-Key: etl" http://localhost:8123/ --data-binary "
INSERT INTO raw.portal_events (org_id, event_id, event, purpose, session_id, taxonomy_version, occurred_at, payload)
VALUES (generateUUIDv4(), generateUUIDv4(), 'page_view', 'site_analytics', 'retentiontest0000001', 1, toDateTime64('2025-01-01 00:00:00.000', 3), '{}')"
npx tsx --env-file=.env.local scripts/clickhouse/retention.ts
```
Expected: `retention: dropped ('site_analytics','2025-01-01')`

```bash
curl -s -H "X-ClickHouse-User: etl_writer" -H "X-ClickHouse-Key: etl" http://localhost:8123/ --data-binary "SELECT count() FROM raw.portal_events WHERE session_id = 'retentiontest0000001'"
```
Expected: `0`

- [ ] **Step 8: Commit**

```bash
git add lib/clickhouse/retention.ts lib/clickhouse/retention.test.ts lib/clickhouse/erasure.ts lib/clickhouse/erasure.test.ts scripts/clickhouse/retention.ts infra/clickhouse/README.md ads-agent/lib/db/migrations/060_*
git commit -m "feat(compliance): per-purpose retention and subject erasure in the raw zone

Expiry is a partition drop per (purpose, day), each purpose on its own clock;
a purpose with no configured window is never dropped. Erasure covers every
linked session, not just the enquiry row, and writes clickhouse_raw,
clickhouse and gcs_raw ledger rows. Consent records are untouched.

deletion_propagations.store gains 'gcs_raw', not the 'bigquery' portal §8
asks for: BigQuery was rejected in §PI3 and §14.6."
```

## Task 20 (fan-in): S6a gate

**Skills:** `senior-qa`, `adversarial-reviewer`
**Model:** `inherit` — the gate is a judgement about whether the claim actually holds.

**Files:**
- Test: `ads-agent/lib/portal/s6a-gate.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–19.
- Produces: a passing gate.

- [ ] **Step 1: Merge the S6a branches**

```bash
git checkout main && git merge --no-ff s6a/latency s6a/first-party-consent s6a/retire-search-queries s6a/retention
npx tsc --noEmit && cd ads-agent && npx tsc --noEmit
```
Expected: no output from either.

- [ ] **Step 2: Write the gate test**

```ts
// ads-agent/lib/portal/s6a-gate.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { chQuery } from "../../../lib/clickhouse/client";

const live = Boolean(process.env.TEST_DATABASE_URL && process.env.CLICKHOUSE_URL);
const SESSION = "s6agateSession000001";

let pool: Pool;
let orgId: string;
let ingestKey: string;

beforeAll(async () => {
  if (!live) return;
  process.env.CONSENT_CACHE_TTL_MS = "60000";
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  orgId = (await pool.query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")).rows[0].id;
  ingestKey = `pk_gate_${Date.now()}`;
  await pool.query(
    `INSERT INTO context.tenant_portal_config
       (org_id, ingest_key, allowed_origins, purposes_offered, notice_version)
     VALUES ($1, $2, ARRAY['https://broker.test'], ARRAY['space_recommendation'], 1)
     ON CONFLICT (org_id) DO UPDATE
       SET ingest_key = EXCLUDED.ingest_key, allowed_origins = EXCLUDED.allowed_origins,
           purposes_offered = EXCLUDED.purposes_offered`,
    [orgId, ingestKey],
  );
});

afterAll(async () => {
  if (!live) return;
  delete process.env.CONSENT_CACHE_TTL_MS;
  await pool.end();
});

function ingestRequest(): Request {
  return new Request("https://ads.test/api/v1/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://broker.test", "X-Ingest-Key": ingestKey },
    body: JSON.stringify({
      taxonomy_version: 1,
      session_id: SESSION,
      events: [{ event: "listing_view", occurred_at: new Date().toISOString(), payload: { listing_ref: "gate-1", dwell_seconds: 3 } }],
    }),
  });
}

describe.skipIf(!live)("S6a gate", () => {
  it("an event from a broker's site reaches ClickHouse", async () => {
    const { recordConsent } = await import("./consent");
    const { POST } = await import("../../app/api/v1/ingest/route");
    const { chExec } = await import("../../../lib/clickhouse/client");

    await recordConsent({ kind: "org", orgId } as const, {
      subjectRef: SESSION, purposes: ["space_recommendation"], action: "granted",
      noticeVersion: 1, mechanism: "banner",
    });

    const res = await POST(ingestRequest());
    expect(res.status).toBe(202);

    // The outbox row exists in the same transaction as the accepted event; the relay
    // (S5a) publishes it and the GCS export plus S3Queue carry it in cloud. Locally
    // the same materialized view is driven directly, so the transform and the target
    // table under test are the production ones.
    const { rows } = await pool.query<{ payload: string }>(
      `SELECT payload::text AS payload FROM context.outbox_events
        WHERE topic = 'portal.event' AND payload->>'session_id' = $1
        ORDER BY created_at DESC LIMIT 1`,
      [SESSION],
    );
    expect(rows).toHaveLength(1);

    await chExec(
      "INSERT INTO raw.portal_event_ingest (raw) FORMAT JSONEachRow\n" +
        JSON.stringify({ raw: rows[0].payload }),
    );

    const landed = await chQuery<{ c: string }>(
      "SELECT count() AS c FROM raw.portal_events FINAL WHERE session_id = {s:String}",
      { params: { s: SESSION } },
    );
    expect(landed[0].c).toBe("1");
  }, 60_000);

  it("no unconsented event can reach the outbox", async () => {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM context.outbox_events o
        WHERE o.topic = 'portal.event'
          AND NOT EXISTS (
            SELECT 1 FROM context.consent_records cr
             WHERE cr.org_id = o.org_id
               AND cr.subject_ref = o.payload->>'session_id'
               AND cr.action = 'granted'
               AND cr.purposes @> ARRAY[o.payload->>'purpose']
          )`,
    );
    expect(Number(rows[0].c)).toBe(0);
  });

  it("the retired search_queries table has no writer left in the codebase", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(new URL("../../../lib/search/query-log.ts", import.meta.url))).toBe(false);
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'search_queries'`,
    );
    expect(Number(rows[0].c)).toBe(0);
  });
});
```

- [ ] **Step 3: Run the gate, including the measured latency test**

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl CLICKHOUSE_TENANT_PASSWORD=tenant
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/portal/s6a-gate.test.ts lib/portal/withdrawal-latency.test.ts
```
Expected: PASS, 6 tests, with the two measured latency lines printed. Both must be below 2000 ms.

- [ ] **Step 4: Run everything**

```bash
npx vitest run && npx tsc --noEmit
cd ads-agent && npx vitest run && npx tsc --noEmit
CDC_LAG_ALERT_SECONDS=900 npx tsx --env-file=.env.local scripts/clickhouse/reconcile.ts --repeat 3 --interval 60
```
Expected: both suites green, no type errors, and three `reconcile: ok=true` lines.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/portal/s6a-gate.test.ts
git commit -m "test(s6a): gate -- consented event reaches ClickHouse, withdrawal stops it in seconds"
```

- [ ] **Step 6: Final adversarial review**

Dispatch one `adversarial-reviewer` on the most capable model over `git diff $(git merge-base main HEAD)..HEAD`, with the Global Constraints as its attention lens. Point its Security Auditor persona specifically at:

1. Whether any path can publish a `portal.event` without passing the consent check — including the mixed-batch case and the `enquiry_submitted` link path.
2. Whether the withdrawal latency test can pass with the notify trigger removed (it must not; step 2 of Task 15 is the evidence).
3. Whether `resolveIngestKey`'s platform-scope read can be reached with org scope, and whether the `ingest_key_lookup` policy can leak another tenant's configuration once a tenant is set.
4. Whether every ClickHouse table carrying `org_id` has both a leading-edge sort key and a row policy, and whether `etl_writer`'s exemption is reachable from any request path.
5. Whether the `search_queries` retirement is reversible with no data loss, and whether any reader was missed.

**S6a gate:** an event from a broker's site reaches ClickHouse; a withdrawn consent stops the next one in under two seconds, measured, with a control proving the measurement can fail; no unconsented event exists in the outbox; the `derived` quarantine assertions are green; retention drops a partition; `search_queries` has no writer and no live table.

---

## Self-review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| build-sequence S6 — ClickHouse mirror and CDC, gate "replicated data matches source" | 1, 2, 3, 4, 5 |
| build-sequence S6a — edge endpoint, GCS export, S3Queue, `derived` schema | 8, 9, 12, 14 |
| build-sequence cross-cutting — observability (§12.4) from S6 | 4 (signal table in `infra/clickhouse/README.md`, one alert each) |
| datastore §3 target architecture — ClickHouse fed by CDC, row policies per tenant | 1, 2, 3 |
| datastore §12.1 freshness, refusing stale data | 3 (`context.replication_state` watermark), 4 (`lag_seconds` recorded per run and alerted) |
| datastore §14.6 raw event zone, GCS transport, MV starts ingestion, Keeper bounds, delete after ingest, separate bucket | 8, 9 |
| datastore §11.2 consequences per store — pseudonymous ids in ClickHouse, expensive deletes | 9 (no PII columns in `raw.portal_events`), 19 |
| data model §7 ClickHouse mirror and row policy | 2 (with the documented `ReplacingMergeTree` deviation) |
| data model §0 `derived` is a quarantine | 14 |
| portal §1 consent is the architecture; unconsented events never stored | 12, 20 |
| portal §2 PI1–PI6 | PI1/PI2 → 12; PI3 → 9; PI4 → 7; PI5 → 16; PI6 → 6 |
| portal §3.1 broker configures purposes, notice, granularity, withdrawal | 6, 13, 17 |
| portal §3.2 immutable record of grant and withdrawal | 6 |
| portal §3.3 withdrawal stops collection and erases prior data | 10 (`deletion.requested`), 15, 19 |
| portal §4 ingestion edge — origin allowlist, rate limits, size and shape caps, write-only | 12 |
| portal §5 pseudonymity trap — explicit link, erasure covers sessions, unlinked sessions expire | 16, 19 |
| portal §6 event taxonomy, fixed and versioned | 7 |
| portal §7 retention and erasure per store | 19 |
| portal §8 data model additions + consent cache with short TTL invalidated on write | 6, 10 |
| portal §9 risks — consent correctness proven by test (no consent, withdrawn, wrong purpose) | 12 (three separate tests), 15 |
| dataflow A-2 route first-party searches, retire `search_queries` | 17, 18 |
| dataflow A-5 `derived` quarantine | 14 |

**Spec requirements I could not turn into a task:** `pg_clickhouse` (the FDW named in datastore §3, so application code can reach analytical tables through one Postgres connection). It is a Postgres extension requiring a verified upstream build recipe against the PG18 + AGE image, no gate in S6 or S6a depends on it, and nothing in either step reads analytical tables through Postgres — the reconciliation and projection jobs talk to ClickHouse over HTTP. It belongs with the first consumer that actually wants a cross-store join, most likely S9's MCP context server. Recorded rather than silently dropped.

**2. Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N", no code step without code. One forward reference is deliberate and named: the exact ClickHouse patch version, which Task 1 step 8 records from the observed `SELECT version()` output. `context.purpose_retention` ships concrete day counts, not a placeholder — portal §10's open question 3 is referenced as the reason they are configuration rows rather than a migration.

**3. Type consistency.** Checked against the S5a plan as written rather than assumed: this plan calls `enqueueEvent(scope, client, { topic, payload })` and `withTenantTransaction(scope, fn, pool?)` with S5a's exact signatures, and uses S5a's `Scope = { kind: "platform" | "org"; orgId: string }` shape — which is why `PLATFORM_SCOPE` in `config.ts` carries the zero UUID rather than omitting `orgId`. No transaction is hand-rolled anywhere in this plan. Internally: `ClickHouseConfig`, `ClickHouseOptions`, `chQuery`/`chExec` keep the same shapes in Tasks 2, 3, 4, 9, 11, 14, 19, 20. `ConsentState = { purposes: string[]; latestAt: string | null }` is produced in Task 10 and consumed identically in 12, 15, 20. `RejectionReason` is defined once in `rejections.ts` and imported by `ingest.ts`. `TenantPortalConfig` field names (`orgId`, `allowedOrigins`, `purposesOffered`, `noticeVersion`) match between `config.ts`, `ingest.ts`, the consent route, and both gate tests. `ReconciliationReport` fields match between `reconcileEnquiries`, `evaluateReport`, `recordReconciliation` and their tests. `PurposeWindow.retentionDays` is camelCase in TypeScript and `retention_days` in SQL, mapped explicitly in `loadPurposeWindows`. `erasureSubjects` returns `{ enquiryIds, sessionIds }` and `eraseSubject` consumes exactly those names. `rebuildPortalSessionSpaces` takes `Scope` first, like every other data-layer function here.
