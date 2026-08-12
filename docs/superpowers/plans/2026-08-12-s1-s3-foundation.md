# S1–S3 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four live release-blocking defects, consolidate `ads_agent` into the listings PostgreSQL instance on PostgreSQL 18 with Apache AGE, and make every data path tenant-safe — the release gate before any external customer is issued a login.

**Architecture:** Three sequential stages with hard gates. S1 repairs defects in the code as it stands and replaces the whole-schema re-run with a numbered up/down migration runner. S2 merges `ads_agent` into the listings instance as an `adsagent` schema on PG18, leaving the old instances running and untouched. S3 adds a required `Scope` first parameter at the application layer, a transaction-local tenant context, and `FORCE ROW LEVEL SECURITY` beneath both. Parallelism happens inside S1 and S3, fanned out strictly along file-disjointness proven from the import graph.

**Tech Stack:** PostgreSQL 18, Apache AGE `PG18/v1.8.0-rc0`, pgvector, `pg` (node-postgres) with `pg.Pool`, Next.js 15, TypeScript 5, Vitest 4.

## Global Constraints

Every task inherits these. Copy this whole section verbatim into every implementer and reviewer dispatch.

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

Additional constraints this plan imposes, derived from its own specs:

- **Migration files contain no transaction control.** The runner built in Task 1 wraps each file in one `BEGIN`/`COMMIT`. A `BEGIN` inside a migration body produces a nested-transaction warning and breaks the rollback-on-failure guarantee.
- **`scopeClause` always consumes exactly one placeholder, `$1`, in both scope branches.** Callers spread `scope.params` first and number their own params from `$2` regardless of scope kind. A branch emitting zero params would shift every later placeholder depending on the caller's scope.
- **The application roles do not own the tables.** Ownership stays with the bootstrap role; `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, `derived_rw` and `agent_ro` are granted privileges only, and `BYPASSRLS` and superuser never appear in an application connection string.
- **`agent_ro` gets `SELECT` only**, and never `INSERT`, `UPDATE`, `DELETE` or `USAGE` on sequences.
- **Migration numbers 001–019 belong to this plan.** 001–013 are consumed here; 014–019 are reserved for S1–S3 follow-ups and must not be claimed by a sibling plan.
- **Platform scope is a read affordance, never a write bypass.** The RLS policy grants cross-org visibility through `public.is_platform_read()` in `USING` only; `WITH CHECK` always pins writes to `public.current_tenant()`.

---

## Shared interfaces this plan defines

Six sibling plans import these names. They are fixed. Renaming any of them breaks work happening in parallel.

| Artifact | Defined in | Task |
|---|---|---|
| `type Scope`, `scopeClause(scope, column = "org_id")` | `ads-agent/lib/db/scope-sql.ts` | 9 |
| `withTenantTransaction(scope, fn, pool?)` | `ads-agent/lib/db/tx.ts` | 9 |
| `public.set_tenant(uuid)`, `public.current_tenant()` | migration `006_tenant_primitives` | 9 |
| `public.set_platform()`, `public.is_platform_read()` | migration `006_tenant_primitives` | 9 |
| `public.lifecycle_state` enum, `public.org_ref` domain | migration `006_tenant_primitives` | 9 |
| Schemas `listings`, `adsagent`, `context`, `public`, `derived` | migration `003_schemas_and_roles` | 7 |
| Roles `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, `derived_rw`, `agent_ro` | migration `003_schemas_and_roles` | 7 |
| `scopeFor(session, orgKind)`, `guard(min)`, `ownedOr404(loader, scope)` | `ads-agent/lib/auth/scope.ts`, `ads-agent/lib/auth/guard.ts` | 17 |

---

## Contradictions between the specs, resolved here

Recorded so no implementer has to decide alone.

**Child tables and `org_id`.** Tenancy spec §2a states `campaign_draft_messages`, `performance_snapshots` and `crm_signal_snapshots` are *not* given `org_id` and are scoped by joining their parent. Data model §0 states `org_id UUID NOT NULL` on every domain table, "no exceptions; a table without it cannot be RLS-protected", and its own enquiry spine (§3) puts `org_id` on every child table including `enquiry_messages` and `enquiry_activities`. **The data model wins.** Every table gets `org_id`, because a child table without it cannot carry an RLS policy and would be reachable directly by any query that names it. The parent join stays as the *backfill* source, not as the isolation mechanism.

**`decided_via` vocabulary.** Tenancy spec §2c permits `('ui','bulk','api','system')`; an earlier draft of this plan used `('ui','bulk','api')`. The spec wins — `system` is needed for the scheduled-execution worker.

**Platform cross-org reads under RLS.** Tenancy spec §1 grants platform scope cross-org reads; datastore §5.1 forbids cross-tenant access being "a flag on the existing service". These are about different things: §5.1 governs the *cross-tenant analytics service* that aggregates across brokers and is unreachable from the MCP server, and that service is out of S3 scope. Platform scope in the admin app is explicitly sanctioned by tenancy §1. It is implemented as a transaction-local flag settable only through `public.set_platform()`, visible only to `USING`, and covered by four negative tests in Task 18.

---

## Parallel execution model

`superpowers:subagent-driven-development` lists "dispatch multiple implementation subagents in parallel" under **Never**, because agents sharing a working tree corrupt each other. Real parallelism therefore means **one git worktree and branch per agent** — the `best-of-n-runner` subagent type — with an explicit fan-in merge task closing each wave. Ceiling of **8 concurrent implementation subagents**; this plan never reaches it, because the evidence does not support it.

### Wave table

| Wave | Tasks | Width | Why that width |
|---|---|---|---|
| S1-a | 1, 2 | **2** | Task 1 touches `lib/db/{migrate,client}.ts`, `lib/db/migrations/`, `lib/db/schema.sql`, `lib/auth/dal.ts`. Task 2 touches seven files under `app/api/`. Zero overlap. Task 2 *imports* `dal.ts` but does not modify it. |
| S1-b | 3 | **1** | Task 3 needs Task 1's migration runner before migration 002 can be applied, and it modifies `app/api/proposals/[id]/{approve,reject}/route.ts`, which Task 2 also modifies. Both a dependency and a file conflict. |
| S1-c | 4 | **1** | Fan-in: merges the S1-a and S1-b branches and runs the S1 gate. |
| S2 | 5 → 6 → 7 → 8 | **1** | Sequential by necessity, not by file overlap: the image must build before a restore is rehearsed against it, the rehearsal is the gate for the consolidation, and the consolidation is a single irreversible cutover. Datastore §12.5 and the build sequence's abort criteria both make this ordering explicit. |
| S3-A | 9 | **1** | `scope-sql.ts`, `tx.ts` and the tenant SQL primitives are imported by every task in S3-B. Their signatures cannot change once seven branches exist. |
| S3-B-1 | 10, 11, 12 | **3** | Proven disjoint below. |
| S3-B-2 | 13, 14 | **2** | Proven disjoint below. |
| S3-B-3 | 15 | **1** | Task 15 and Task 16 both modify `app/(admin)/page.tsx`, `lib/openui/crm-tools.ts` and `app/api/crm/opportunities/[id]/stage/route.ts`. |
| S3-B-4 | 16 | **1** | Same three shared files as Task 15, plus `lib/decision-engine/cycle.ts` shared with 10 and 13. |
| S3-C-1 | 17 | **1** | Fan-in: merges seven S3-B branches, then modifies all 18 API route files at once. |
| S3-C-2 | 18 | **1** | Release gate. One suite, one verdict. |

### Why S3-B is 7 units in 4 waves and not 7 units in 1 wave

The importer lists establish that five of the seven units modify `ads-agent/lib/decision-engine/cycle.ts` and three modify `ads-agent/app/(admin)/page.tsx`. Those two files are the binding constraint, not agent availability. The full per-unit file sets:

| Unit | Task | Data-layer files | Migrations | Call sites modified |
|---|---|---|---|---|
| U1 `proposals` + `campaign-drafts` | 10 | `lib/db/proposals.ts`, `lib/db/campaign-drafts.ts` (+ both `.test.ts`) | 009 | `app/(admin)/proposals/page.tsx`, `app/(admin)/proposals/[id]/page.tsx`, `app/(admin)/campaigns/drafts/[id]/page.tsx`, `app/(admin)/campaigns/new/page.tsx`, `app/api/proposals/[id]/route.ts`, `app/api/proposals/[id]/approve/route.ts`, `app/api/proposals/[id]/reject/route.ts`, `app/api/campaign-drafts/[id]/route.ts`, `app/api/campaign-drafts/[id]/messages/route.ts`, `app/api/campaign-drafts/[id]/create-proposal/route.ts`, `lib/decision-engine/cycle.ts`, `lib/executor/execute.ts`, `lib/openui/analytics-tools.ts`, `lib/openui/campaign-tools.ts`, `mcp/google-ads-server/tools.ts` |
| U2 `settings` | 11 | `lib/db/settings.ts` → `lib/db/org-settings.ts` (+ `.test.ts`) | 008 | `app/(admin)/layout.tsx`, `app/(admin)/settings/page.tsx`, `app/api/settings/route.ts`, `app/api/cycle/run/route.ts`, `scripts/run-decision-cycle.ts`, `scripts/run-once.ts` |
| U6 `credits` | 12 | `lib/db/credits.ts` (+ `.test.ts`) | 012 | `app/(admin)/credits/page.tsx` |
| U3+U5 `campaigns` + `snapshots` | 13 | `lib/db/campaigns.ts`, `lib/db/snapshots.ts` (+ both `.test.ts`) | 010, 011 | `app/api/campaigns/[id]/status/route.ts`, `lib/decision-engine/cycle.ts`, `lib/executor/execute.ts` |
| U4 `dashboard` | 14 | `lib/db/dashboard.ts` (+ `.test.ts`) | — | `app/(admin)/page.tsx`, `app/(admin)/campaigns/page.tsx`, `components/SpendCplChart.tsx`, `lib/openui/analytics-tools.ts` |
| U7 `ai-action-log` → `audit-log` | 15 | `lib/db/ai-action-log.ts` → `lib/db/audit-log.ts` (+ `.test.ts`) | 013 | `app/(admin)/page.tsx`, `app/api/crm/opportunities/[id]/stage/route.ts`, `lib/decision-engine/cycle.ts`, `lib/openui/crm-tools.ts` |
| U8 `twenty-pipeline` | 16 | `lib/crm/twenty-pipeline.ts`, `lib/connectors/twenty.ts`, `lib/bifrost/twenty-mcp-tools.ts`, root `lib/crm/twenty.ts` (+ `twenty-pipeline.test.ts`) | — | `app/(admin)/page.tsx`, `app/(admin)/crm/page.tsx`, `app/api/crm/opportunities/[id]/stage/route.ts`, `lib/decision-engine/cycle.ts`, `lib/openui/crm-tools.ts`, `lib/openui/opportunity-openui-lang.ts`, `lib/openui/resolve-tools-then-generate.ts`, `lib/bifrost/mcp-client.ts`, root `app/api/leads/route.ts` |

Two unit-merge decisions, both forced by shared files rather than convenience:

- **U1 is `proposals` + `campaign-drafts` together** because `app/api/campaign-drafts/[id]/create-proposal/route.ts` imports both. Two agents changing either signature would both have to edit that file.
- **U3 is `campaigns` + `snapshots` together** because both modify `lib/decision-engine/cycle.ts` and both are small (6 and 4 exported functions). Splitting them would cost a wave and buy nothing.

**U7 and U8 stay separate tasks in separate waves** even though they share three files, because a reviewer can legitimately reject the interim Twenty platform-only guard while approving the audit-log conversion, and vice versa. Task right-sizing beats wave count.

**Disjointness proof for the two multi-width S3-B waves.** Wave S3-B-1 = {10, 11, 12}. Task 11's six call sites (`layout.tsx`, `settings/page.tsx`, `settings/route.ts`, `cycle/run/route.ts`, `scripts/run-decision-cycle.ts`, `scripts/run-once.ts`) appear in no other unit's list. Task 12's single call site (`credits/page.tsx`) appears in no other unit's list. Task 10's fifteen call sites include none of those nine files. Wave S3-B-2 = {13, 14}: Task 13's three call sites are `campaigns/[id]/status/route.ts`, `cycle.ts`, `execute.ts`; Task 14's four are `page.tsx`, `campaigns/page.tsx`, `SpendCplChart.tsx`, `analytics-tools.ts`. No file appears in both. `analytics-tools.ts` is shared between 10 and 14, and `cycle.ts`/`execute.ts` between 10 and 13, which is why 13 and 14 cannot join wave S3-B-1.

**Migration numbers claimed per task.** No two tasks in one wave claim the same number.

| Task | Wave | Migrations |
|---|---|---|
| 1 | S1-a | 001 |
| 3 | S1-b | 002 |
| 7 | S2 | 003, 004 |
| 8 | S2 | 005 |
| 9 | S3-A | 006, 007 |
| 11 | S3-B-1 | 008 |
| 10 | S3-B-1 | 009 |
| 12 | S3-B-1 | 012 |
| 13 | S3-B-2 | 010, 011 |
| 15 | S3-B-3 | 013 |
| — | — | 014–019 reserved, unclaimed |

### Worktree protocol for every parallel wave

Run once per wave, from the repo root, before dispatching:

```bash
git worktree add ../gs-t10 -b s3b/u1-proposals-drafts main
git worktree add ../gs-t11 -b s3b/u2-settings main
git worktree add ../gs-t12 -b s3b/u6-credits main
```

Each agent works only inside its own worktree. The fan-in task merges with `git merge --no-ff` in task-number order and removes the worktrees with `git worktree remove`.

---

# S1 — Fix the live defects

Repairs code as it stands today, against the current `ads_agent` database on its own instance. No consolidation, no RLS. Produces working software on its own.

## Task 1: Migration runner and the role vocabulary

**Skills:** `postgres-pro`, `database-designer`, `typescript-pro`
**Model:** `inherit` — the runner's failure semantics and the `schema.sql`-plus-ledger interaction need judgement.

**Files:**
- Modify: `ads-agent/lib/db/migrate.ts` (whole file, currently 19 lines)
- Create: `ads-agent/lib/db/migrations/001_role_vocabulary.up.sql`
- Create: `ads-agent/lib/db/migrations/001_role_vocabulary.down.sql`
- Modify: `ads-agent/lib/db/schema.sql:101`
- Modify: `ads-agent/lib/auth/dal.ts:15`, `ads-agent/lib/auth/dal.ts:44`
- Test: `ads-agent/lib/auth/dal.test.ts` (new)
- Test: `ads-agent/lib/db/migrations.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `migrate(): Promise<string[]>` returning the versions applied this run, and a `public.schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` ledger. Every later task's migration depends on this runner existing. Also produces `export const ROLE_RANK` from `lib/auth/dal.ts`.

**Context.** `lib/db/schema.sql:101` declares `role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member'))` while `lib/auth/dal.ts:12` declares `MemberRole = "admin" | "operator" | "viewer"` with `ROLE_RANK = { viewer: 1, operator: 2, admin: 3 }`. The database cannot store two of the three roles, and a stored `member` resolves to `undefined` in the rank lookup, so `requireRole` denies unpredictably (validation F-2). Separately, `dal.ts:44` inserts `role` as the literal `'member'` on every verified request — after migration 001 that INSERT violates the new CHECK, so it must change in the same commit or every login breaks.

- [ ] **Step 1: Write the failing role-vocabulary test**

Create `ads-agent/lib/auth/dal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_RANK, type MemberRole } from "./dal";

describe("role vocabulary", () => {
  it("ranks every role the database can store", () => {
    const storable: MemberRole[] = ["admin", "operator", "viewer"];
    for (const role of storable) {
      expect(ROLE_RANK[role], `${role} must have a rank`).toBeTypeOf("number");
    }
  });

  it("has no rank for a value the database can no longer store", () => {
    expect((ROLE_RANK as Record<string, number>).member).toBeUndefined();
  });

  it("never writes the retired 'member' literal when shadowing a user row", () => {
    const src = readFileSync(join(__dirname, "dal.ts"), "utf8");
    expect(src).not.toContain("'member'");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/auth/dal.test.ts`
Expected: FAIL — `ROLE_RANK` is not an exported member of `./dal`, and the third case fails on the `'member'` literal at `dal.ts:44`.

- [ ] **Step 3: Export `ROLE_RANK` and stop writing `'member'`**

In `ads-agent/lib/auth/dal.ts`, change line 15 from `const ROLE_RANK` to:

```ts
export const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };
```

And change the second query inside `ensureShadowRows` (lines 42–47) to seed the least-privileged role:

```ts
  await getPool().query(
    `INSERT INTO users (id, org_id, email, display_name, role)
     VALUES ($1, $2, $3, $3, 'viewer')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [session.userId, session.orgId, session.email],
  );
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd ads-agent && npx vitest run lib/auth/dal.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing migration-runner test**

Create `ads-agent/lib/db/migrations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "migrations");

describe("migration files", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
  const ups = files.filter((f) => f.endsWith(".up.sql"));

  it("has at least one migration", () => {
    expect(ups.length).toBeGreaterThan(0);
  });

  it("every up has a matching down", () => {
    for (const up of ups) {
      expect(files, `${up} needs a down`).toContain(up.replace(".up.sql", ".down.sql"));
    }
  });

  it("uses NNN_name numbering with no duplicate numbers", () => {
    const numbers = ups.map((f) => {
      expect(f).toMatch(/^\d{3}_[a-z0-9_]+\.up\.sql$/);
      return f.slice(0, 3);
    });
    expect(new Set(numbers).size, "duplicate migration number").toBe(numbers.length);
  });

  it("contains no transaction control — the runner owns the transaction", () => {
    for (const file of files) {
      const sql = readFileSync(join(DIR, file), "utf8").toUpperCase();
      expect(sql, `${file} must not BEGIN`).not.toMatch(/^\s*BEGIN\s*;/m);
      expect(sql, `${file} must not COMMIT`).not.toMatch(/^\s*COMMIT\s*;/m);
    }
  });
});

describe("migrate()", () => {
  it("exports a function returning the versions it applied", async () => {
    const mod = await import("./migrate");
    expect(mod.migrate).toBeTypeOf("function");
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/migrations.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, scandir '.../lib/db/migrations'`.

- [ ] **Step 7: Write migration 001**

Create `ads-agent/lib/db/migrations/001_role_vocabulary.up.sql`:

```sql
-- F-2: schema.sql permitted only admin|member while lib/auth/dal.ts expects
-- admin|operator|viewer, so two of three roles could not be stored at all and a
-- stored 'member' resolved to undefined in ROLE_RANK.
-- No BEGIN/COMMIT: lib/db/migrate.ts wraps every migration in one transaction.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- 'member' has no equivalent in the code's vocabulary. 'operator' is the closest
-- existing meaning: can act, cannot administer. Preserves today's capability.
UPDATE public.users SET role = 'operator' WHERE role = 'member';

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin','operator','viewer'));

-- Least privilege by default: a newly shadowed user can read until promoted.
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'viewer';
```

Create `ads-agent/lib/db/migrations/001_role_vocabulary.down.sql`:

```sql
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'member' WHERE role IN ('operator','viewer');
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin','member'));
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'member';
```

- [ ] **Step 8: Rewrite `migrate.ts` as a numbered runner**

Replace the entire contents of `ads-agent/lib/db/migrate.ts` with:

```ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./client";

const MIGRATIONS_DIR = path.join(process.cwd(), "lib/db/migrations");

/**
 * Applies the idempotent baseline (schema.sql), then every numbered migration
 * not already recorded in public.schema_migrations, each in its own transaction.
 *
 * The ledger lives in the database, not in a file, so it travels with the
 * pg_dump that S2 restores into the adsagent schema — which is what stops the
 * pre-consolidation migrations (001, 002) being replayed against tables that
 * have since moved schema.
 */
export async function migrate(): Promise<string[]> {
  const pool = getPool();

  const baselinePath = path.join(process.cwd(), "lib/db/schema.sql");
  await pool.query(readFileSync(baselinePath, "utf-8"));

  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await pool.query<{ version: string }>(
    `SELECT version FROM public.schema_migrations`,
  );
  const applied = new Set(rows.map((r) => r.version));

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.replace(".up.sql", ""))
    .sort()
    .filter((version) => !applied.has(version));

  const ran: string[] = [];
  for (const version of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, `${version}.up.sql`), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO public.schema_migrations (version) VALUES ($1)`, [version]);
      await client.query("COMMIT");
      ran.push(version);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(
        `migration ${version} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }
  return ran;
}

async function main(): Promise<void> {
  const ran = await migrate();
  console.log(
    ran.length > 0
      ? `ads-agent: applied ${ran.length} migration(s): ${ran.join(", ")}`
      : "ads-agent: no pending migrations",
  );
}

main().catch((err) => {
  console.error("ads-agent: migration failed", err);
  process.exit(1);
});
```

- [ ] **Step 9: Update `schema.sql` so a fresh database matches**

In `ads-agent/lib/db/schema.sql`, change line 101 to:

```sql
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','operator','viewer')),
```

Migration 001 is what reaches an already-provisioned database; this keeps a brand-new `npm run migrate` consistent with it.

- [ ] **Step 10: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/db/migrations.test.ts lib/auth/dal.test.ts`
Expected: PASS, 8 tests total.

- [ ] **Step 11: Apply the migration against the live `ads_agent` database and verify**

Run: `cd ads-agent && npm run migrate`
Expected stdout: `ads-agent: applied 1 migration(s): 001_role_vocabulary`

Run it a second time — idempotency is what `migrate.ts` demands:

Run: `cd ads-agent && npm run migrate`
Expected stdout: `ads-agent: no pending migrations`

Verify the constraint, using the `DATABASE_URL` from `ads-agent/.env.local`:

```bash
psql "$DATABASE_URL" -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'users_role_check'"
```

Expected: `CHECK ((role = ANY (ARRAY['admin'::text, 'operator'::text, 'viewer'::text])))`

```bash
psql "$DATABASE_URL" -c "SELECT count(*) AS stale FROM public.users WHERE role = 'member'"
```

Expected: `stale | 0`

- [ ] **Step 12: Commit**

```bash
git add ads-agent/lib/db/migrate.ts ads-agent/lib/db/migrations/ ads-agent/lib/db/migrations.test.ts \
        ads-agent/lib/db/schema.sql ads-agent/lib/auth/dal.ts ads-agent/lib/auth/dal.test.ts
git commit -m "fix(auth): make the role vocabulary storable, on a numbered migration runner

schema.sql permitted only admin|member while dal.ts expected
admin|operator|viewer, so two of three roles could not be stored and a stored
'member' resolved to undefined in ROLE_RANK. Fixing it needs an explicit ALTER,
which needs a runner: migrate.ts re-ran the whole schema and CREATE TABLE IF NOT
EXISTS is a no-op against an existing table. ensureShadowRows stops writing the
retired 'member' literal, which the new CHECK would reject."
```

## Task 2: Guard the seven unauthenticated mutation routes

**Skills:** `senior-backend`, `security-auditor`
**Model:** `composer-2.5-fast` — the guard code and the per-route role table are given in full below; this is seven mechanical edits.

**Files:**
- Modify: `ads-agent/app/api/settings/route.ts`
- Modify: `ads-agent/app/api/cycle/run/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/approve/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/reject/route.ts`
- Modify: `ads-agent/app/api/campaign-drafts/[id]/route.ts`
- Modify: `ads-agent/app/api/campaign-drafts/[id]/create-proposal/route.ts`
- Test: `ads-agent/app/api/route-auth.test.ts` (new)

**Interfaces:**
- Consumes: `requireApiRole(min: MemberRole): Promise<ApiRoleCheckResult>` from `ads-agent/lib/auth/dal.ts:98`, where `ApiRoleCheckResult` is `{ ok: true; session: Session } | { ok: false; response: NextResponse }`.
- Produces: every mutation route returns 401 or 403 before touching the database. Task 17 replaces `requireApiRole` with `guard`, which additionally returns a `Scope`.

**Context.** `ads-agent/middleware.ts:26` has `matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]`, which excludes `/api` entirely, so these seven routes have no guard at all — reachable with no session (validation F-3). The worst is `app/api/proposals/[id]/approve/route.ts:13-14`, which calls `decideProposal` then `executeProposal` inline, provisioning a live Google Ads campaign with a real daily budget. Eleven other API routes already call `requireApiRole`; follow that pattern exactly rather than inventing one.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/app/api/route-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every route below performs a mutation or exposes org-wide configuration.
const GUARDED_ROUTES = [
  "settings/route.ts",
  "cycle/run/route.ts",
  "proposals/[id]/route.ts",
  "proposals/[id]/approve/route.ts",
  "proposals/[id]/reject/route.ts",
  "campaign-drafts/[id]/route.ts",
  "campaign-drafts/[id]/create-proposal/route.ts",
];

describe("every mutation route is guarded", () => {
  it.each(GUARDED_ROUTES)("%s calls requireApiRole", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("requireApiRole");
  });

  it.each(GUARDED_ROUTES)("%s returns the guard's response on failure", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("if (!access.ok) return access.response;");
  });
});
```

A static source check, deliberately: it costs nothing to run, cannot be satisfied by accident, and fails loudly the day someone adds an eighth route without a guard. The behavioural 401/403/404 assertions land in Task 18, once `guard` exists and a test database is wired up.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run app/api/route-auth.test.ts`
Expected: FAIL — 14 failures, all seven routes on both assertions.

- [ ] **Step 3: Add the guard to each of the seven routes**

Minimum role per route, deliberately not uniform:

| Route and method | Role | Why |
|---|---|---|
| `settings` GET | `viewer` | reading org configuration |
| `settings` PATCH | `admin` | changes org-wide automation behaviour |
| `cycle/run` POST | `admin` | triggers the autonomous decision cycle |
| `proposals/[id]` PATCH | `operator` | edits a pending proposal |
| `proposals/[id]/approve` POST | `operator` | spends money — see note |
| `proposals/[id]/reject` POST | `operator` | the operator's daily job |
| `campaign-drafts/[id]` PATCH | `operator` | edits a draft |
| `campaign-drafts/[id]/create-proposal` POST | `operator` | converts a draft |

`approve` stays at `operator` because approving is the operator's daily work; the guardrail against mistakes is the undo window (tenancy spec D9), not a higher role. Raising it to `admin` would make a solo-broker tenant unable to work.

`ads-agent/app/api/settings/route.ts` becomes:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { getCronSettings, setCronEnabled } from "@/lib/db/settings";

export async function GET() {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const settings = await getCronSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setCronEnabled(body.enabled);
  return NextResponse.json({ ok: true });
}
```

`ads-agent/app/api/cycle/run/route.ts` becomes:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { runDecisionCycle } from "@/lib/decision-engine/cycle";
import { touchLastRunAt } from "@/lib/db/settings";

export async function POST() {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  const result = await runDecisionCycle();
  await touchLastRunAt();
  return NextResponse.json(result);
}
```

`ads-agent/app/api/proposals/[id]/approve/route.ts` becomes:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { decideProposal, getProposalById } from "@/lib/db/proposals";
import { executeProposal } from "@/lib/executor/execute";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  await decideProposal(id, "approved");
  const result = await executeProposal(id);
  return NextResponse.json({ ok: true, result });
}
```

`ads-agent/app/api/proposals/[id]/reject/route.ts` becomes:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { decideProposal, getProposalById } from "@/lib/db/proposals";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  await decideProposal(id, "rejected");
  return NextResponse.json({ ok: true });
}
```

For the remaining three, add the import line and the two guard lines as the first statements of the exported handler, leaving every other line untouched.

In `ads-agent/app/api/proposals/[id]/route.ts`, add after line 1:

```ts
import { requireApiRole } from "@/lib/auth/dal";
```

and immediately after `export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {`:

```ts
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
```

In `ads-agent/app/api/campaign-drafts/[id]/route.ts`, add after line 1:

```ts
import { requireApiRole } from "@/lib/auth/dal";
```

and immediately after `export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {`:

```ts
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
```

In `ads-agent/app/api/campaign-drafts/[id]/create-proposal/route.ts`, add after line 1:

```ts
import { requireApiRole } from "@/lib/auth/dal";
```

and immediately after `export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {`:

```ts
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run app/api/route-auth.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole suite to prove nothing regressed**

Run: `cd ads-agent && npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/app/api/
git commit -m "fix(api): guard the seven unauthenticated mutation routes

middleware.ts excludes /api from its matcher, so these had no guard at all --
including proposals/[id]/approve, which decides and executes against live
Google Ads with a real daily budget."
```

## Task 3: Record who decided, and by what route

**Skills:** `postgres-pro`, `senior-backend`
**Model:** `composer-2.5-fast` — migration and implementation are given in full.

**Files:**
- Create: `ads-agent/lib/db/migrations/002_proposal_decider.up.sql`
- Create: `ads-agent/lib/db/migrations/002_proposal_decider.down.sql`
- Modify: `ads-agent/lib/db/proposals.ts:68-76`
- Modify: `ads-agent/lib/db/proposals.test.ts:102-111`
- Modify: `ads-agent/app/api/proposals/[id]/approve/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/reject/route.ts`

**Interfaces:**
- Consumes: `migrate()` from Task 1; `requireApiRole`'s `access.session.userId` from Task 2.
- Produces: `decideProposal(id: string, status: "approved" | "rejected", decidedBy: string, decidedVia: "ui" | "bulk" | "api" | "system"): Promise<void>`. Task 10 adds `scope: Scope` as the **first** parameter, making the final signature `decideProposal(scope, id, status, decidedBy, decidedVia)`.

**Context.** `decideProposal` currently runs `UPDATE proposals SET status = $2, decided_at = NOW() WHERE id = $1`. The product's entire premise is human-gated approval and no human is recorded (validation F-7). `decided_via` distinguishes a deliberate single approval from a bulk action, which the UX spec's bulk-cancel path needs.

- [ ] **Step 1: Write the failing test**

Replace the `describe("decideProposal", ...)` block in `ads-agent/lib/db/proposals.test.ts` (currently lines 102–111) with:

```ts
describe("decideProposal", () => {
  it("persists status, decider and decision route", async () => {
    query.mockResolvedValue({ rows: [] });
    await decideProposal(
      "11111111-1111-1111-1111-111111111111",
      "approved",
      "22222222-2222-2222-2222-222222222222",
      "ui",
    );
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("decided_at = NOW()");
    expect(sql).toContain("decided_by = $3");
    expect(sql).toContain("decided_via = $4");
    expect(params).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "approved",
      "22222222-2222-2222-2222-222222222222",
      "ui",
    ]);
  });

  it("defaults the decision route to ui", async () => {
    query.mockResolvedValue({ rows: [] });
    await decideProposal("prop-1", "rejected", "user-1");
    expect(query.mock.calls[0][1][3]).toBe("ui");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts`
Expected: FAIL — TypeScript reports `Expected 2 arguments, but got 4` for `decideProposal`.

- [ ] **Step 3: Write migration 002**

Create `ads-agent/lib/db/migrations/002_proposal_decider.up.sql`:

```sql
-- F-7: the human-gated approval workflow recorded no human.
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS decided_by  UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS decided_via TEXT;

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_decided_via_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_decided_via_check
  CHECK (decided_via IS NULL OR decided_via IN ('ui','bulk','api','system'));
```

Create `ads-agent/lib/db/migrations/002_proposal_decider.down.sql`:

```sql
ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_decided_via_check;
ALTER TABLE public.proposals
  DROP COLUMN IF EXISTS decided_by,
  DROP COLUMN IF EXISTS decided_via;
```

- [ ] **Step 4: Implement `decideProposal`**

Replace `ads-agent/lib/db/proposals.ts` lines 68–76 with:

```ts
export async function decideProposal(
  id: string,
  status: "approved" | "rejected",
  decidedBy: string,
  decidedVia: "ui" | "bulk" | "api" | "system" = "ui",
): Promise<void> {
  await getPool().query(
    `UPDATE proposals
        SET status = $2, decided_at = NOW(), decided_by = $3, decided_via = $4
      WHERE id = $1`,
    [id, status, decidedBy, decidedVia],
  );
}
```

- [ ] **Step 5: Pass the decider from both call sites**

In `ads-agent/app/api/proposals/[id]/approve/route.ts`, change the `decideProposal` call to:

```ts
  await decideProposal(id, "approved", access.session.userId, "ui");
```

In `ads-agent/app/api/proposals/[id]/reject/route.ts`, change the `decideProposal` call to:

```ts
  await decideProposal(id, "rejected", access.session.userId, "ui");
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Apply the migration and verify**

Run: `cd ads-agent && npm run migrate`
Expected stdout: `ads-agent: applied 1 migration(s): 002_proposal_decider`

```bash
psql "$DATABASE_URL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name IN ('decided_by','decided_via') ORDER BY column_name"
```

Expected two rows: `decided_by | uuid` and `decided_via | text`.

- [ ] **Step 8: Commit**

```bash
git add ads-agent/lib/db/proposals.ts ads-agent/lib/db/proposals.test.ts \
        ads-agent/lib/db/migrations/ ads-agent/app/api/proposals/
git commit -m "feat(proposals): record who decided and by what route

The human-gated approval workflow recorded no human. decided_via separates a
deliberate single approval from a bulk action, which the bulk-cancel path needs."
```

## Task 4 (fan-in): the S1 gate

**Skills:** `senior-qa`, `code-reviewer`
**Model:** `inherit` — merge conflict resolution and gate judgement.

**Files:**
- Modify: none expected beyond conflict resolution in `ads-agent/app/api/proposals/[id]/{approve,reject}/route.ts`
- Test: `ads-agent/lib/db/migrate.roundtrip.test.ts` (new)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a `main` branch on which every migration is reversible and re-appliable.

- [ ] **Step 1: Merge the S1-a and S1-b branches**

```bash
git checkout main
git merge --no-ff s1/task1-role-vocabulary
git merge --no-ff s1/task2-route-auth
git merge --no-ff s1/task3-proposal-decider
```

Expected conflicts: `approve/route.ts` and `reject/route.ts` only, where Task 2 added the guard and Task 3 changed the `decideProposal` call. The resolved `approve/route.ts` is exactly:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { decideProposal, getProposalById } from "@/lib/db/proposals";
import { executeProposal } from "@/lib/executor/execute";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  await decideProposal(id, "approved", access.session.userId, "ui");
  const result = await executeProposal(id);
  return NextResponse.json({ ok: true, result });
}
```

and the resolved `reject/route.ts` is exactly:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { decideProposal, getProposalById } from "@/lib/db/proposals";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  await decideProposal(id, "rejected", access.session.userId, "ui");
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write the failing down-migration round-trip test**

This needs a real database. Create `ads-agent/lib/db/migrate.roundtrip.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
let pool: Pool;

beforeAll(() => {
  if (url) pool = new Pool({ connectionString: url, max: 2 });
});
afterAll(async () => {
  if (pool) await pool.end();
});

suite("every down migration reverses its up", () => {
  it("002 removes and restores the decider columns", async () => {
    const dir = join(__dirname, "migrations");
    const down = readFileSync(join(dir, "002_proposal_decider.down.sql"), "utf8");
    const up = readFileSync(join(dir, "002_proposal_decider.up.sql"), "utf8");

    const countCols = async () => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'proposals'
            AND column_name IN ('decided_by','decided_via')`,
      );
      return Number(rows[0].n);
    };

    expect(await countCols()).toBe(2);
    await pool.query(down);
    expect(await countCols()).toBe(0);
    await pool.query(up);
    expect(await countCols()).toBe(2);
  });

  it("001 restores the widened role CHECK after a down-and-up", async () => {
    const dir = join(__dirname, "migrations");
    await pool.query(readFileSync(join(dir, "001_role_vocabulary.down.sql"), "utf8"));
    await pool.query(readFileSync(join(dir, "001_role_vocabulary.up.sql"), "utf8"));
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'users_role_check'`,
    );
    expect(rows[0].def).toContain("operator");
    expect(rows[0].def).toContain("viewer");
  });
});
```

- [ ] **Step 3: Run it against a real database and watch it pass**

```bash
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/migrate.roundtrip.test.ts
```

Expected: PASS, 2 tests. Without `TEST_DATABASE_URL` the suite reports 2 skipped, which is the intended CI-without-a-database behaviour.

- [ ] **Step 4: Run both apps' full suites**

Run: `cd ads-agent && npx vitest run`
Expected: all green.

Run: `cd /Users/swami/Documents/GentleSpace_Web && npx vitest run`
Expected: all green — S1 does not touch the listings app.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/migrate.roundtrip.test.ts ads-agent/app/api/proposals/
git commit -m "test(db): prove every S1 migration is reversible and re-appliable"
```

**S1 gate — stop and confirm before S2.** Three defects fixed (F-2, F-3, F-7). A numbered migration runner exists with a database-side ledger. Every up has a down, no migration contains transaction control, both down migrations verified to reverse cleanly against a live database. Both apps' suites green.

---

# S2 — Consolidation onto PostgreSQL 18

Sequential throughout, one agent per task, one after another. The least reversible work in the programme.

**Abort criteria (build sequence, gate review G-3).** Abort and restore from the pre-migration base backup if any of: data checksums disagree between source and merged instance; either app cannot run for more than 30 minutes on the merged instance; or a PG18 behavioural difference surfaces that was not caught here.

**The old instances stay running and untouched until S3 has passed on the new one.** Do not decommission `ads_agent` on :5434 at the end of S2. That is the tempting mistake, and it is the thing that turns an abort into an outage.

## Task 5: PostgreSQL 18 + Apache AGE image

**Skills:** `senior-devops`, `docker-expert`
**Model:** `inherit` — the AGE branch name must be discovered at build time and the escalation decision is a judgement call.

**Files:**
- Modify: `docker/Dockerfile.postgres` (whole file, currently 16 lines)
- Modify: `docker-compose.listings.yml:6`

**Interfaces:**
- Consumes: nothing.
- Produces: a `gentle-space-pg:pg18-age` image where `SELECT uuidv7()` works and `age`, `vector` and `plpgsql` all load. Every later migration in this plan assumes `uuidv7()` exists.

**Context.** The current image is `pgvector/pgvector:pg16` with `AGE_BRANCH=release/PG16/1.6.0`. Data model §0 targets PostgreSQL 18 for native `uuidv7()` and Apache AGE `PG18/v1.8.0-rc0`. AGE's git *branch* names differ from its *tag* names — the current pin is a branch, the spec names a tag — so the branch must be confirmed against the repository rather than guessed.

- [ ] **Step 1: Discover the correct AGE branch name**

```bash
git ls-remote --heads https://github.com/apache/age.git | grep -i 'PG18'
git ls-remote --tags  https://github.com/apache/age.git | grep -i 'PG18'
```

Expected: at least one branch matching `refs/heads/release/PG18/...` and a tag matching `refs/tags/PG18/v1.8.0-rc0`. Record the exact branch string. If a PG18 release branch does not exist, use the tag directly — `git clone --branch` accepts a tag.

**If neither a PG18 branch nor the `PG18/v1.8.0-rc0` tag exists: stop and escalate.** Do not substitute a PG17 branch or the PG16 pin.

- [ ] **Step 2: Rewrite the Dockerfile**

Replace the entire contents of `docker/Dockerfile.postgres` with, substituting the branch discovered in Step 1 for `<AGE_REF>`:

```dockerfile
FROM pgvector/pgvector:pg18
USER root
# Confirmed against `git ls-remote https://github.com/apache/age.git` at build time --
# AGE's branch names differ from its tag names, so this must not be guessed.
ARG AGE_BRANCH=<AGE_REF>
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git postgresql-server-dev-18 \
      libreadline-dev zlib1g-dev flex bison \
    && update-ca-certificates \
    && git clone --branch "${AGE_BRANCH}" --depth 1 https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age \
    && make PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config \
    && make install PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config \
    && rm -rf /tmp/age \
    && apt-get purge -y --auto-remove build-essential git postgresql-server-dev-18 \
    && rm -rf /var/lib/apt/lists/* \
    && echo "shared_preload_libraries = 'age'" >> /usr/share/postgresql/postgresql.conf.sample
USER postgres
```

Change `docker-compose.listings.yml:6` from `image: gentle-space-pg:pg16-age` to:

```yaml
    image: gentle-space-pg:pg18-age
```

- [ ] **Step 3: Build the image**

```bash
cd /Users/swami/Documents/GentleSpace_Web && docker compose -f docker-compose.listings.yml build
```

Expected: `naming to docker.io/library/gentle-space-pg:pg18-age done`.

**If the AGE build fails against PostgreSQL 18: STOP and escalate. Do not proceed to Task 6.** The listings search boost in `/api/spaces/search` depends on AGE and it is in the hot path (datastore UD9). The fallback — dropping AGE and moving the boost onto the node/edge tables — is a design change that alters the S8 context-graph plan, not an implementer's call. Report the compiler output and the branch tried.

- [ ] **Step 4: Verify the extensions load on a scratch volume**

Do not start the new image against the existing `gentle_space_pgdata` volume — a PG16 data directory is not readable by PG18. Bring up a throwaway container instead:

```bash
docker run -d --name pg18-probe -e POSTGRES_USER=gentle -e POSTGRES_PASSWORD=gentle \
  -e POSTGRES_DB=probe -p 5533:5432 gentle-space-pg:pg18-age \
  postgres -c shared_preload_libraries=age
sleep 10
docker exec pg18-probe psql -U gentle -d probe -c "CREATE EXTENSION IF NOT EXISTS age; CREATE EXTENSION IF NOT EXISTS vector;"
docker exec pg18-probe psql -U gentle -d probe -c "SELECT extname, extversion FROM pg_extension ORDER BY extname"
```

Expected three rows: `age`, `plpgsql`, `vector`.

- [ ] **Step 5: Verify `uuidv7()` — this is the entire reason for the upgrade**

```bash
docker exec pg18-probe psql -U gentle -d probe -tAc "SELECT uuidv7()"
docker exec pg18-probe psql -U gentle -d probe -tAc "SELECT uuidv7() < uuidv7()"
```

Expected: a UUID string, then `t`. The second assertion is the property that matters — time-ordered keys append to the B-tree instead of scattering.

- [ ] **Step 6: Tear down the probe and commit**

```bash
docker rm -f pg18-probe
git add docker/Dockerfile.postgres docker-compose.listings.yml
git commit -m "build(db): move the listings image to PostgreSQL 18 + AGE PG18

PG18 for native uuidv7(), which every table in the data model depends on. AGE's
branch name was confirmed against the upstream repository rather than derived
from the tag in the spec."
```

## Task 6: Rehearse the restore

**Skills:** `senior-devops`, `deployment-engineer`
**Model:** `inherit` — verifying a restore is genuinely equivalent needs judgement.

**Files:**
- Create: `scripts/consolidate/01-backup.sh`
- Create: `scripts/consolidate/02-rehearse-restore.sh`
- Create: `scripts/consolidate/rowcounts.sql`
- Modify: `.gitignore` (add `backups/`)

**Interfaces:**
- Consumes: `gentle-space-pg:pg18-age` from Task 5.
- Produces: `backups/pre-s2-listings.dump`, `backups/pre-s2-adsagent.dump`, `backups/pre-s2-globals.sql`, and a demonstrated restore of both into a scratch PG18 instance with matching row counts.

**Context.** The build sequence makes both S2 and S3 conditional on **a restore having been rehearsed, not merely a backup having been taken** — "an untested backup is a hope." Datastore §12.5 defines the drill and notes the asymmetry that makes it cheap: only Postgres holds anything irreplaceable.

- [ ] **Step 1: Write the row-count query used on both sides of the drill**

Create `scripts/consolidate/rowcounts.sql`:

```sql
-- Emits one row per table as "schema.table<TAB>count", ordered, so the source
-- and the restored copy can be diffed byte-for-byte.
SELECT format('%s.%s', n.nspname, c.relname) AS table_name,
       (SELECT count(*) FROM pg_catalog.pg_class x WHERE x.oid = c.oid) * 0
         + (xpath('/row/c/text()',
             query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                          false, true, '')))[1]::text::bigint AS row_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('pg_catalog','information_schema','ag_catalog')
 ORDER BY 1;
```

- [ ] **Step 2: Write the backup script**

Create `scripts/consolidate/01-backup.sh`:

```bash
#!/usr/bin/env bash
# Pre-S2 base backup. Both source instances, plus globals (roles are not in a
# per-database dump). Run from the repo root.
set -euo pipefail

: "${LISTINGS_URL:?set LISTINGS_URL, e.g. postgresql://gentle:gentle@localhost:5433/gentle_space_listings}"
: "${ADSAGENT_URL:?set ADSAGENT_URL to the DATABASE_URL from ads-agent/.env.local}"

mkdir -p backups
pg_dumpall --globals-only --dbname "$LISTINGS_URL" > backups/pre-s2-globals.sql
pg_dump -Fc --dbname "$LISTINGS_URL" -f backups/pre-s2-listings.dump
pg_dump -Fc --dbname "$ADSAGENT_URL" -f backups/pre-s2-adsagent.dump

psql -Aqt -F$'\t' --dbname "$LISTINGS_URL" -f scripts/consolidate/rowcounts.sql \
  > backups/pre-s2-listings.rowcounts
psql -Aqt -F$'\t' --dbname "$ADSAGENT_URL" -f scripts/consolidate/rowcounts.sql \
  > backups/pre-s2-adsagent.rowcounts

echo "backup complete:"
ls -l backups/
```

Make it executable: `chmod +x scripts/consolidate/01-backup.sh`

- [ ] **Step 3: Write the rehearsal script**

Create `scripts/consolidate/02-rehearse-restore.sh`:

```bash
#!/usr/bin/env bash
# Restores both dumps into a throwaway PG18 instance and diffs row counts
# against the source. This is the gate for S2 and S3: a backup nobody has
# restored is a hope, not a backup.
set -euo pipefail

CONTAINER=pg18-rehearsal
PORT=5534
BASE="postgresql://gentle:gentle@localhost:${PORT}"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=gentle -e POSTGRES_PASSWORD=gentle -e POSTGRES_DB=postgres \
  -p "${PORT}:5432" gentle-space-pg:pg18-age \
  postgres -c shared_preload_libraries=age >/dev/null

until pg_isready -h localhost -p "$PORT" -U gentle >/dev/null 2>&1; do sleep 1; done

psql -q "${BASE}/postgres" -f backups/pre-s2-globals.sql || true
psql -q "${BASE}/postgres" -c 'CREATE DATABASE gentle_space_listings'
psql -q "${BASE}/postgres" -c 'CREATE DATABASE ads_agent'

pg_restore --no-owner --no-privileges -d "${BASE}/gentle_space_listings" backups/pre-s2-listings.dump
pg_restore --no-owner --no-privileges -d "${BASE}/ads_agent"              backups/pre-s2-adsagent.dump

psql -Aqt -F$'\t' "${BASE}/gentle_space_listings" -f scripts/consolidate/rowcounts.sql \
  > backups/rehearsed-listings.rowcounts
psql -Aqt -F$'\t' "${BASE}/ads_agent" -f scripts/consolidate/rowcounts.sql \
  > backups/rehearsed-adsagent.rowcounts

echo "--- listings row-count diff ---"
diff backups/pre-s2-listings.rowcounts backups/rehearsed-listings.rowcounts
echo "--- ads_agent row-count diff ---"
diff backups/pre-s2-adsagent.rowcounts backups/rehearsed-adsagent.rowcounts

psql -Aqt "${BASE}/gentle_space_listings" -c "SELECT count(*) FROM ag_catalog.ag_graph"
echo "REHEARSAL PASSED"
```

Make it executable: `chmod +x scripts/consolidate/02-rehearse-restore.sh`

- [ ] **Step 4: Keep backups out of git**

Append to `.gitignore`:

```
backups/
```

- [ ] **Step 5: Take the backup**

```bash
cd /Users/swami/Documents/GentleSpace_Web
LISTINGS_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
ADSAGENT_URL="$(grep -m1 '^DATABASE_URL=' ads-agent/.env.local | cut -d= -f2- | tr -d '"')" \
  ./scripts/consolidate/01-backup.sh
```

Expected: four files plus two `.rowcounts` files listed, all non-zero in size.

- [ ] **Step 6: Rehearse the restore and watch the diffs come back empty**

```bash
cd /Users/swami/Documents/GentleSpace_Web && ./scripts/consolidate/02-rehearse-restore.sh
```

Expected: both `diff` sections print nothing, the `ag_graph` count prints a number greater than 0, and the last line is `REHEARSAL PASSED`. Any non-empty diff aborts S2 — the backup is not equivalent to the source and there is nothing to fall back to.

- [ ] **Step 7: Commit**

```bash
git add scripts/consolidate/ .gitignore
git commit -m "ops(db): rehearse the pre-S2 restore, not just the backup

The build sequence gates S2 and S3 on a restore having been performed, because
an untested backup is a hope. Row counts are diffed source-versus-restored on
both instances and the AGE graph catalogue is asserted non-empty."
```

## Task 7: Schemas, roles, grants, and the `listings` schema move

**Skills:** `postgres-pro`, `database-designer`, `security-engineer`
**Model:** `inherit` — grant design and search_path interaction with `ag_catalog` need judgement.

**Files:**
- Create: `ads-agent/lib/db/migrations/003_schemas_and_roles.up.sql` / `.down.sql`
- Create: `ads-agent/lib/db/migrations/004_listings_schema_move.up.sql` / `.down.sql`
- Create: `scripts/consolidate/03-set-role-passwords.sh`
- Test: `ads-agent/lib/db/schema-layout.test.ts` (new)

**Interfaces:**
- Consumes: `migrate()` from Task 1, the PG18 image from Task 5, the rehearsed restore from Task 6.
- Produces: schemas `listings`, `adsagent`, `context`, `derived` (and the pre-existing `public`); roles `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, `derived_rw`, `agent_ro`. Every migration from 005 onward, in this plan and in all six sibling plans, is schema-qualified against these names.

**Context.** Data model §0 gives one schema per service with one database role each, plus the read-only non-owner `agent_ro` that makes `FORCE ROW LEVEL SECURITY` meaningful (validation F-20). The listings app's four tables currently sit in `public` and are referenced unqualified from `lib/db/*`; every downstream spec names them `listings.listings` and `listings.listing_corridors`, so they must move. Per-role `search_path` is what keeps the existing unqualified application SQL working, and `ag_catalog` must stay first for AGE.

- [ ] **Step 1: Write the failing schema-layout test**

Create `ads-agent/lib/db/schema-layout.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
let pool: Pool;

beforeAll(() => {
  if (url) pool = new Pool({ connectionString: url, max: 2 });
});
afterAll(async () => {
  if (pool) await pool.end();
});

suite("consolidated schema layout", () => {
  it("has all five schemas", async () => {
    const { rows } = await pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname IN ('listings','adsagent','context','public','derived')
        ORDER BY nspname`,
    );
    expect(rows.map((r) => r.nspname)).toEqual([
      "adsagent",
      "context",
      "derived",
      "listings",
      "public",
    ]);
  });

  it("has all six roles", async () => {
    const { rows } = await pool.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolname IN ('listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro')
        ORDER BY rolname`,
    );
    expect(rows.map((r) => r.rolname)).toEqual([
      "adsagent_rw",
      "agent_ro",
      "context_rw",
      "derived_rw",
      "listings_rw",
      "shared_rw",
    ]);
  });

  it("grants no role BYPASSRLS or SUPERUSER", async () => {
    const { rows } = await pool.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolname IN ('listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro')
          AND (rolbypassrls OR rolsuper)`,
    );
    expect(rows).toEqual([]);
  });

  it("gives agent_ro no write privilege anywhere", async () => {
    const { rows } = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'agent_ro' AND privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });

  it("puts the four listings tables in the listings schema", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'listings' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      "listing_enrichment_log",
      "listings",
      "search_queries",
      "sync_runs",
    ]);
  });

  it("leads every application role's search_path with ag_catalog", async () => {
    const { rows } = await pool.query<{ rolname: string; rolconfig: string[] | null }>(
      `SELECT rolname, rolconfig FROM pg_roles
        WHERE rolname IN ('listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro')`,
    );
    for (const row of rows) {
      const sp = (row.rolconfig ?? []).find((c) => c.startsWith("search_path="));
      expect(sp, `${row.rolname} has no search_path`).toBeDefined();
      expect(sp!.replace("search_path=", "").trim()).toMatch(/^ag_catalog\b/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ads-agent && TEST_DATABASE_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
  npx vitest run lib/db/schema-layout.test.ts
```

Expected: FAIL on all six cases — no schemas, no roles, tables still in `public`.

- [ ] **Step 3: Write migration 003**

Create `ads-agent/lib/db/migrations/003_schemas_and_roles.up.sql`:

```sql
-- Data model §0: one schema per service, one role per schema, plus the
-- read-only non-owner agent_ro that makes FORCE ROW LEVEL SECURITY meaningful.
-- Ownership of every table stays with the bootstrap role; these roles are
-- granted privileges only and never hold BYPASSRLS.
CREATE SCHEMA IF NOT EXISTS listings;
CREATE SCHEMA IF NOT EXISTS adsagent;
CREATE SCHEMA IF NOT EXISTS context;
CREATE SCHEMA IF NOT EXISTS derived;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- LOGIN with no password; scripts/consolidate/03-set-role-passwords.sh
      -- sets them from the environment so no secret lands in a migration file.
      EXECUTE format('CREATE ROLE %I LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE', r);
    END IF;
  END LOOP;
END $$;

-- ag_catalog must lead: AGE's operators and the _ag_label_* relations are
-- resolved from it and the existing listings graph queries are unqualified.
ALTER ROLE listings_rw SET search_path = ag_catalog, listings, public;
ALTER ROLE adsagent_rw SET search_path = ag_catalog, adsagent, public;
ALTER ROLE context_rw  SET search_path = ag_catalog, context, public;
ALTER ROLE shared_rw   SET search_path = ag_catalog, public;
ALTER ROLE derived_rw  SET search_path = ag_catalog, derived, public;
ALTER ROLE agent_ro    SET search_path = ag_catalog, adsagent, context, listings, public;

GRANT USAGE ON SCHEMA ag_catalog TO listings_rw, adsagent_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT USAGE ON SCHEMA public     TO listings_rw, adsagent_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT USAGE ON SCHEMA listings   TO listings_rw, agent_ro;
GRANT USAGE ON SCHEMA adsagent   TO adsagent_rw, agent_ro;
GRANT USAGE ON SCHEMA context    TO context_rw, agent_ro;
GRANT USAGE ON SCHEMA derived    TO derived_rw, agent_ro;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA listings TO listings_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA adsagent TO adsagent_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA context  TO context_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public   TO shared_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA derived  TO derived_rw;

-- Shared reference data (orgs, users, corridors) is readable by every service
-- and writable only by shared_rw.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO listings_rw, adsagent_rw, context_rw, derived_rw;

-- agent_ro: SELECT only, everywhere, forever. No sequence USAGE either.
GRANT SELECT ON ALL TABLES IN SCHEMA listings, adsagent, context, derived, public TO agent_ro;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA listings TO listings_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA adsagent TO adsagent_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA context  TO context_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO shared_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA derived  TO derived_rw;

ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO listings_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA adsagent GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adsagent_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA context  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO context_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shared_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA derived  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO derived_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA adsagent GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA context  GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA derived  GRANT SELECT ON TABLES TO agent_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public   GRANT SELECT ON TABLES TO agent_ro;
```

Create `ads-agent/lib/db/migrations/003_schemas_and_roles.down.sql`:

```sql
REASSIGN OWNED BY listings_rw, adsagent_rw, context_rw, shared_rw, derived_rw, agent_ro TO CURRENT_USER;
DROP OWNED BY listings_rw, adsagent_rw, context_rw, shared_rw, derived_rw, agent_ro;
DROP ROLE IF EXISTS listings_rw;
DROP ROLE IF EXISTS adsagent_rw;
DROP ROLE IF EXISTS context_rw;
DROP ROLE IF EXISTS shared_rw;
DROP ROLE IF EXISTS derived_rw;
DROP ROLE IF EXISTS agent_ro;
DROP SCHEMA IF EXISTS derived CASCADE;
DROP SCHEMA IF EXISTS context CASCADE;
DROP SCHEMA IF EXISTS adsagent CASCADE;
DROP SCHEMA IF EXISTS listings CASCADE;
```

- [ ] **Step 4: Write migration 004**

Create `ads-agent/lib/db/migrations/004_listings_schema_move.up.sql`:

```sql
-- The listings app's four tables move out of public so the schema layout in
-- data model §0 holds and every downstream spec's `listings.listings` resolves.
-- Application SQL stays unqualified and keeps working through listings_rw's
-- search_path, set in 003.
ALTER TABLE public.listings               SET SCHEMA listings;
ALTER TABLE public.sync_runs              SET SCHEMA listings;
ALTER TABLE public.search_queries         SET SCHEMA listings;
ALTER TABLE public.listing_enrichment_log SET SCHEMA listings;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA listings TO listings_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA listings TO agent_ro, adsagent_rw;
```

Create `ads-agent/lib/db/migrations/004_listings_schema_move.down.sql`:

```sql
ALTER TABLE listings.listings               SET SCHEMA public;
ALTER TABLE listings.sync_runs              SET SCHEMA public;
ALTER TABLE listings.search_queries         SET SCHEMA public;
ALTER TABLE listings.listing_enrichment_log SET SCHEMA public;
```

- [ ] **Step 5: Write the password script**

Create `scripts/consolidate/03-set-role-passwords.sh`:

```bash
#!/usr/bin/env bash
# Sets login passwords for the roles created by migration 003. Kept out of the
# migration so no credential is ever committed. Run once per environment.
set -euo pipefail

: "${ADMIN_URL:?set ADMIN_URL to a superuser connection on the consolidated instance}"
: "${LISTINGS_RW_PASSWORD:?}"
: "${ADSAGENT_RW_PASSWORD:?}"
: "${CONTEXT_RW_PASSWORD:?}"
: "${SHARED_RW_PASSWORD:?}"
: "${DERIVED_RW_PASSWORD:?}"
: "${AGENT_RO_PASSWORD:?}"

psql -q "$ADMIN_URL" <<SQL
ALTER ROLE listings_rw PASSWORD '${LISTINGS_RW_PASSWORD}';
ALTER ROLE adsagent_rw PASSWORD '${ADSAGENT_RW_PASSWORD}';
ALTER ROLE context_rw  PASSWORD '${CONTEXT_RW_PASSWORD}';
ALTER ROLE shared_rw   PASSWORD '${SHARED_RW_PASSWORD}';
ALTER ROLE derived_rw  PASSWORD '${DERIVED_RW_PASSWORD}';
ALTER ROLE agent_ro    PASSWORD '${AGENT_RO_PASSWORD}';
SQL
echo "role passwords set"
```

`chmod +x scripts/consolidate/03-set-role-passwords.sh`

- [ ] **Step 6: Bring up the PG18 instance and restore the listings dump into it**

The existing `gentle_space_pgdata` volume holds a PG16 data directory PG18 cannot read, so the consolidated instance starts from the Task 6 dump.

```bash
cd /Users/swami/Documents/GentleSpace_Web
docker compose -f docker-compose.listings.yml down
docker volume rm gentlespace_web_gentle_space_pgdata || docker volume rm gentle_space_pgdata
docker compose -f docker-compose.listings.yml up -d
until pg_isready -h localhost -p 5433 -U gentle; do sleep 1; done
psql -q "postgresql://gentle:gentle@localhost:5433/postgres" -f backups/pre-s2-globals.sql || true
pg_restore --no-owner --no-privileges -d "postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
  backups/pre-s2-listings.dump
psql -Aqt -F$'\t' "postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
  -f scripts/consolidate/rowcounts.sql > backups/pg18-listings.rowcounts
diff backups/pre-s2-listings.rowcounts backups/pg18-listings.rowcounts
```

Expected: `diff` prints nothing.

- [ ] **Step 7: Apply migrations 003 and 004**

`migrate()` resolves `lib/db/migrations` relative to `process.cwd()`, so run it from `ads-agent/` with `DATABASE_URL` pointed at the consolidated instance:

```bash
cd ads-agent
DATABASE_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" npx tsx lib/db/migrate.ts
```

Expected stdout: `ads-agent: applied 4 migration(s): 001_role_vocabulary, 002_proposal_decider, 003_schemas_and_roles, 004_listings_schema_move`

Migrations 001 and 002 re-apply here because this database has no ledger yet; both are `ALTER`s against `public.users` and `public.proposals`, which do not exist in this database until Task 8 restores them. **That will fail.** So instead, seed the ledger first to mark the pre-consolidation pair as not-applicable to this instance:

```bash
psql -q "postgresql://gentle:gentle@localhost:5433/gentle_space_listings" -c \
  "CREATE TABLE IF NOT EXISTS public.schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
   INSERT INTO public.schema_migrations (version) VALUES ('001_role_vocabulary'), ('002_proposal_decider')
     ON CONFLICT DO NOTHING;"
cd ads-agent
DATABASE_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" npx tsx lib/db/migrate.ts
```

Expected stdout: `ads-agent: applied 2 migration(s): 003_schemas_and_roles, 004_listings_schema_move`

Note the ordering constraint this exposes and which Task 8 relies on: the `ads_agent` dump already carries its own `public.schema_migrations` rows for 001 and 002, so after Task 8 renames that schema to `adsagent` the two ledgers must be reconciled. Task 8 Step 5 does exactly that.

- [ ] **Step 8: Set role passwords**

```bash
cd /Users/swami/Documents/GentleSpace_Web
ADMIN_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
LISTINGS_RW_PASSWORD="$(openssl rand -hex 24)" \
ADSAGENT_RW_PASSWORD="$(openssl rand -hex 24)" \
CONTEXT_RW_PASSWORD="$(openssl rand -hex 24)" \
SHARED_RW_PASSWORD="$(openssl rand -hex 24)" \
DERIVED_RW_PASSWORD="$(openssl rand -hex 24)" \
AGENT_RO_PASSWORD="$(openssl rand -hex 24)" \
  ./scripts/consolidate/03-set-role-passwords.sh
```

Record each generated password in `.env.local` for the app that needs it. Expected stdout: `role passwords set`.

- [ ] **Step 9: Run the schema-layout test and watch it pass**

```bash
cd ads-agent && TEST_DATABASE_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
  npx vitest run lib/db/schema-layout.test.ts
```

Expected: PASS, 6 tests. The `listings` table case passes; the `adsagent` cases in Task 8 do not exist yet and are not asserted here.

- [ ] **Step 10: Prove the listings app still works against the moved tables**

Point the root app's `DATABASE_URL` at `listings_rw` on port 5433 and run:

```bash
cd /Users/swami/Documents/GentleSpace_Web && npx vitest run
npm run graph:check
```

Expected: suite green, and `graph:check` reports non-zero graph overlap for a known Bellandur row — the same output as before the upgrade. A zero here means AGE resolved against the wrong schema; check that `ag_catalog` still leads `listings_rw`'s `search_path`.

- [ ] **Step 11: Commit**

```bash
git add ads-agent/lib/db/migrations/ ads-agent/lib/db/schema-layout.test.ts scripts/consolidate/
git commit -m "feat(db): four schemas, six roles, and the listings schema move

One schema per service with one non-owning role each, per data model §0. The
application roles hold privileges but not ownership and never BYPASSRLS, which
is what makes FORCE ROW LEVEL SECURITY meaningful in S3. agent_ro is SELECT-only."
```

## Task 8: Consolidate `ads_agent` into the `adsagent` schema

**Skills:** `postgres-pro`, `senior-data-engineer`, `deployment-engineer`
**Model:** `inherit` — a one-way cutover with an abort decision attached.

**Files:**
- Create: `scripts/consolidate/04-restore-adsagent.sh`
- Create: `ads-agent/lib/db/migrations/005_shared_reference_tables.up.sql` / `.down.sql`
- Create: `ads-agent/lib/db/baseline.sql`
- Modify: `ads-agent/lib/db/migrate.ts` (drop the `schema.sql` baseline apply)
- Delete: `ads-agent/lib/db/schema.sql`
- Modify: `ads-agent/lib/db/schema-layout.test.ts` (add the `adsagent` cases)

**Interfaces:**
- Consumes: schemas and roles from Task 7; the `ads_agent` dump from Task 6.
- Produces: all 14 `ads_agent` tables living in `adsagent`, with `orgs` and `users` in `public`, and a single `schema_migrations` ledger in `public`. `ads-agent`'s `DATABASE_URL` points at the consolidated instance as `adsagent_rw`.

**Context.** Datastore §4: the migration is a `pg_dump` of `ads_agent` restored into a new schema, then repointing `DATABASE_URL` and setting `search_path`. Low risk — no table renames, no data reshaping. The scratch-database route is used rather than editing the dump with `sed`, because it is reversible and never touches the source. Data model §0 puts shared reference data (`orgs`, `users`, `corridors`) in `public` with `shared_rw`, so those two tables move out of `adsagent` after the restore.

- [ ] **Step 1: Write the restore script**

Create `scripts/consolidate/04-restore-adsagent.sh`:

```bash
#!/usr/bin/env bash
# Restores the ads_agent dump into the consolidated instance under the adsagent
# schema, via a scratch database. The scratch route is used rather than sed on
# the dump because it never touches the source and is reversible at every step.
set -euo pipefail

: "${TARGET_URL:?set TARGET_URL, e.g. postgresql://gentle:gentle@localhost:5433/gentle_space_listings}"
ADMIN_BASE="${TARGET_URL%/*}"
SCRATCH="${ADMIN_BASE}/adsagent_scratch"

psql -q "${ADMIN_BASE}/postgres" -c 'DROP DATABASE IF EXISTS adsagent_scratch'
psql -q "${ADMIN_BASE}/postgres" -c 'CREATE DATABASE adsagent_scratch'
pg_restore --no-owner --no-privileges -d "$SCRATCH" backups/pre-s2-adsagent.dump

# Rename inside the scratch database, then dump the already-renamed schema.
psql -q "$SCRATCH" -c 'ALTER SCHEMA public RENAME TO adsagent'
pg_dump -Fc --schema=adsagent --dbname "$SCRATCH" -f backups/adsagent-renamed.dump

pg_restore --no-owner --no-privileges -d "$TARGET_URL" backups/adsagent-renamed.dump

psql -Aqt -F$'\t' "$TARGET_URL" -c \
  "SELECT replace(format('%s.%s', n.nspname, c.relname), 'adsagent.', 'public.'), \
          (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint \
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
    WHERE c.relkind = 'r' AND n.nspname = 'adsagent' ORDER BY 1" \
  > backups/consolidated-adsagent.rowcounts

echo "--- ads_agent row-count diff (source vs consolidated) ---"
diff backups/pre-s2-adsagent.rowcounts backups/consolidated-adsagent.rowcounts
psql -q "${ADMIN_BASE}/postgres" -c 'DROP DATABASE adsagent_scratch'
echo "CONSOLIDATION RESTORE PASSED"
```

`chmod +x scripts/consolidate/04-restore-adsagent.sh`

- [ ] **Step 2: Run it and watch the row counts match**

```bash
cd /Users/swami/Documents/GentleSpace_Web
TARGET_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
  ./scripts/consolidate/04-restore-adsagent.sh
```

Expected: the `diff` prints nothing across all 15 tables (14 original plus `schema_migrations`), and the last line is `CONSOLIDATION RESTORE PASSED`. **Any non-empty diff aborts S2** — restore the pre-migration backup and stop.

- [ ] **Step 3: Write migration 005**

Create `ads-agent/lib/db/migrations/005_shared_reference_tables.up.sql`:

```sql
-- Data model §0: public owns shared reference data (orgs, users, corridors)
-- with role shared_rw. The pg_dump restore landed them in adsagent along with
-- everything else, so they move out. Foreign keys follow the table.
ALTER TABLE adsagent.orgs  SET SCHEMA public;
ALTER TABLE adsagent.users SET SCHEMA public;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orgs, public.users TO shared_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orgs, public.users TO adsagent_rw;
GRANT SELECT ON public.orgs, public.users TO listings_rw, context_rw, derived_rw, agent_ro;
```

`adsagent_rw` keeps write access to `orgs` and `users` because `ensureShadowRows` in `lib/auth/dal.ts` upserts both on every verified request.

Create `ads-agent/lib/db/migrations/005_shared_reference_tables.down.sql`:

```sql
ALTER TABLE public.orgs  SET SCHEMA adsagent;
ALTER TABLE public.users SET SCHEMA adsagent;
```

- [ ] **Step 4: Reconcile the two ledgers, then apply 005**

The restore brought `adsagent.schema_migrations` carrying `001_role_vocabulary` and `002_proposal_decider`. The consolidated `public.schema_migrations` already has both from Task 7 Step 7. Drop the imported copy:

```bash
psql -q "postgresql://gentle:gentle@localhost:5433/gentle_space_listings" -c \
  "INSERT INTO public.schema_migrations (version, applied_at)
     SELECT version, applied_at FROM adsagent.schema_migrations
     ON CONFLICT (version) DO NOTHING;
   DROP TABLE adsagent.schema_migrations;"
psql -Aqt "postgresql://gentle:gentle@localhost:5433/gentle_space_listings" -c \
  "SELECT version FROM public.schema_migrations ORDER BY version"
```

Expected exactly four lines: `001_role_vocabulary`, `002_proposal_decider`, `003_schemas_and_roles`, `004_listings_schema_move`.

- [ ] **Step 5: Replace `schema.sql` with a schema-qualified baseline**

`schema.sql` contains unqualified `CREATE TABLE` statements. Re-running it against the consolidated instance would create a second copy of every table in whichever schema `search_path` resolves first — including, per the Global Constraints, `ag_catalog`. It must stop being applied.

```bash
pg_dump --schema-only --no-owner --no-privileges --schema=adsagent \
  --dbname "postgresql://gentle:gentle@localhost:5433/gentle_space_listings" \
  > ads-agent/lib/db/baseline.sql
rm ads-agent/lib/db/schema.sql
```

Then remove the baseline apply from `ads-agent/lib/db/migrate.ts` — delete these three lines:

```ts
  const baselinePath = path.join(process.cwd(), "lib/db/schema.sql");
  await pool.query(readFileSync(baselinePath, "utf-8"));

```

`baseline.sql` is documentation and a fresh-database bootstrap applied by hand; the runner now applies numbered migrations only, which is what data model §0 asks for.

- [ ] **Step 6: Apply 005 and verify**

```bash
cd ads-agent
DATABASE_URL="postgresql://gentle:gentle@localhost:5433/gentle_space_listings" npx tsx lib/db/migrate.ts
```

Expected stdout: `ads-agent: applied 1 migration(s): 005_shared_reference_tables`

```bash
psql -Aqt "postgresql://gentle:gentle@localhost:5433/gentle_space_listings" -c \
  "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind='r' AND c.relname IN ('orgs','users','proposals','campaigns') ORDER BY 2"
```

Expected: `public|orgs`, `public|users`, `adsagent|campaigns`, `adsagent|proposals`.

- [ ] **Step 7: Extend the schema-layout test to cover `adsagent`**

Append inside the `suite("consolidated schema layout", ...)` block in `ads-agent/lib/db/schema-layout.test.ts`:

```ts
  it("holds the twelve ads-agent domain tables in adsagent", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'adsagent' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      "ai_action_log",
      "campaign_draft_messages",
      "campaign_drafts",
      "campaigns",
      "credit_grants",
      "cron_settings",
      "crm_signal_snapshots",
      "org_balances",
      "performance_snapshots",
      "proposals",
      "usage_ledger",
      "user_balances",
    ]);
  });

  it("keeps orgs and users in public", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('orgs','users')
        ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual(["orgs", "users"]);
  });
```

- [ ] **Step 8: Repoint `ads-agent` and run both suites**

Set `DATABASE_URL` in `ads-agent/.env.local` to the consolidated instance as `adsagent_rw`, using the password generated in Task 7 Step 8:

```
DATABASE_URL=postgresql://adsagent_rw:<ADSAGENT_RW_PASSWORD>@localhost:5433/gentle_space_listings
```

`adsagent_rw`'s `search_path` is `ag_catalog, adsagent, public`, so the existing unqualified application SQL resolves correctly.

```bash
cd ads-agent && npx vitest run
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/schema-layout.test.ts
cd /Users/swami/Documents/GentleSpace_Web && npx vitest run
```

Expected: all three green, `schema-layout.test.ts` now 8 tests.

- [ ] **Step 9: Run the app for 30 minutes and watch it**

```bash
cd ads-agent && npm run dev
```

Load `/`, `/campaigns`, `/proposals`, `/credits`, `/settings`. **The abort criterion is explicit: if either app cannot run for more than 30 minutes on the merged instance, abort and restore.** Note anything in the console that was not there before — a PG18 behavioural difference surfacing here is the third abort trigger.

- [ ] **Step 10: Commit**

```bash
git add ads-agent/lib/db/migrations/ ads-agent/lib/db/baseline.sql ads-agent/lib/db/migrate.ts \
        ads-agent/lib/db/schema-layout.test.ts scripts/consolidate/
git rm ads-agent/lib/db/schema.sql
git commit -m "feat(db): consolidate ads_agent into the adsagent schema

pg_dump of ads_agent restored via a scratch database so the source is never
touched, row counts diffed across all 15 tables. orgs and users move to public
as shared reference data. schema.sql is replaced by a schema-qualified
baseline.sql and is no longer re-run by the migration runner -- an unqualified
CREATE TABLE on this instance would land in ag_catalog."
```

**S2 gate — stop and confirm before S3.** Both apps run against one instance. Row counts verified equal source-versus-consolidated on all 15 tables. Both suites green. `graph:check` returns non-zero overlap. **The `ads_agent` instance on :5434 and the pre-S2 backups are still in place and must remain so until S3 has passed.**

---

# S3 — Tenancy

**This is the release gate. Nothing customer-facing ships before it passes.**

**Abort criteria (build sequence).** Abort if the cross-tenant suite fails against a **pooled** connection after the policy work — rather than loosening a policy to make it pass. RLS half-applied is worse than not applied, because the surfaces above it start assuming a guarantee the database is not making. Revert the policies, keep the `org_id` columns and the `Scope` parameters (both additive and safe to leave), and re-enter S3 with the pooling model fixed first.

## Task 9 (S3-A): `Scope`, the tenant transaction, and the tenancy primitives

**Skills:** `postgres-pro`, `typescript-pro`, `tdd-guide`
**Model:** `inherit` — every signature here is frozen for seven parallel branches and six sibling plans.

**Files:**
- Create: `ads-agent/lib/db/scope-sql.ts`
- Create: `ads-agent/lib/db/scope-sql.test.ts`
- Create: `ads-agent/lib/db/tx.ts`
- Create: `ads-agent/lib/db/tx.pooled.test.ts`
- Create: `ads-agent/lib/db/migrations/006_tenant_primitives.up.sql` / `.down.sql`
- Create: `ads-agent/lib/db/migrations/007_org_id_backfill.up.sql` / `.down.sql`

**Interfaces:**
- Consumes: `migrate()` from Task 1; the `adsagent` schema from Task 8.
- Produces, and these are frozen:
  - `type Scope = { kind: "platform"; orgId: string } | { kind: "org"; orgId: string }`
  - `scopeClause(scope: Scope, column = "org_id"): { sql: string; params: unknown[] }`
  - `withTenantTransaction<T>(scope: Scope, fn: (client: PoolClient) => Promise<T>, pool?: Pool): Promise<T>` — exported from `ads-agent/lib/db/tx.ts`. `pool` defaults to `getPool()`; S5a's outbox relay and S6a's reconciliation jobs pass a pool built from `OUTBOX_RELAY_DATABASE_URL`. This is the canonical name and path across the programme: S4–S5, S5a and S6–S6a all import it from here.
  - The root listings app carries a deliberate twin at `lib/db/tx.ts` with the same signature, created by S5a Task 11. The two apps have separate `package.json`, separate pools and separate deployments, with no shared package between them, so the duplication is the cheaper option. Do not attempt to unify them.
  - SQL: `public.set_tenant(uuid)`, `public.current_tenant()`, `public.set_platform()`, `public.is_platform_read()`
  - SQL: domain `public.org_ref`, enum `public.lifecycle_state ('active','suppressed','erased')`
  - `org_id public.org_ref NOT NULL` on `adsagent.{campaigns,proposals,campaign_drafts,campaign_draft_messages,performance_snapshots,crm_signal_snapshots}` with an `org_id`-leading index on each.

**Context.** `scopeClause` is the front line and is not sufficient alone: one missed call site reads across tenants with nothing to stop it (tenancy spec §3a). RLS is the layer that fails closed when the application layer has a bug. Three details each silently defeat the whole mechanism: the third argument to `set_config`, `FORCE` rather than merely `ENABLE`, and `WITH CHECK` alongside `USING`. `withTenantTransaction` exists because `getPool().query` runs on an arbitrary pooled connection with no transaction — once RLS is on, a query without a transaction-scoped tenant sees zero rows and the app silently returns empty everywhere.

- [ ] **Step 1: Write the failing `scopeClause` test**

Create `ads-agent/lib/db/scope-sql.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scopeClause, type Scope } from "./scope-sql";

const ORG: Scope = { kind: "org", orgId: "11111111-1111-1111-1111-111111111111" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

describe("scopeClause", () => {
  it("constrains org scope to its own org_id", () => {
    expect(scopeClause(ORG)).toEqual({
      sql: "org_id = $1::uuid",
      params: ["11111111-1111-1111-1111-111111111111"],
    });
  });

  it("lets platform scope through without constraining org_id", () => {
    const clause = scopeClause(PLATFORM);
    expect(clause.sql).not.toContain("org_id");
    expect(clause.params).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });

  it("honours a custom column name", () => {
    expect(scopeClause(ORG, "d.org_id").sql).toBe("d.org_id = $1::uuid");
  });

  it("consumes exactly one placeholder in both branches, so caller numbering is stable", () => {
    for (const scope of [ORG, PLATFORM]) {
      const clause = scopeClause(scope);
      expect(clause.params, `${scope.kind} must supply one param`).toHaveLength(1);
      expect(clause.sql).toContain("$1");
      expect(clause.sql).not.toContain("$2");
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/scope-sql.test.ts`
Expected: FAIL — `Cannot find module './scope-sql'`.

- [ ] **Step 3: Implement `scope-sql.ts`**

Create `ads-agent/lib/db/scope-sql.ts`:

```ts
/**
 * Two scopes, derived from the existing orgs.kind column. No new column, no new
 * concept (tenancy spec §1).
 *
 * Platform scope is a read affordance, not a write bypass: the RLS policy grants
 * it cross-org visibility in USING only, and WITH CHECK still pins every write
 * to public.current_tenant().
 */
export type Scope =
  | { kind: "platform"; orgId: string } // Gentle Space staff; may read across orgs
  | { kind: "org"; orgId: string }; //     external customer; hard-bounded to orgId

/**
 * SQL fragment plus params constraining a query to the caller's scope.
 *
 * Calling convention, and it is load-bearing: the fragment always consumes
 * exactly one placeholder, $1, in both branches, so a caller spreads
 * scope.params first and numbers its own params from $2 whatever the scope kind.
 * A branch emitting zero params would shift every later placeholder depending on
 * who was calling, which is a bug factory.
 */
export function scopeClause(
  scope: Scope,
  column = "org_id",
): { sql: string; params: unknown[] } {
  if (scope.kind === "platform") {
    // Always true for a non-null orgId, which Scope guarantees. Present only to
    // keep the placeholder count identical to the org branch.
    return { sql: "$1::uuid IS NOT NULL", params: [scope.orgId] };
  }
  return { sql: `${column} = $1::uuid`, params: [scope.orgId] };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd ads-agent && npx vitest run lib/db/scope-sql.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write migration 006 — the tenancy primitives**

Create `ads-agent/lib/db/migrations/006_tenant_primitives.up.sql`:

```sql
-- Data model §1.1 and §1.3. Every path into the database goes through
-- set_tenant; nothing sets the variable directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_ref'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE DOMAIN public.org_ref AS UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_state'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.lifecycle_state AS ENUM ('active', 'suppressed', 'erased');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_tenant(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'set_tenant called with NULL org_id';
  END IF;
  -- third argument true => transaction-scoped. Without it the setting persists
  -- on the pooled connection and the next request inherits this tenant.
  PERFORM set_config('app.current_tenant_id', p_org_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_tenant()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
$$;

-- Platform staff read across orgs (tenancy spec §1). Transaction-scoped like
-- the tenant itself, and it can only be raised after a tenant is set, so
-- current_tenant() is never NULL while it is on.
CREATE OR REPLACE FUNCTION public.set_platform()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.current_tenant() IS NULL THEN
    RAISE EXCEPTION 'set_platform called before set_tenant';
  END IF;
  PERFORM set_config('app.platform_read', 'on', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_read()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(current_setting('app.platform_read', true), 'off') = 'on';
$$;

GRANT EXECUTE ON FUNCTION public.set_tenant(UUID)  TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT EXECUTE ON FUNCTION public.current_tenant()  TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw, agent_ro;
GRANT EXECUTE ON FUNCTION public.is_platform_read() TO adsagent_rw, listings_rw, context_rw, shared_rw, derived_rw, agent_ro;
-- agent_ro is deliberately excluded: an agent is always tenant-pinned.
GRANT EXECUTE ON FUNCTION public.set_platform()    TO adsagent_rw;
```

Create `ads-agent/lib/db/migrations/006_tenant_primitives.down.sql`:

```sql
DROP FUNCTION IF EXISTS public.is_platform_read();
DROP FUNCTION IF EXISTS public.set_platform();
DROP FUNCTION IF EXISTS public.current_tenant();
DROP FUNCTION IF EXISTS public.set_tenant(UUID);
DROP TYPE IF EXISTS public.lifecycle_state;
DROP DOMAIN IF EXISTS public.org_ref;
```

- [ ] **Step 6: Write migration 007 — `org_id` on every domain table**

Create `ads-agent/lib/db/migrations/007_org_id_backfill.up.sql`:

```sql
-- Data model §0: org_id on every domain table, no exceptions -- a table without
-- it cannot carry an RLS policy, and a child table reachable by a query that
-- names it directly is not protected by its parent's policy. This overrides
-- tenancy spec §2a, which left the three child tables without the column.
-- Order matters: add nullable, backfill, then constrain.
ALTER TABLE adsagent.campaigns              ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.proposals              ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.campaign_drafts        ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.campaign_draft_messages ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.performance_snapshots  ADD COLUMN IF NOT EXISTS org_id public.org_ref;
ALTER TABLE adsagent.crm_signal_snapshots   ADD COLUMN IF NOT EXISTS org_id public.org_ref;

-- The seeded internal org owns every existing row.
UPDATE adsagent.campaigns       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE adsagent.proposals       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE adsagent.campaign_drafts SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- Children inherit from their parent, which is the authoritative owner.
UPDATE adsagent.campaign_draft_messages m
   SET org_id = d.org_id
  FROM adsagent.campaign_drafts d
 WHERE d.id = m.draft_id AND m.org_id IS NULL;
UPDATE adsagent.performance_snapshots s
   SET org_id = c.org_id
  FROM adsagent.campaigns c
 WHERE c.id = s.campaign_id AND s.org_id IS NULL;
UPDATE adsagent.crm_signal_snapshots s
   SET org_id = c.org_id
  FROM adsagent.campaigns c
 WHERE c.id = s.campaign_id AND s.org_id IS NULL;

-- crm_signal_snapshots.campaign_id is nullable, so an orphan cannot inherit.
UPDATE adsagent.crm_signal_snapshots
   SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

ALTER TABLE adsagent.campaigns              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.proposals              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.campaign_drafts        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.campaign_draft_messages ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.performance_snapshots  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE adsagent.crm_signal_snapshots   ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE adsagent.campaigns              ADD CONSTRAINT campaigns_org_fk              FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.proposals              ADD CONSTRAINT proposals_org_fk              FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.campaign_drafts        ADD CONSTRAINT campaign_drafts_org_fk        FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.campaign_draft_messages ADD CONSTRAINT campaign_draft_messages_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.performance_snapshots  ADD CONSTRAINT performance_snapshots_org_fk  FOREIGN KEY (org_id) REFERENCES public.orgs(id);
ALTER TABLE adsagent.crm_signal_snapshots   ADD CONSTRAINT crm_signal_snapshots_org_fk   FOREIGN KEY (org_id) REFERENCES public.orgs(id);

-- Every index leads with org_id. A missing leading-edge tenant index quietly
-- destroys customer-facing query latency at scale (data model §0).
CREATE INDEX IF NOT EXISTS campaigns_org_created_idx
  ON adsagent.campaigns (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS proposals_org_status_idx
  ON adsagent.proposals (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_drafts_org_created_idx
  ON adsagent.campaign_drafts (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_draft_messages_org_draft_idx
  ON adsagent.campaign_draft_messages (org_id, draft_id, created_at ASC);
CREATE INDEX IF NOT EXISTS performance_snapshots_org_campaign_idx
  ON adsagent.performance_snapshots (org_id, campaign_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS crm_signal_snapshots_org_captured_idx
  ON adsagent.crm_signal_snapshots (org_id, captured_at DESC);
```

Create `ads-agent/lib/db/migrations/007_org_id_backfill.down.sql`:

```sql
DROP INDEX IF EXISTS adsagent.crm_signal_snapshots_org_captured_idx;
DROP INDEX IF EXISTS adsagent.performance_snapshots_org_campaign_idx;
DROP INDEX IF EXISTS adsagent.campaign_draft_messages_org_draft_idx;
DROP INDEX IF EXISTS adsagent.campaign_drafts_org_created_idx;
DROP INDEX IF EXISTS adsagent.proposals_org_status_idx;
DROP INDEX IF EXISTS adsagent.campaigns_org_created_idx;

ALTER TABLE adsagent.crm_signal_snapshots   DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.performance_snapshots  DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.campaign_draft_messages DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.campaign_drafts        DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.proposals              DROP COLUMN IF EXISTS org_id;
ALTER TABLE adsagent.campaigns              DROP COLUMN IF EXISTS org_id;
```

- [ ] **Step 7: Apply both migrations and verify the backfill left nothing null**

```bash
cd ads-agent && npx tsx lib/db/migrate.ts
```

Expected stdout: `ads-agent: applied 2 migration(s): 006_tenant_primitives, 007_org_id_backfill`

```bash
psql "$DATABASE_URL" -Aqt -c "
SELECT 'campaigns', count(*) FROM adsagent.campaigns WHERE org_id IS NULL
UNION ALL SELECT 'proposals', count(*) FROM adsagent.proposals WHERE org_id IS NULL
UNION ALL SELECT 'drafts', count(*) FROM adsagent.campaign_drafts WHERE org_id IS NULL
UNION ALL SELECT 'messages', count(*) FROM adsagent.campaign_draft_messages WHERE org_id IS NULL
UNION ALL SELECT 'perf', count(*) FROM adsagent.performance_snapshots WHERE org_id IS NULL
UNION ALL SELECT 'crm', count(*) FROM adsagent.crm_signal_snapshots WHERE org_id IS NULL"
```

Expected: six lines, every count `0`.

- [ ] **Step 8: Write the failing pooled-connection test**

This is the single most important test in the plan. Without this exact test the RLS leak ships silently and no happy-path test catches it.

Create `ads-agent/lib/db/tx.pooled.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { withTenantTransaction } from "./tx";
import type { Scope } from "./scope-sql";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// max: 1 means the pool holds exactly one physical connection, so a second
// connect() after release() is guaranteed to hand back the same one. That is
// what makes this test a real test of the pooling hazard rather than a
// coincidence.
let pool: Pool;

beforeAll(() => {
  if (url) pool = new Pool({ connectionString: url, max: 1 });
});
afterAll(async () => {
  if (pool) await pool.end();
});

suite("tenant context is transaction-local on a pooled connection", () => {
  it("does not survive COMMIT on the same physical connection", async () => {
    const first = await pool.connect();
    const firstPid = (await first.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await first.query("BEGIN");
    await first.query("SELECT public.set_tenant($1)", [ORG_A]);
    const inside = await first.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
    expect(inside.rows[0].t).toBe(ORG_A);
    await first.query("COMMIT");
    first.release();

    const second = await pool.connect();
    const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    expect(secondPid, "pool must reuse the same backend for this test to mean anything").toBe(firstPid);
    const after = await second.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
    second.release();

    expect(after.rows[0].t, "tenant leaked across requests on a reused connection").toBeNull();
  });

  it("leaks when set_config omits the transaction-local flag — the control case", async () => {
    const first = await pool.connect();
    await first.query("BEGIN");
    // Deliberately the wrong form: two arguments, session-scoped.
    await first.query("SELECT set_config('app.current_tenant_id', $1, false)", [ORG_A]);
    await first.query("COMMIT");
    first.release();

    const second = await pool.connect();
    const after = await second.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
    await second.query("SELECT set_config('app.current_tenant_id', '', false)");
    second.release();

    // Proves the assertion above has teeth: with the wrong form it really does leak.
    expect(after.rows[0].t).toBe(ORG_A);
  });

  it("withTenantTransaction sets the tenant inside the transaction and clears it after", async () => {
    const scope: Scope = { kind: "org", orgId: ORG_B };
    const seen = await withTenantTransaction(scope, async (client) => {
      const { rows } = await client.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
      return rows[0].t;
    });
    expect(seen).toBe(ORG_B);

    const after = await withTenantTransaction({ kind: "org", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
      return rows[0].t;
    });
    expect(after, "the previous transaction's tenant must not survive").toBe(ORG_A);
  });

  it("withTenantTransaction rolls back and rethrows when the callback throws", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId: ORG_A }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The connection must be usable afterwards, i.e. not left in a failed transaction.
    const ok = await withTenantTransaction({ kind: "org", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ one: number }>("SELECT 1 AS one");
      return rows[0].one;
    });
    expect(ok).toBe(1);
  });

  it("platform scope raises the read flag only inside its own transaction", async () => {
    const inside = await withTenantTransaction({ kind: "platform", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ p: boolean }>("SELECT public.is_platform_read() AS p");
      return rows[0].p;
    });
    expect(inside).toBe(true);

    const outside = await withTenantTransaction({ kind: "org", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ p: boolean }>("SELECT public.is_platform_read() AS p");
      return rows[0].p;
    });
    expect(outside, "platform read flag leaked into an org-scoped transaction").toBe(false);
  });

  it("uses the pool passed as the third argument, not the app pool", async () => {
    // The local pool has max: 1, so its single physical backend has one stable
    // pid. Any connection from the app pool is a different physical connection
    // and therefore a different pid -- that is what proves the third argument is
    // honoured rather than ignored. S5a's relay passes a pool built from
    // OUTBOX_RELAY_DATABASE_URL this way.
    const direct = await pool.connect();
    const explicitPid = (await direct.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    direct.release();

    const scope: Scope = { kind: "org", orgId: ORG_B };
    const onExplicit = await withTenantTransaction(
      scope,
      async (client) => {
        const { rows } = await client.query<{ pid: number; t: string | null }>(
          "SELECT pg_backend_pid() AS pid, public.current_tenant() AS t",
        );
        return rows[0];
      },
      pool,
    );

    expect(onExplicit.pid, "callback did not run on the supplied pool").toBe(explicitPid);
    expect(onExplicit.t, "tenant was not set on the supplied pool's connection").toBe(ORG_B);

    const onDefault = await withTenantTransaction(scope, async (client) => {
      const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      return rows[0].pid;
    });

    expect(onDefault, "the app pool must not be the one the explicit call used").not.toBe(explicitPid);
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

```bash
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/tx.pooled.test.ts
```

Expected: FAIL — `Cannot find module './tx'`.

- [ ] **Step 10: Implement `tx.ts`**

Create `ads-agent/lib/db/tx.ts`:

```ts
import type { Pool, PoolClient } from "pg";
import { getPool } from "./client";
import type { Scope } from "./scope-sql";

/**
 * Runs fn inside one transaction whose tenant context is set with the
 * transaction-local form of set_config.
 *
 * The optional third parameter takes the connection from a caller-supplied pool
 * instead of the app pool. S5a's outbox relay and S6a's reconciliation jobs run
 * against OUTBOX_RELAY_DATABASE_URL and need this same transaction logic without
 * a second copy of it.
 *
 * Both apps construct pg.Pool, so connections are reused between requests. A
 * connection-scoped setting would persist past COMMIT and the next request on
 * that connection would inherit this tenant -- RLS then faithfully enforces the
 * wrong tenant, with no error and no log line (validation F-1). See
 * tx.pooled.test.ts, which includes the leaking control case.
 *
 * ponytail: one transaction per data-layer call. Ceiling: a route calling three
 * data-layer functions opens three transactions and gets no cross-call
 * atomicity. Upgrade path: give each data-layer function an optional
 * `client?: PoolClient` last parameter and have the route open one withTenantTransaction
 * around them.
 */
export async function withTenantTransaction<T>(
  scope: Scope,
  fn: (client: PoolClient) => Promise<T>,
  pool?: Pool,
): Promise<T> {
  const client = await (pool ?? getPool()).connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [scope.orgId]);
    if (scope.kind === "platform") {
      await client.query("SELECT public.set_platform()");
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // A rollback failure means the connection is already unusable; the
      // original error is the one worth reporting.
    });
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 11: Seed the two test orgs and run the test**

The pooled test references org A and org B; the FK on `org_id` needs them to exist for later tasks, and seeding here keeps every S3-B branch working from the same fixtures.

```bash
psql "$DATABASE_URL" -c "
INSERT INTO public.orgs (id, name, kind) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Org A', 'external'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test Org B', 'external')
ON CONFLICT (id) DO NOTHING;"

cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/tx.pooled.test.ts
```

Expected: PASS, 6 tests. If the second case (the control) fails, the test has no teeth and something else is clearing the setting — investigate before continuing.

- [ ] **Step 12: Run the full suite and commit**

Run: `cd ads-agent && npx vitest run`
Expected: all green.

```bash
git add ads-agent/lib/db/scope-sql.ts ads-agent/lib/db/scope-sql.test.ts \
        ads-agent/lib/db/tx.ts ads-agent/lib/db/tx.pooled.test.ts \
        ads-agent/lib/db/migrations/
git commit -m "feat(db): Scope, transaction-local tenant context, org_id everywhere

scopeClause is the front line; withTenantTransaction is what makes the RLS backstop
usable, because getPool().query runs on an arbitrary pooled connection with no
transaction. The pooled test asserts the tenant does not survive COMMIT on the
same physical backend, and includes the two-argument set_config control case so
the assertion demonstrably has teeth."
```

---

## S3-B: data-layer conversion, seven units

Every unit follows the same contract. It is restated in each task rather than cross-referenced, because an implementer sees only their own task.

## Task 10 (U1): `proposals` + `campaign-drafts`

**Skills:** `refactoring-specialist`, `typescript-pro`
**Model:** `inherit` — fifteen call sites, several of which need a scope threaded from a session that does not exist yet.

**Files:**
- Modify: `ads-agent/lib/db/proposals.ts`, `ads-agent/lib/db/proposals.test.ts`
- Modify: `ads-agent/lib/db/campaign-drafts.ts`, `ads-agent/lib/db/campaign-drafts.test.ts`
- Create: `ads-agent/lib/db/migrations/009_rls_proposals_drafts.up.sql` / `.down.sql`
- Modify: `ads-agent/app/(admin)/proposals/page.tsx`, `ads-agent/app/(admin)/proposals/[id]/page.tsx`
- Modify: `ads-agent/app/(admin)/campaigns/drafts/[id]/page.tsx`, `ads-agent/app/(admin)/campaigns/new/page.tsx`
- Modify: `ads-agent/app/api/proposals/[id]/route.ts`, `.../approve/route.ts`, `.../reject/route.ts`
- Modify: `ads-agent/app/api/campaign-drafts/[id]/route.ts`, `.../messages/route.ts`, `.../create-proposal/route.ts`
- Modify: `ads-agent/lib/decision-engine/cycle.ts`, `ads-agent/lib/executor/execute.ts`
- Modify: `ads-agent/lib/openui/analytics-tools.ts`, `ads-agent/lib/openui/campaign-tools.ts`
- Modify: `ads-agent/mcp/google-ads-server/tools.ts`

**Interfaces:**
- Consumes: `Scope`, `scopeClause`, `withTenantTransaction` from Task 9.
- Produces:
  - `createProposal(scope: Scope, input: NewProposal): Promise<Proposal>`
  - `listProposals(scope: Scope, status?: ProposalStatus): Promise<Proposal[]>`
  - `getProposalById(scope: Scope, id: string): Promise<Proposal | null>`
  - `decideProposal(scope: Scope, id: string, status: "approved" | "rejected", decidedBy: string, decidedVia?: "ui" | "bulk" | "api" | "system"): Promise<void>`
  - `markProposalExecuted(scope: Scope, id: string): Promise<void>`
  - `markProposalFailed(scope: Scope, id: string, error: string): Promise<void>`
  - `updateProposalPayload(scope: Scope, id: string, payload: Record<string, unknown>): Promise<Proposal>`
  - `createDraft(scope: Scope): Promise<CampaignDraft>`
  - `getDraftById(scope: Scope, id: string): Promise<CampaignDraft | null>`
  - `updateDraftFields(scope: Scope, id: string, fields: CampaignDraftFields): Promise<CampaignDraft>`
  - `setDraftStatus(scope: Scope, id: string, status: CampaignDraftStatus): Promise<void>`
  - `markDraftConverted(scope: Scope, id: string, proposalId: string): Promise<void>`
  - `appendDraftMessage(scope: Scope, draftId: string, role: "user" | "assistant", content: string): Promise<CampaignDraftMessage>`
  - `listDraftMessages(scope: Scope, draftId: string): Promise<CampaignDraftMessage[]>`

**Context.** These two modules are one unit because `app/api/campaign-drafts/[id]/create-proposal/route.ts` imports both `@/lib/db/proposals` and `@/lib/db/campaign-drafts`; two agents changing either signature would both have to edit that file. Until Task 17 builds `guard`, every call site passes a scope constructed inline from the session's `orgId`; Task 17 replaces those with `guard`'s scope.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `ads-agent/lib/db/proposals.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  createProposal,
  decideProposal,
  getProposalById,
  listProposals,
  markProposalExecuted,
  markProposalFailed,
  updateProposalPayload,
} from "./proposals";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

const row = {
  id: "prop-1",
  kind: "pause",
  campaign_id: "camp-1",
  payload: { campaignId: "camp-1" },
  triggered_rule: "kill_rule",
  rationale: "CPL has been 40% over breakeven for 3 days.",
  status: "pending",
  error: null,
  created_at: new Date("2026-08-03T00:00:00.000Z"),
  decided_at: null,
  executed_at: null,
};

beforeEach(() => query.mockReset());

describe("createProposal", () => {
  it("stamps the caller's org_id and returns the mapped proposal", async () => {
    query.mockResolvedValue({ rows: [row] });
    const result = await createProposal(ORG, {
      kind: "pause",
      campaignId: "camp-1",
      payload: { campaignId: "camp-1" },
      triggeredRule: "kill_rule",
      rationale: "CPL has been 40% over breakeven for 3 days.",
    });
    expect(result.id).toBe("prop-1");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.proposals");
    expect(sql).toContain("org_id");
    expect(params[0]).toBe(ORG.orgId);
  });
});

describe("listProposals", () => {
  it("scopes every listing to the caller", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("WHERE org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });

  it("adds the status filter as $2, after the scope param", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals(ORG, "pending");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("status = $2");
    expect(params).toEqual([ORG.orgId, "pending"]);
  });

  it("does not constrain org_id under platform scope", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals(PLATFORM);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("org_id = $1");
    expect(params).toEqual([PLATFORM.orgId]);
  });
});

describe("getProposalById", () => {
  it("returns null when the row is outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getProposalById(ORG, "someone-elses-id")).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "someone-elses-id"]);
  });
});

describe("decideProposal", () => {
  it("scopes the update and records the decider", async () => {
    query.mockResolvedValue({ rows: [] });
    await decideProposal(ORG, "prop-1", "approved", "user-1", "ui");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("decided_by = $4");
    expect(params).toEqual([ORG.orgId, "prop-1", "approved", "user-1", "ui"]);
  });

  it("defaults the decision route to ui", async () => {
    query.mockResolvedValue({ rows: [] });
    await decideProposal(ORG, "prop-1", "rejected", "user-1");
    expect(query.mock.calls[0][1][4]).toBe("ui");
  });
});

describe("markProposalExecuted", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await markProposalExecuted(ORG, "prop-1");
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "prop-1"]);
  });
});

describe("markProposalFailed", () => {
  it("scopes the update and stores the error", async () => {
    query.mockResolvedValue({ rows: [] });
    await markProposalFailed(ORG, "prop-1", "insufficient budget");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "prop-1", "insufficient budget"]);
  });
});

describe("updateProposalPayload", () => {
  it("scopes the update and throws when nothing matched", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(updateProposalPayload(ORG, "prop-1", { dailyBudgetInr: 700 })).rejects.toThrow(
      "proposal prop-1 not found",
    );
  });

  it("returns the mapped proposal on success", async () => {
    query.mockResolvedValue({ rows: [{ ...row, payload: { dailyBudgetInr: 700 } }] });
    const result = await updateProposalPayload(ORG, "prop-1", { dailyBudgetInr: 700 });
    expect(result.payload).toEqual({ dailyBudgetInr: 700 });
  });
});
```

Replace the whole of `ads-agent/lib/db/campaign-drafts.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  appendDraftMessage,
  createDraft,
  getDraftById,
  listDraftMessages,
  markDraftConverted,
  setDraftStatus,
  updateDraftFields,
} from "./campaign-drafts";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const draftRow = {
  id: "draft-1",
  status: "chatting",
  corridor: null,
  daily_budget_inr: null,
  ad_group_name: null,
  keywords: [],
  headlines: [],
  descriptions: [],
  final_url: "https://www.gentlespacesolutions.com/spaces",
  proposal_id: null,
  created_at: new Date("2026-08-03T00:00:00.000Z"),
  updated_at: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createDraft", () => {
  it("stamps the caller's org_id", async () => {
    query.mockResolvedValue({ rows: [draftRow] });
    await createDraft(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.campaign_drafts (org_id)");
    expect(params).toEqual([ORG.orgId]);
  });
});

describe("getDraftById", () => {
  it("returns null for a draft outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getDraftById(ORG, "draft-x")).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-x"]);
  });
});

describe("updateDraftFields", () => {
  it("numbers field placeholders from $3, after scope and id", async () => {
    query.mockResolvedValue({ rows: [{ ...draftRow, corridor: "HSR" }] });
    await updateDraftFields(ORG, "draft-1", { corridor: "HSR" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("corridor = $3");
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("id = $2");
    expect(params).toEqual([ORG.orgId, "draft-1", "HSR"]);
  });

  it("serialises json fields", async () => {
    query.mockResolvedValue({ rows: [draftRow] });
    await updateDraftFields(ORG, "draft-1", { headlines: ["a", "b"] });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("headlines = $3::jsonb");
    expect(params[2]).toBe(JSON.stringify(["a", "b"]));
  });

  it("throws when the scoped update matched nothing", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(updateDraftFields(ORG, "draft-1", { corridor: "HSR" })).rejects.toThrow(
      "campaign draft draft-1 not found",
    );
  });
});

describe("setDraftStatus", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await setDraftStatus(ORG, "draft-1", "ready");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-1", "ready"]);
  });
});

describe("markDraftConverted", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await markDraftConverted(ORG, "draft-1", "prop-1");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-1", "prop-1"]);
  });
});

describe("appendDraftMessage", () => {
  it("stamps org_id and only writes against a draft in scope", async () => {
    query.mockResolvedValue({
      rows: [{ id: "m1", draft_id: "draft-1", role: "user", content: "hi", created_at: new Date(0) }],
    });
    await appendDraftMessage(ORG, "draft-1", "user", "hi");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("adsagent.campaign_draft_messages");
    expect(sql).toContain("adsagent.campaign_drafts");
    expect(params).toEqual([ORG.orgId, "draft-1", "user", "hi"]);
  });

  it("throws when the parent draft is out of scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(appendDraftMessage(ORG, "draft-x", "user", "hi")).rejects.toThrow(
      "campaign draft draft-x not found",
    );
  });
});

describe("listDraftMessages", () => {
  it("scopes the listing", async () => {
    query.mockResolvedValue({ rows: [] });
    await listDraftMessages(ORG, "draft-1");
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-1"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts lib/db/campaign-drafts.test.ts`
Expected: FAIL — TypeScript reports argument-count mismatches on every exported function.

- [ ] **Step 3: Convert `proposals.ts`**

Replace `ads-agent/lib/db/proposals.ts` lines 34–101 (every exported function; the `ProposalRow` type and `rowToProposal` above them are unchanged) with:

```ts
export async function createProposal(scope: Scope, input: NewProposal): Promise<Proposal> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `INSERT INTO adsagent.proposals
         (org_id, kind, campaign_id, payload, triggered_rule, rationale)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        ...s.params,
        input.kind,
        input.campaignId,
        JSON.stringify(input.payload),
        input.triggeredRule,
        input.rationale ?? null,
      ],
    );
    return rowToProposal(rows[0]);
  });
}

export async function listProposals(scope: Scope, status?: ProposalStatus): Promise<Proposal[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = status
      ? await client.query<ProposalRow>(
          `SELECT * FROM adsagent.proposals
            WHERE ${s.sql} AND status = $2
            ORDER BY created_at DESC`,
          [...s.params, status],
        )
      : await client.query<ProposalRow>(
          `SELECT * FROM adsagent.proposals WHERE ${s.sql} ORDER BY created_at DESC`,
          [...s.params],
        );
    return rows.map(rowToProposal);
  });
}

export async function getProposalById(scope: Scope, id: string): Promise<Proposal | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `SELECT * FROM adsagent.proposals WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    );
    return rows[0] ? rowToProposal(rows[0]) : null;
  });
}

export async function decideProposal(
  scope: Scope,
  id: string,
  status: "approved" | "rejected",
  decidedBy: string,
  decidedVia: "ui" | "bulk" | "api" | "system" = "ui",
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.proposals
          SET status = $3, decided_at = NOW(), decided_by = $4, decided_via = $5
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, status, decidedBy, decidedVia],
    ),
  );
}

export async function markProposalExecuted(scope: Scope, id: string): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.proposals
          SET status = 'executed', executed_at = NOW()
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    ),
  );
}

export async function markProposalFailed(scope: Scope, id: string, error: string): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.proposals SET status = 'failed', error = $3 WHERE ${s.sql} AND id = $2`,
      [...s.params, id, error],
    ),
  );
}

export async function updateProposalPayload(
  scope: Scope,
  id: string,
  payload: Record<string, unknown>,
): Promise<Proposal> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `UPDATE adsagent.proposals SET payload = $3::jsonb
        WHERE ${s.sql} AND id = $2
        RETURNING *`,
      [...s.params, id, JSON.stringify(payload)],
    );
    // A scoped UPDATE that matched nothing is indistinguishable from a
    // cross-tenant attempt, and must not return a fabricated row.
    if (!rows[0]) throw new Error(`proposal ${id} not found`);
    return rowToProposal(rows[0]);
  });
}
```

Replace the import block at the top of the file (lines 1–2) with:

```ts
import type { NewProposal, Proposal, ProposalKind, ProposalStatus } from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";
```

`getPool` is no longer imported — every query now runs on the transaction's client.

- [ ] **Step 4: Convert `campaign-drafts.ts`**

Replace the import block (lines 1–7) with:

```ts
import type {
  CampaignDraft,
  CampaignDraftFields,
  CampaignDraftMessage,
  CampaignDraftStatus,
} from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";
```

Replace `createDraft` and `getDraftById` (lines 41–54) with:

```ts
export async function createDraft(scope: Scope): Promise<CampaignDraft> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftRow>(
      `INSERT INTO adsagent.campaign_drafts (org_id) VALUES ($1::uuid) RETURNING *`,
      [...s.params],
    );
    return rowToDraft(rows[0]);
  });
}

export async function getDraftById(scope: Scope, id: string): Promise<CampaignDraft | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftRow>(
      `SELECT * FROM adsagent.campaign_drafts WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    );
    return rows[0] ? rowToDraft(rows[0]) : null;
  });
}
```

`createDraft` loses `DEFAULT VALUES` because `org_id` is now `NOT NULL` with no default; every other column keeps its own default.

Replace `updateDraftFields`, `setDraftStatus` and `markDraftConverted` (lines 68–108) with:

```ts
export async function updateDraftFields(
  scope: Scope,
  id: string,
  fields: CampaignDraftFields,
): Promise<CampaignDraft> {
  const entries = Object.entries(fields) as [keyof CampaignDraftFields, unknown][];
  if (entries.length === 0) {
    const existing = await getDraftById(scope, id);
    if (!existing) throw new Error(`campaign draft ${id} not found`);
    return existing;
  }

  const s = scopeClause(scope);
  // $1 is the scope param and $2 is the id, so field placeholders start at $3.
  const setClauses = entries.map(([field], index) => {
    const column = FIELD_COLUMNS[field];
    const placeholder = `$${index + 3}`;
    return JSON_FIELDS.has(field) ? `${column} = ${placeholder}::jsonb` : `${column} = ${placeholder}`;
  });
  const values = entries.map(([field, value]) =>
    JSON_FIELDS.has(field) ? JSON.stringify(value) : value,
  );

  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftRow>(
      `UPDATE adsagent.campaign_drafts
          SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE ${s.sql} AND id = $2
        RETURNING *`,
      [...s.params, id, ...values],
    );
    if (!rows[0]) throw new Error(`campaign draft ${id} not found`);
    return rowToDraft(rows[0]);
  });
}

export async function setDraftStatus(
  scope: Scope,
  id: string,
  status: CampaignDraftStatus,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaign_drafts SET status = $3, updated_at = NOW()
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, status],
    ),
  );
}

export async function markDraftConverted(
  scope: Scope,
  id: string,
  proposalId: string,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaign_drafts
          SET status = 'converted', proposal_id = $3, updated_at = NOW()
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, proposalId],
    ),
  );
}
```

Replace `appendDraftMessage` and `listDraftMessages` (lines 128–146) with:

```ts
export async function appendDraftMessage(
  scope: Scope,
  draftId: string,
  role: "user" | "assistant",
  content: string,
): Promise<CampaignDraftMessage> {
  const s = scopeClause(scope, "d.org_id");
  return withTenantTransaction(scope, async (client) => {
    // The parent draft carries authoritative ownership; the SELECT is what
    // makes a message under another tenant's draft impossible to create, and
    // org_id is denormalised onto the row so it can carry its own RLS policy.
    const { rows } = await client.query<CampaignDraftMessageRow>(
      `INSERT INTO adsagent.campaign_draft_messages (org_id, draft_id, role, content)
       SELECT d.org_id, d.id, $3, $4
         FROM adsagent.campaign_drafts d
        WHERE ${s.sql} AND d.id = $2
       RETURNING *`,
      [...s.params, draftId, role, content],
    );
    if (!rows[0]) throw new Error(`campaign draft ${draftId} not found`);
    return rowToMessage(rows[0]);
  });
}

export async function listDraftMessages(
  scope: Scope,
  draftId: string,
): Promise<CampaignDraftMessage[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftMessageRow>(
      `SELECT * FROM adsagent.campaign_draft_messages
        WHERE ${s.sql} AND draft_id = $2
        ORDER BY created_at ASC`,
      [...s.params, draftId],
    );
    return rows.map(rowToMessage);
  });
}
```

- [ ] **Step 5: Run the module tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts lib/db/campaign-drafts.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 6: Write migration 009**

Create `ads-agent/lib/db/migrations/009_rls_proposals_drafts.up.sql`:

```sql
-- ENABLE is not enough: table owners ignore row security unless it is FORCEd
-- (validation F-20). WITH CHECK matters as much as USING: without it a tenant
-- can write rows carrying another tenant's org_id.
ALTER TABLE adsagent.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.proposals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.proposals;
CREATE POLICY tenant_isolation ON adsagent.proposals
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.campaign_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_drafts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_drafts;
CREATE POLICY tenant_isolation ON adsagent.campaign_drafts
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.campaign_draft_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_draft_messages FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_draft_messages;
CREATE POLICY tenant_isolation ON adsagent.campaign_draft_messages
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());
```

Create `ads-agent/lib/db/migrations/009_rls_proposals_drafts.down.sql`:

```sql
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_draft_messages;
ALTER TABLE adsagent.campaign_draft_messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_draft_messages DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaign_drafts;
ALTER TABLE adsagent.campaign_drafts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaign_drafts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.proposals;
ALTER TABLE adsagent.proposals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.proposals DISABLE ROW LEVEL SECURITY;
```

- [ ] **Step 7: Update the fifteen call sites**

Every call site gains a scope as the first argument. Until Task 17 introduces `guard`, server components and routes build it inline from the session. Add to each server component and route that calls these functions:

```ts
import { requireSession } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
```

Create `ads-agent/lib/auth/scope-interim.ts` — a single interim helper so all fifteen call sites derive the scope one way, and Task 17 has one file to delete:

```ts
import { getPool } from "@/lib/db/client";
import type { Scope } from "@/lib/db/scope-sql";
import type { Session } from "./dal";

/**
 * Interim scope derivation for S3-B. Task 17 replaces every caller with
 * `guard`, which returns the same Scope alongside the role check, and deletes
 * this file. It exists so seven parallel branches derive scope identically
 * rather than seven slightly different ways.
 */
export async function scopeForSession(session: Session): Promise<Scope> {
  if (!session.orgId) throw new Error("session has no orgId");
  const { rows } = await getPool().query<{ kind: "internal" | "external" }>(
    `SELECT kind FROM public.orgs WHERE id = $1`,
    [session.orgId],
  );
  const kind = rows[0]?.kind ?? "external";
  return kind === "internal"
    ? { kind: "platform", orgId: session.orgId }
    : { kind: "org", orgId: session.orgId };
}

/**
 * Scope for a background job that has no session: the decision cycle, the
 * executor, and the MCP servers. Each runs for exactly one org, named by the
 * caller -- never inferred, and never platform.
 */
export function scopeForJob(orgId: string): Scope {
  return { kind: "org", orgId };
}
```

Apply these substitutions:

| File | Change |
|---|---|
| `app/(admin)/proposals/page.tsx` | `const scope = await scopeForSession(await requireSession());` then `listProposals(scope)` / `listProposals(scope, status)` |
| `app/(admin)/proposals/[id]/page.tsx` | same, then `getProposalById(scope, id)` |
| `app/(admin)/campaigns/drafts/[id]/page.tsx` | same, then `getDraftById(scope, id)` and `listDraftMessages(scope, id)` |
| `app/(admin)/campaigns/new/page.tsx` | same, then `createDraft(scope)` |
| `app/api/proposals/[id]/route.ts` | `const scope = await scopeForSession(access.session);` then `getProposalById(scope, id)`, `updateProposalPayload(scope, id, nextPayload)` |
| `app/api/proposals/[id]/approve/route.ts` | same, then `getProposalById(scope, id)`, `decideProposal(scope, id, "approved", access.session.userId, "ui")`, `executeProposal(scope, id)` |
| `app/api/proposals/[id]/reject/route.ts` | same, then `getProposalById(scope, id)`, `decideProposal(scope, id, "rejected", access.session.userId, "ui")` |
| `app/api/campaign-drafts/[id]/route.ts` | same, then `getDraftById(scope, id)`, `updateDraftFields(scope, id, fields)`, `setDraftStatus(scope, id, ...)` |
| `app/api/campaign-drafts/[id]/messages/route.ts` | same, then `appendDraftMessage(scope, id, role, content)`, `listDraftMessages(scope, id)` |
| `app/api/campaign-drafts/[id]/create-proposal/route.ts` | same, then `getDraftById(scope, id)`, `createProposal(scope, newProposal)`, `markDraftConverted(scope, id, proposal.id)` |
| `lib/decision-engine/cycle.ts` | `runDecisionCycle(scope: Scope)` gains scope as its first parameter and threads it into `listProposals`, `createProposal` |
| `lib/executor/execute.ts` | `executeProposal(scope: Scope, id: string)` gains scope first and threads it into `getProposalById`, `markProposalExecuted`, `markProposalFailed` |
| `lib/openui/analytics-tools.ts` | every tool handler takes `scope: Scope` and threads it into `listProposals` |
| `lib/openui/campaign-tools.ts` | every tool handler takes `scope: Scope` and threads it into `getDraftById`, `updateDraftFields`, `setDraftStatus` |
| `mcp/google-ads-server/tools.ts` | each tool reads `ADS_AGENT_ORG_ID` from the environment and calls `scopeForJob(orgId)`, threading it into `listProposals`, `getProposalById` |

`app/api/proposals/[id]/approve/route.ts` after this step is exactly:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { decideProposal, getProposalById } from "@/lib/db/proposals";
import { executeProposal } from "@/lib/executor/execute";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
  const { id } = await params;
  const proposal = await getProposalById(scope, id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  await decideProposal(scope, id, "approved", access.session.userId, "ui");
  const result = await executeProposal(scope, id);
  return NextResponse.json({ ok: true, result });
}
```

- [ ] **Step 8: Typecheck — the compiler enumerates any call site missed**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors. Any error is a call site that would otherwise have performed a full-table read; that is the whole reason `Scope` is the first and required parameter.

- [ ] **Step 9: Apply the migration and run the full suite**

Run: `cd ads-agent && npx tsx lib/db/migrate.ts`
Expected stdout: `ads-agent: applied 1 migration(s): 009_rls_proposals_drafts`

Run: `cd ads-agent && npx vitest run`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add ads-agent/lib/db/proposals.ts ads-agent/lib/db/proposals.test.ts \
        ads-agent/lib/db/campaign-drafts.ts ads-agent/lib/db/campaign-drafts.test.ts \
        ads-agent/lib/db/migrations/ ads-agent/lib/auth/scope-interim.ts \
        ads-agent/app ads-agent/lib/decision-engine ads-agent/lib/executor \
        ads-agent/lib/openui ads-agent/mcp
git commit -m "feat(db): scope proposals and campaign-drafts, with RLS beneath

Scope is the first and required parameter, so tsc enumerates every call site
rather than a missed one silently reading the whole table. RLS is ENABLEd and
FORCEd with both USING and WITH CHECK on all three tables."
```

## Task 11 (U2): `settings` → per-org `org_cron_settings`

**Skills:** `refactoring-specialist`, `postgres-pro`
**Model:** `composer-2.5-fast` — six call sites, complete code below.

**Files:**
- Delete: `ads-agent/lib/db/settings.ts`, `ads-agent/lib/db/settings.test.ts`
- Create: `ads-agent/lib/db/org-settings.ts`, `ads-agent/lib/db/org-settings.test.ts`
- Create: `ads-agent/lib/db/migrations/008_org_cron_settings.up.sql` / `.down.sql`
- Modify: `ads-agent/app/(admin)/layout.tsx`, `ads-agent/app/(admin)/settings/page.tsx`
- Modify: `ads-agent/app/api/settings/route.ts`, `ads-agent/app/api/cycle/run/route.ts`
- Modify: `ads-agent/scripts/run-decision-cycle.ts`, `ads-agent/scripts/run-once.ts`

**Interfaces:**
- Consumes: `Scope`, `scopeClause`, `withTenantTransaction` from Task 9; `scopeForSession`/`scopeForJob` from `lib/auth/scope-interim.ts` (Task 10 creates it; if this branch runs first, create it with the exact contents given in Task 10 Step 7 — both branches producing an identical file merges cleanly).
- Produces:
  - `getOrgSettings(scope: Scope): Promise<OrgSettings>` where `type OrgSettings = { cronEnabled: boolean; lastRunAt: string | null; undoWindowSeconds: number; approvalThresholdInr: number | null }`
  - `setCronEnabled(scope: Scope, enabled: boolean): Promise<void>`
  - `touchLastRunAt(scope: Scope): Promise<void>`
  - `ensureOrgSettings(scope: Scope): Promise<void>`

**Context.** `cron_settings` is a hard global singleton — `id INT PRIMARY KEY DEFAULT 1, CHECK (id = 1)` with a seeded row — so automation is on or off for everyone at once (tenancy spec, obstacle 3). It is left in place, unread, and dropped in a later cleanup once `org_cron_settings` is proven, which keeps this migration reversible. The type `CronSettings` in `lib/types.ts` is replaced by `OrgSettings` exported from the new module, since it gains two fields.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/db/org-settings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { ensureOrgSettings, getOrgSettings, setCronEnabled, touchLastRunAt } from "./org-settings";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("getOrgSettings", () => {
  it("reads only the caller's row", async () => {
    query.mockResolvedValue({
      rows: [
        {
          cron_enabled: true,
          last_run_at: new Date("2026-08-03T06:00:00.000Z"),
          undo_window_seconds: 60,
          approval_threshold_inr: null,
        },
      ],
    });
    await expect(getOrgSettings(ORG)).resolves.toEqual({
      cronEnabled: true,
      lastRunAt: "2026-08-03T06:00:00.000Z",
      undoWindowSeconds: 60,
      approvalThresholdInr: null,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("adsagent.org_cron_settings");
    expect(sql).toContain("org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });

  it("returns safe defaults when the org has no row yet", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getOrgSettings(ORG)).resolves.toEqual({
      cronEnabled: false,
      lastRunAt: null,
      undoWindowSeconds: 60,
      approvalThresholdInr: null,
    });
  });
});

describe("setCronEnabled", () => {
  it("upserts the caller's row only", async () => {
    query.mockResolvedValue({ rows: [] });
    await setCronEnabled(ORG, true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.org_cron_settings");
    expect(sql).toContain("ON CONFLICT (org_id)");
    expect(sql).not.toContain("id = 1");
    expect(params).toEqual([ORG.orgId, true]);
  });
});

describe("touchLastRunAt", () => {
  it("scopes the update to the caller", async () => {
    query.mockResolvedValue({ rows: [] });
    await touchLastRunAt(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("last_run_at = NOW()");
    expect(sql).toContain("org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });
});

describe("ensureOrgSettings", () => {
  it("inserts defaults idempotently", async () => {
    query.mockResolvedValue({ rows: [] });
    await ensureOrgSettings(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (org_id) DO NOTHING");
    expect(params).toEqual([ORG.orgId]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/org-settings.test.ts`
Expected: FAIL — `Cannot find module './org-settings'`.

- [ ] **Step 3: Write migration 008**

Create `ads-agent/lib/db/migrations/008_org_cron_settings.up.sql`:

```sql
-- cron_settings was a hard global singleton (id INT PRIMARY KEY DEFAULT 1,
-- CHECK (id = 1)), so automation was on or off for every tenant at once. It is
-- left in place, unread, and dropped in a later cleanup once this table is
-- proven -- which is what keeps this migration reversible.
CREATE TABLE IF NOT EXISTS adsagent.org_cron_settings (
  org_id                 public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  cron_enabled           BOOLEAN NOT NULL DEFAULT false,
  last_run_at            TIMESTAMPTZ,
  undo_window_seconds    INT NOT NULL DEFAULT 60
                           CHECK (undo_window_seconds BETWEEN 0 AND 3600),
  -- NULL means operators may approve any amount (tenancy spec Q2 default).
  approval_threshold_inr NUMERIC CHECK (approval_threshold_inr IS NULL OR approval_threshold_inr >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO adsagent.org_cron_settings (org_id, cron_enabled, last_run_at)
SELECT '00000000-0000-0000-0000-000000000001', enabled, last_run_at
  FROM adsagent.cron_settings WHERE id = 1
ON CONFLICT (org_id) DO NOTHING;

ALTER TABLE adsagent.org_cron_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.org_cron_settings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.org_cron_settings;
CREATE POLICY tenant_isolation ON adsagent.org_cron_settings
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON adsagent.org_cron_settings TO adsagent_rw;
GRANT SELECT ON adsagent.org_cron_settings TO agent_ro;
```

Create `ads-agent/lib/db/migrations/008_org_cron_settings.down.sql`:

```sql
DROP POLICY IF EXISTS tenant_isolation ON adsagent.org_cron_settings;
DROP TABLE IF EXISTS adsagent.org_cron_settings;
```

`cron_settings` still holds the pre-migration values, so this down is lossless for anything the up migration read.

- [ ] **Step 4: Implement `org-settings.ts`**

Create `ads-agent/lib/db/org-settings.ts`:

```ts
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type OrgSettings = {
  cronEnabled: boolean;
  lastRunAt: string | null;
  undoWindowSeconds: number;
  approvalThresholdInr: number | null;
};

type OrgSettingsRow = {
  cron_enabled: boolean;
  last_run_at: Date | null;
  undo_window_seconds: number;
  approval_threshold_inr: string | null;
};

const DEFAULTS: OrgSettings = {
  cronEnabled: false,
  lastRunAt: null,
  undoWindowSeconds: 60,
  approvalThresholdInr: null,
};

export async function getOrgSettings(scope: Scope): Promise<OrgSettings> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<OrgSettingsRow>(
      `SELECT cron_enabled, last_run_at, undo_window_seconds, approval_threshold_inr
         FROM adsagent.org_cron_settings
        WHERE ${s.sql}`,
      [...s.params],
    );
    const row = rows[0];
    // An org with no row yet gets the table's own defaults rather than an
    // error: automation off is the safe reading of "not configured".
    if (!row) return DEFAULTS;
    return {
      cronEnabled: row.cron_enabled,
      lastRunAt: row.last_run_at?.toISOString() ?? null,
      undoWindowSeconds: row.undo_window_seconds,
      approvalThresholdInr:
        row.approval_threshold_inr === null ? null : Number(row.approval_threshold_inr),
    };
  });
}

export async function setCronEnabled(scope: Scope, enabled: boolean): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.org_cron_settings (org_id, cron_enabled)
       VALUES ($1::uuid, $2)
       ON CONFLICT (org_id) DO UPDATE
         SET cron_enabled = EXCLUDED.cron_enabled, updated_at = NOW()`,
      [...s.params, enabled],
    ),
  );
}

export async function touchLastRunAt(scope: Scope): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.org_cron_settings
          SET last_run_at = NOW(), updated_at = NOW()
        WHERE ${s.sql}`,
      [...s.params],
    ),
  );
}

/** Called on first request for an org so a newly-onboarded tenant has defaults. */
export async function ensureOrgSettings(scope: Scope): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.org_cron_settings (org_id) VALUES ($1::uuid)
       ON CONFLICT (org_id) DO NOTHING`,
      [...s.params],
    ),
  );
}
```

Delete the old module and its test:

```bash
git rm ads-agent/lib/db/settings.ts ads-agent/lib/db/settings.test.ts
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/db/org-settings.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Update the six call sites**

`ads-agent/app/api/settings/route.ts` becomes:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { getOrgSettings, setCronEnabled } from "@/lib/db/org-settings";

export async function GET() {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
  return NextResponse.json(await getOrgSettings(scope));
}

export async function PATCH(req: Request) {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setCronEnabled(scope, body.enabled);
  return NextResponse.json({ ok: true });
}
```

`ads-agent/app/api/cycle/run/route.ts` becomes:

```ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { runDecisionCycle } from "@/lib/decision-engine/cycle";
import { touchLastRunAt } from "@/lib/db/org-settings";

export async function POST() {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  // A cycle runs for exactly one org: the caller's. Platform scope must not
  // widen it, so the job scope is always org-bounded.
  const sessionScope = await scopeForSession(access.session);
  const scope = { kind: "org" as const, orgId: sessionScope.orgId };
  const result = await runDecisionCycle(scope);
  await touchLastRunAt(scope);
  return NextResponse.json(result);
}
```

`ads-agent/app/(admin)/settings/page.tsx`: replace `getCronSettings()` with `getOrgSettings(await scopeForSession(await requireSession()))`, and rename the consumed fields from `settings.enabled` / `settings.lastRunAt` to `settings.cronEnabled` / `settings.lastRunAt`.

`ads-agent/app/(admin)/layout.tsx`: replace `getCronSettings()` with `getOrgSettings(await scopeForSession(session))`, reusing the `session` the layout already has, and rename `enabled` to `cronEnabled` at its use site.

`ads-agent/scripts/run-decision-cycle.ts` and `ads-agent/scripts/run-once.ts`: both are background jobs with no session. Each reads the org from the environment and builds an org-bounded scope:

```ts
import { scopeForJob } from "../lib/auth/scope-interim";
import { getOrgSettings, touchLastRunAt } from "../lib/db/org-settings";

const orgId = process.env.ADS_AGENT_ORG_ID;
if (!orgId) throw new Error("ADS_AGENT_ORG_ID is not set");
const scope = scopeForJob(orgId);
```

then thread `scope` into `getOrgSettings(scope)` and `touchLastRunAt(scope)` in place of the no-argument calls. A job never runs under platform scope: an autonomous cycle acting across tenants is exactly the failure the tenancy model exists to prevent.

- [ ] **Step 7: Typecheck, apply, and run the suite**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors.

Run: `cd ads-agent && npx tsx lib/db/migrate.ts`
Expected stdout: `ads-agent: applied 1 migration(s): 008_org_cron_settings`

Run: `cd ads-agent && npx vitest run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add ads-agent/lib/db/org-settings.ts ads-agent/lib/db/org-settings.test.ts \
        ads-agent/lib/db/migrations/ ads-agent/app ads-agent/scripts
git rm ads-agent/lib/db/settings.ts ads-agent/lib/db/settings.test.ts
git commit -m "feat(db): per-org automation settings, replacing the global singleton

cron_settings was CHECK (id = 1) with one seeded row, so automation was on or
off for every tenant at once. cron_settings is retained unread so this stays
reversible. Background jobs run under org scope, never platform -- an
autonomous cycle acting across tenants is the failure tenancy exists to stop."
```

## Task 12 (U6): `credits`

**Skills:** `refactoring-specialist`, `typescript-pro`
**Model:** `composer-2.5-fast` — one call site, complete code below.

**Files:**
- Modify: `ads-agent/lib/db/credits.ts`
- Create: `ads-agent/lib/db/credits.test.ts`
- Create: `ads-agent/lib/db/migrations/012_rls_credits.up.sql` / `.down.sql`
- Modify: `ads-agent/app/(admin)/credits/page.tsx`

**Interfaces:**
- Consumes: `Scope`, `scopeClause`, `withTenantTransaction` from Task 9; `scopeForSession` from `lib/auth/scope-interim.ts` (create it with the exact contents in Task 10 Step 7 if this branch runs first).
- Produces:
  - `listOrgBalances(scope: Scope): Promise<OrgBalanceRow[]>` — **throws on org scope**
  - `listMemberBalances(scope: Scope): Promise<MemberBalanceRow[]>`
  - `getSpendByFeature(scope: Scope, days: number): Promise<SpendByKeyRow[]>`
  - `getSpendByModel(scope: Scope, days: number): Promise<SpendByKeyRow[]>`
  - `getSpendTrend(scope: Scope, days: number): Promise<SpendTrendPoint[]>`

**Context.** These functions already take a bare `orgId: string`, which is the shape that lets a caller pass any org's id it happens to hold. Converting them to `Scope` makes the derivation server-side. `listOrgBalances` lists every org on the platform and has no `orgId` parameter at all today; it is **platform scope only and must throw when handed an org scope** (tenancy spec §3), because returning an empty array would be indistinguishable from a platform user with no orgs.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/db/credits.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "./credits";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

beforeEach(() => query.mockReset());

describe("listOrgBalances", () => {
  it("throws when handed an org scope — it lists every org on the platform", async () => {
    await expect(listOrgBalances(ORG)).rejects.toThrow(
      "listOrgBalances requires platform scope",
    );
    expect(query, "must not reach the database at all").not.toHaveBeenCalled();
  });

  it("returns every org's balance under platform scope", async () => {
    query.mockResolvedValue({
      rows: [{ org_id: "o1", org_name: "One", balance_credits: "100" }],
    });
    await expect(listOrgBalances(PLATFORM)).resolves.toEqual([
      { orgId: "o1", orgName: "One", balanceCredits: 100 },
    ]);
  });
});

describe("listMemberBalances", () => {
  it("lists only the caller's members", async () => {
    query.mockResolvedValue({ rows: [] });
    await listMemberBalances(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("public.users");
    expect(sql).toContain("u.org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });
});

describe("getSpendByFeature", () => {
  it("scopes the ledger and passes days as $2", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendByFeature(ORG, 30);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("adsagent.usage_ledger");
    expect(sql).toContain("feature AS key");
    expect(params).toEqual([ORG.orgId, 30]);
  });
});

describe("getSpendByModel", () => {
  it("groups by model", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendByModel(ORG, 7);
    expect(query.mock.calls[0][0]).toContain("model AS key");
  });
});

describe("getSpendTrend", () => {
  it("scopes the trend", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendTrend(ORG, 14);
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, 14]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/credits.test.ts`
Expected: FAIL — TypeScript reports `Argument of type 'Scope' is not assignable to parameter of type 'string'`.

- [ ] **Step 3: Convert `credits.ts`**

Replace the whole of `ads-agent/lib/db/credits.ts` with:

```ts
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type OrgBalanceRow = { orgId: string; orgName: string; balanceCredits: number };

/**
 * Platform scope only. This lists every org on the platform, so there is no
 * org-scoped reading of it. It throws rather than returning an empty array:
 * an empty list is indistinguishable from a platform user whose deployment has
 * no orgs, and a caller that silently sees nothing does not get fixed.
 */
export async function listOrgBalances(scope: Scope): Promise<OrgBalanceRow[]> {
  if (scope.kind !== "platform") {
    throw new Error("listOrgBalances requires platform scope");
  }
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{
      org_id: string;
      org_name: string;
      balance_credits: string;
    }>(
      `SELECT o.id AS org_id, o.name AS org_name, COALESCE(b.balance_credits, 0) AS balance_credits
         FROM public.orgs o
         LEFT JOIN adsagent.org_balances b ON b.org_id = o.id
        ORDER BY o.created_at ASC`,
    );
    return rows.map((row) => ({
      orgId: row.org_id,
      orgName: row.org_name,
      balanceCredits: Number(row.balance_credits),
    }));
  });
}

export type MemberBalanceRow = {
  userId: string;
  email: string;
  displayName: string | null;
  capCredits: number | null;
};

export async function listMemberBalances(scope: Scope): Promise<MemberBalanceRow[]> {
  const s = scopeClause(scope, "u.org_id");
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{
      user_id: string;
      email: string;
      display_name: string | null;
      cap_credits: string | null;
    }>(
      `SELECT u.id AS user_id, u.email, u.display_name, ub.balance_credits AS cap_credits
         FROM public.users u
         LEFT JOIN adsagent.user_balances ub ON ub.user_id = u.id
        WHERE ${s.sql}
        ORDER BY u.created_at ASC`,
      [...s.params],
    );
    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      capCredits: row.cap_credits === null ? null : Number(row.cap_credits),
    }));
  });
}

export type SpendByKeyRow = { key: string; totalCredits: number; totalCostUsd: number };

async function spendByColumn(
  scope: Scope,
  days: number,
  column: "feature" | "model",
): Promise<SpendByKeyRow[]> {
  // `column` is a closed union, never caller-supplied text, so interpolating it
  // cannot inject. Every value is parameterised.
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{
      key: string;
      total_credits: string;
      total_cost_usd: string;
    }>(
      `SELECT ${column} AS key,
              COALESCE(SUM(credits_debited), 0) AS total_credits,
              COALESCE(SUM(cost_usd), 0) AS total_cost_usd
         FROM adsagent.usage_ledger
        WHERE ${s.sql} AND occurred_at >= NOW() - ($2 || ' days')::interval
        GROUP BY ${column}
        ORDER BY total_credits DESC`,
      [...s.params, days],
    );
    return rows.map((row) => ({
      key: row.key,
      totalCredits: Number(row.total_credits),
      totalCostUsd: Number(row.total_cost_usd),
    }));
  });
}

export async function getSpendByFeature(scope: Scope, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(scope, days, "feature");
}

export async function getSpendByModel(scope: Scope, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(scope, days, "model");
}

export type SpendTrendPoint = { date: string; totalCredits: number };

type TrendRow = { day: Date; total_credits: string };

export async function getSpendTrend(scope: Scope, days: number): Promise<SpendTrendPoint[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<TrendRow>(
      `SELECT date_trunc('day', occurred_at) AS day,
              COALESCE(SUM(credits_debited), 0) AS total_credits
         FROM adsagent.usage_ledger
        WHERE ${s.sql} AND occurred_at >= NOW() - ($2 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC`,
      [...s.params, days],
    );
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      totalCredits: Number(row.total_credits),
    }));
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/db/credits.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write migration 012**

Create `ads-agent/lib/db/migrations/012_rls_credits.up.sql`:

```sql
-- The four billing tables already carried org_id, so they need policies and
-- org_id-leading indexes, not columns.
ALTER TABLE adsagent.org_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.org_balances FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.org_balances;
CREATE POLICY tenant_isolation ON adsagent.org_balances
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.user_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.user_balances FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.user_balances;
CREATE POLICY tenant_isolation ON adsagent.user_balances
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.credit_grants FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.credit_grants;
CREATE POLICY tenant_isolation ON adsagent.credit_grants
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.usage_ledger FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.usage_ledger;
CREATE POLICY tenant_isolation ON adsagent.usage_ledger
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

CREATE INDEX IF NOT EXISTS usage_ledger_org_occurred_idx
  ON adsagent.usage_ledger (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS credit_grants_org_created_idx
  ON adsagent.credit_grants (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_balances_org_idx
  ON adsagent.user_balances (org_id);
```

Create `ads-agent/lib/db/migrations/012_rls_credits.down.sql`:

```sql
DROP INDEX IF EXISTS adsagent.user_balances_org_idx;
DROP INDEX IF EXISTS adsagent.credit_grants_org_created_idx;
DROP INDEX IF EXISTS adsagent.usage_ledger_org_occurred_idx;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.usage_ledger;
ALTER TABLE adsagent.usage_ledger NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.usage_ledger DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.credit_grants;
ALTER TABLE adsagent.credit_grants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.credit_grants DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.user_balances;
ALTER TABLE adsagent.user_balances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.user_balances DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.org_balances;
ALTER TABLE adsagent.org_balances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.org_balances DISABLE ROW LEVEL SECURITY;
```

- [ ] **Step 6: Update the one call site, removing the crash class**

In `ads-agent/app/(admin)/credits/page.tsx`, line 29 currently uses a non-null assertion on `session.orgId`, which throws for an admin whose JWT lacks an org (tenancy spec, obstacle 2). Replace the data-loading block with:

```ts
  const session = await requireSession();
  const scope = await scopeForSession(session);
  const [memberBalances, spendByFeature, spendByModel, spendTrend] = await Promise.all([
    listMemberBalances(scope),
    getSpendByFeature(scope, 30),
    getSpendByModel(scope, 30),
    getSpendTrend(scope, 30),
  ]);
  // Only platform staff see every org's balance; an external admin sees their own.
  const orgBalances = scope.kind === "platform" ? await listOrgBalances(scope) : [];
```

and add to the imports:

```ts
import { requireSession } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
```

`scopeForSession` throws when `orgId` is null, which Task 17's session hardening converts into the existing pending-approval card rather than a crash.

- [ ] **Step 7: Typecheck, apply, run the suite, commit**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors.

Run: `cd ads-agent && npx tsx lib/db/migrate.ts`
Expected stdout: `ads-agent: applied 1 migration(s): 012_rls_credits`

Run: `cd ads-agent && npx vitest run`
Expected: all green.

```bash
git add ads-agent/lib/db/credits.ts ads-agent/lib/db/credits.test.ts \
        ads-agent/lib/db/migrations/ ads-agent/app/\(admin\)/credits/
git commit -m "feat(db): scope the credits module, with RLS on all four billing tables

listOrgBalances lists every org on the platform, so it is platform-scope only
and throws on org scope -- returning an empty array would be indistinguishable
from a deployment with no orgs. credits/page.tsx loses the non-null assertion
on session.orgId that crashed an admin whose JWT lacked an org."
```

## Task 13 (U3+U5): `campaigns` + `snapshots`

**Skills:** `refactoring-specialist`, `sql-pro`
**Model:** `composer-2.5-fast` — complete code below.

**Files:**
- Modify: `ads-agent/lib/db/campaigns.ts`, `ads-agent/lib/db/campaigns.test.ts`
- Modify: `ads-agent/lib/db/snapshots.ts`, `ads-agent/lib/db/snapshots.test.ts`
- Create: `ads-agent/lib/db/migrations/010_rls_campaigns.up.sql` / `.down.sql`
- Create: `ads-agent/lib/db/migrations/011_rls_snapshots.up.sql` / `.down.sql`
- Modify: `ads-agent/app/api/campaigns/[id]/status/route.ts`
- Modify: `ads-agent/lib/decision-engine/cycle.ts`, `ads-agent/lib/executor/execute.ts`

**Interfaces:**
- Consumes: `Scope`, `scopeClause`, `withTenantTransaction` from Task 9; `scopeForSession`/`scopeForJob` from `lib/auth/scope-interim.ts`.
- Produces:
  - `createCampaignRecord(scope: Scope, input: NewCampaign): Promise<Campaign>`
  - `listCampaigns(scope: Scope): Promise<Campaign[]>`
  - `getCampaignById(scope: Scope, id: string): Promise<Campaign | null>`
  - `markCampaignActive(scope: Scope, id: string, externalId: string): Promise<void>`
  - `updateCampaignBudget(scope: Scope, id: string, dailyBudget: number): Promise<void>`
  - `updateCampaignStatus(scope: Scope, id: string, status: CampaignStatus): Promise<void>`
  - `recordPerformanceSnapshot(scope: Scope, input: NewPerformanceSnapshot): Promise<void>`
  - `recentPerformanceSnapshots(scope: Scope, days: number): Promise<PerformanceSnapshot[]>`
  - `recordCrmSignalSnapshot(scope: Scope, input: NewCrmSignalSnapshot): Promise<void>`
  - `latestCrmSignalSnapshot(scope: Scope): Promise<CrmSignalSnapshot | null>`

**Context.** These two modules are one unit because both modify `lib/decision-engine/cycle.ts` and `lib/executor/execute.ts`, and both are small. Both snapshot tables now carry their own `org_id` (migration 007) rather than being scoped by joining `campaigns`; the parent join remains the source when writing, so a snapshot cannot be attached to another tenant's campaign. `recentPerformanceSnapshots` currently interpolates `days` directly into the SQL string; the conversion parameterises it.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `ads-agent/lib/db/campaigns.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  createCampaignRecord,
  getCampaignById,
  listCampaigns,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
} from "./campaigns";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const row = {
  id: "camp-1",
  platform: "google",
  external_id: null,
  name: "HSR search",
  status: "proposed",
  daily_budget: "700",
  corridor: "HSR",
  created_at: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createCampaignRecord", () => {
  it("stamps org_id and numbers the rest from $2", async () => {
    query.mockResolvedValue({ rows: [row] });
    await createCampaignRecord(ORG, {
      platform: "google",
      name: "HSR search",
      dailyBudget: 700,
      corridor: "HSR",
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.campaigns");
    expect(sql).toContain("(org_id, platform, name, daily_budget, corridor)");
    expect(params).toEqual([ORG.orgId, "google", "HSR search", 700, "HSR"]);
  });
});

describe("listCampaigns", () => {
  it("scopes the listing", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listCampaigns(ORG);
    expect(query.mock.calls[0][0]).toContain("WHERE org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId]);
  });
});

describe("getCampaignById", () => {
  it("returns null outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getCampaignById(ORG, "camp-x")).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-x"]);
  });
});

describe("markCampaignActive", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await markCampaignActive(ORG, "camp-1", "ext-1");
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-1", "ext-1"]);
  });
});

describe("updateCampaignBudget", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await updateCampaignBudget(ORG, "camp-1", 900);
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-1", 900]);
  });
});

describe("updateCampaignStatus", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await updateCampaignStatus(ORG, "camp-1", "paused");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-1", "paused"]);
  });
});
```

Replace the whole of `ads-agent/lib/db/snapshots.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  latestCrmSignalSnapshot,
  recentPerformanceSnapshots,
  recordCrmSignalSnapshot,
  recordPerformanceSnapshot,
} from "./snapshots";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("recordPerformanceSnapshot", () => {
  it("derives org_id from the parent campaign inside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [{ id: "snap-1" }] });
    await recordPerformanceSnapshot(ORG, {
      campaignId: "camp-1",
      spend: 1000,
      clicks: 50,
      impressions: 900,
      conversions: 4,
      raw: {},
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.performance_snapshots");
    expect(sql).toContain("FROM adsagent.campaigns c");
    expect(sql).toContain("org_id = $1::uuid");
    expect(params[0]).toBe(ORG.orgId);
    expect(params[1]).toBe("camp-1");
    // cpl = spend / conversions
    expect(params[6]).toBe(250);
  });

  it("stores a null cpl when there were no conversions", async () => {
    query.mockResolvedValue({ rows: [{ id: "snap-1" }] });
    await recordPerformanceSnapshot(ORG, {
      campaignId: "camp-1",
      spend: 1000,
      clicks: 50,
      impressions: 900,
      conversions: 0,
    });
    expect(query.mock.calls[0][1][6]).toBeNull();
  });

  it("throws when the campaign is outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(
      recordPerformanceSnapshot(ORG, {
        campaignId: "camp-x",
        spend: 1,
        clicks: 1,
        impressions: 1,
        conversions: 1,
      }),
    ).rejects.toThrow("campaign camp-x not found");
  });
});

describe("recentPerformanceSnapshots", () => {
  it("parameterises the day window instead of interpolating it", async () => {
    query.mockResolvedValue({ rows: [] });
    await recentPerformanceSnapshots(ORG, 7);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("INTERVAL '7");
    expect(sql).toContain("($2 || ' days')::interval");
    expect(params).toEqual([ORG.orgId, 7]);
  });
});

describe("recordCrmSignalSnapshot", () => {
  it("stamps the caller's org_id directly, since campaign_id is nullable", async () => {
    query.mockResolvedValue({ rows: [] });
    await recordCrmSignalSnapshot(ORG, {
      campaignId: null,
      hotCount: 1,
      warmCount: 2,
      coldCount: 3,
      unscoredCount: 4,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.crm_signal_snapshots");
    expect(params).toEqual([ORG.orgId, null, 1, 2, 3, 4]);
  });
});

describe("latestCrmSignalSnapshot", () => {
  it("scopes the read", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(latestCrmSignalSnapshot(ORG)).resolves.toBeNull();
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/db/campaigns.test.ts lib/db/snapshots.test.ts`
Expected: FAIL — argument-count mismatches on all ten functions.

- [ ] **Step 3: Convert `campaigns.ts`**

Replace lines 1–2 of `ads-agent/lib/db/campaigns.ts` with:

```ts
import type { Campaign, CampaignStatus, NewCampaign, Platform } from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";
```

Replace lines 28–69 (every exported function; `CampaignRow` and `rowToCampaign` are unchanged) with:

```ts
export async function createCampaignRecord(scope: Scope, input: NewCampaign): Promise<Campaign> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignRow>(
      `INSERT INTO adsagent.campaigns (org_id, platform, name, daily_budget, corridor)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING *`,
      [...s.params, input.platform, input.name, input.dailyBudget, input.corridor],
    );
    return rowToCampaign(rows[0]);
  });
}

export async function listCampaigns(scope: Scope): Promise<Campaign[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignRow>(
      `SELECT * FROM adsagent.campaigns WHERE ${s.sql} ORDER BY created_at DESC`,
      [...s.params],
    );
    return rows.map(rowToCampaign);
  });
}

export async function getCampaignById(scope: Scope, id: string): Promise<Campaign | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignRow>(
      `SELECT * FROM adsagent.campaigns WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    );
    return rows[0] ? rowToCampaign(rows[0]) : null;
  });
}

export async function markCampaignActive(
  scope: Scope,
  id: string,
  externalId: string,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaigns SET external_id = $3, status = 'active'
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, externalId],
    ),
  );
}

export async function updateCampaignBudget(
  scope: Scope,
  id: string,
  dailyBudget: number,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaigns SET daily_budget = $3 WHERE ${s.sql} AND id = $2`,
      [...s.params, id, dailyBudget],
    ),
  );
}

export async function updateCampaignStatus(
  scope: Scope,
  id: string,
  status: CampaignStatus,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaigns SET status = $3 WHERE ${s.sql} AND id = $2`,
      [...s.params, id, status],
    ),
  );
}
```

- [ ] **Step 4: Convert `snapshots.ts`**

Replace lines 1–7 with:

```ts
import type {
  CrmSignalSnapshot,
  NewCrmSignalSnapshot,
  NewPerformanceSnapshot,
  PerformanceSnapshot,
} from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";
```

Replace lines 33–59 with:

```ts
export async function recordPerformanceSnapshot(
  scope: Scope,
  input: NewPerformanceSnapshot,
): Promise<void> {
  const cpl = input.conversions > 0 ? input.spend / input.conversions : null;
  const s = scopeClause(scope, "c.org_id");
  await withTenantTransaction(scope, async (client) => {
    // org_id comes from the parent campaign, inside the caller's scope, so a
    // snapshot cannot be attached to another tenant's campaign. It is also
    // stored on the row, so the row carries its own RLS policy.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO adsagent.performance_snapshots
         (org_id, campaign_id, spend, clicks, impressions, conversions, cpl, raw)
       SELECT c.org_id, c.id, $3, $4, $5, $6, $7, $8::jsonb
         FROM adsagent.campaigns c
        WHERE ${s.sql} AND c.id = $2
       RETURNING id`,
      [
        ...s.params,
        input.campaignId,
        input.spend,
        input.clicks,
        input.impressions,
        input.conversions,
        cpl,
        JSON.stringify(input.raw ?? {}),
      ],
    );
    if (!rows[0]) throw new Error(`campaign ${input.campaignId} not found`);
  });
}

export async function recentPerformanceSnapshots(
  scope: Scope,
  days: number,
): Promise<PerformanceSnapshot[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<PerformanceSnapshotRow>(
      `SELECT * FROM adsagent.performance_snapshots
        WHERE ${s.sql} AND captured_at >= NOW() - ($2 || ' days')::interval
        ORDER BY campaign_id, captured_at DESC`,
      [...s.params, days],
    );
    return rows.map(rowToPerformanceSnapshot);
  });
}
```

Replace lines 83–96 with:

```ts
export async function recordCrmSignalSnapshot(
  scope: Scope,
  input: NewCrmSignalSnapshot,
): Promise<void> {
  // campaign_id is nullable here, so there is no parent to inherit from; the
  // caller's own org_id is the owner.
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.crm_signal_snapshots
         (org_id, campaign_id, hot_count, warm_count, cold_count, unscored_count)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [
        ...s.params,
        input.campaignId,
        input.hotCount,
        input.warmCount,
        input.coldCount,
        input.unscoredCount,
      ],
    ),
  );
}

export async function latestCrmSignalSnapshot(scope: Scope): Promise<CrmSignalSnapshot | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CrmSignalSnapshotRow>(
      `SELECT * FROM adsagent.crm_signal_snapshots
        WHERE ${s.sql}
        ORDER BY captured_at DESC LIMIT 1`,
      [...s.params],
    );
    return rows[0] ? rowToCrmSignalSnapshot(rows[0]) : null;
  });
}
```

- [ ] **Step 5: Run the module tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/db/campaigns.test.ts lib/db/snapshots.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Write migrations 010 and 011**

Create `ads-agent/lib/db/migrations/010_rls_campaigns.up.sql`:

```sql
ALTER TABLE adsagent.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaigns FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaigns;
CREATE POLICY tenant_isolation ON adsagent.campaigns
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());
```

Create `ads-agent/lib/db/migrations/010_rls_campaigns.down.sql`:

```sql
DROP POLICY IF EXISTS tenant_isolation ON adsagent.campaigns;
ALTER TABLE adsagent.campaigns NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.campaigns DISABLE ROW LEVEL SECURITY;
```

Create `ads-agent/lib/db/migrations/011_rls_snapshots.up.sql`:

```sql
ALTER TABLE adsagent.performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.performance_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.performance_snapshots;
CREATE POLICY tenant_isolation ON adsagent.performance_snapshots
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE adsagent.crm_signal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.crm_signal_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.crm_signal_snapshots;
CREATE POLICY tenant_isolation ON adsagent.crm_signal_snapshots
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());
```

Create `ads-agent/lib/db/migrations/011_rls_snapshots.down.sql`:

```sql
DROP POLICY IF EXISTS tenant_isolation ON adsagent.crm_signal_snapshots;
ALTER TABLE adsagent.crm_signal_snapshots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.crm_signal_snapshots DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.performance_snapshots;
ALTER TABLE adsagent.performance_snapshots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE adsagent.performance_snapshots DISABLE ROW LEVEL SECURITY;
```

- [ ] **Step 7: Update the three call sites**

`ads-agent/app/api/campaigns/[id]/status/route.ts`: add `import { scopeForSession } from "@/lib/auth/scope-interim";`, then after the existing `requireApiRole` check add `const scope = await scopeForSession(access.session);` and pass `scope` as the first argument to `getCampaignById` and `updateCampaignStatus`.

`ads-agent/lib/decision-engine/cycle.ts`: `runDecisionCycle` takes `scope: Scope` as its first parameter and threads it into `listCampaigns`, `recentPerformanceSnapshots`, `latestCrmSignalSnapshot`, `recordCrmSignalSnapshot` and `recordPerformanceSnapshot`. Add:

```ts
import type { Scope } from "@/lib/db/scope-sql";
```

`ads-agent/lib/executor/execute.ts`: `executeProposal` takes `scope: Scope` as its first parameter and threads it into `createCampaignRecord`, `markCampaignActive`, `updateCampaignBudget` and `updateCampaignStatus`. Add the same import.

If Task 10 has already landed on `main`, both functions already carry `scope` as their first parameter and this step only adds the campaigns and snapshots calls; the merge in Task 17 reconciles the two edits, which touch different lines of the same functions.

- [ ] **Step 8: Typecheck, apply, run the suite, commit**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors.

Run: `cd ads-agent && npx tsx lib/db/migrate.ts`
Expected stdout: `ads-agent: applied 2 migration(s): 010_rls_campaigns, 011_rls_snapshots`

Run: `cd ads-agent && npx vitest run`
Expected: all green.

```bash
git add ads-agent/lib/db/campaigns.ts ads-agent/lib/db/campaigns.test.ts \
        ads-agent/lib/db/snapshots.ts ads-agent/lib/db/snapshots.test.ts \
        ads-agent/lib/db/migrations/ ads-agent/app/api/campaigns \
        ads-agent/lib/decision-engine ads-agent/lib/executor
git commit -m "feat(db): scope campaigns and snapshots, with RLS beneath

Snapshot writes derive org_id from the parent campaign inside the caller's
scope, so a snapshot cannot be attached to another tenant's campaign, and store
it on the row so the row carries its own policy. recentPerformanceSnapshots
stops interpolating the day window into the SQL string."
```

## Task 14 (U4): `dashboard`

**Skills:** `refactoring-specialist`, `sql-pro`
**Model:** `composer-2.5-fast` — complete code below.

**Files:**
- Modify: `ads-agent/lib/db/dashboard.ts`, `ads-agent/lib/db/dashboard.test.ts`
- Modify: `ads-agent/app/(admin)/page.tsx`, `ads-agent/app/(admin)/campaigns/page.tsx`
- Modify: `ads-agent/components/SpendCplChart.tsx`, `ads-agent/lib/openui/analytics-tools.ts`

**Interfaces:**
- Consumes: `Scope`, `scopeClause`, `withTenantTransaction` from Task 9; `scopeForSession` from `lib/auth/scope-interim.ts`.
- Produces:
  - `getOverviewStats(scope: Scope): Promise<OverviewStats>`
  - `getSpendCplTrend(scope: Scope, days: number): Promise<TrendPoint[]>`
  - `listCampaignsWithLatestCpl(scope: Scope): Promise<CampaignWithCplRow[]>`

**Context.** `dashboard.ts` owns no tables of its own, so it needs no migration; it aggregates `campaigns`, `proposals` and `performance_snapshots`, all of which get policies from Tasks 10 and 13. `getOverviewStats` already computes `pendingProposalCount` and it is already returned, so nothing is being discarded. `getSpendCplTrend` interpolates `days` into the SQL string; the conversion parameterises it.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/db/dashboard.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { getOverviewStats, getSpendCplTrend, listCampaignsWithLatestCpl } from "./dashboard";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("getOverviewStats", () => {
  it("scopes all three aggregates and computes blended CPL", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "4000", conversions: "8" }] });

    await expect(getOverviewStats(ORG)).resolves.toEqual({
      activeCampaignCount: 3,
      pendingProposalCount: 2,
      monthSpendInr: 4000,
      blendedCplInr: 500,
    });
    for (const call of query.mock.calls) {
      expect(call[0]).toContain("org_id = $1::uuid");
      expect(call[1]).toEqual([ORG.orgId]);
    }
  });

  it("reports a null blended CPL when there were no conversions", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "0", conversions: "0" }] });
    const stats = await getOverviewStats(ORG);
    expect(stats.blendedCplInr).toBeNull();
  });
});

describe("getSpendCplTrend", () => {
  it("parameterises the day window instead of interpolating it", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendCplTrend(ORG, 30);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("INTERVAL '30");
    expect(sql).toContain("($2 || ' days')::interval");
    expect(params).toEqual([ORG.orgId, 30]);
  });
});

describe("listCampaignsWithLatestCpl", () => {
  it("scopes the outer query and the lateral join", async () => {
    query.mockResolvedValue({ rows: [] });
    await listCampaignsWithLatestCpl(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("c.org_id = $1::uuid");
    expect(sql).toContain("p.org_id = c.org_id");
    expect(params).toEqual([ORG.orgId]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/dashboard.test.ts`
Expected: FAIL — argument-count mismatches on all three functions.

- [ ] **Step 3: Convert `dashboard.ts`**

Replace lines 1–2 with:

```ts
import type { CampaignStatus, Platform } from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";
```

Replace `getOverviewStats` (lines 11–31) with:

```ts
export async function getOverviewStats(scope: Scope): Promise<OverviewStats> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const [activeResult, pendingResult, spendResult] = await Promise.all([
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM adsagent.campaigns
          WHERE ${s.sql} AND status = 'active'`,
        [...s.params],
      ),
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM adsagent.proposals
          WHERE ${s.sql} AND status = 'pending'`,
        [...s.params],
      ),
      client.query<{ spend: string; conversions: string }>(
        `SELECT COALESCE(SUM(spend), 0) AS spend, COALESCE(SUM(conversions), 0) AS conversions
           FROM adsagent.performance_snapshots
          WHERE ${s.sql} AND captured_at >= date_trunc('month', now())`,
        [...s.params],
      ),
    ]);

    const monthSpendInr = Number(spendResult.rows[0].spend);
    const monthConversions = Number(spendResult.rows[0].conversions);

    return {
      activeCampaignCount: Number(activeResult.rows[0].count),
      pendingProposalCount: Number(pendingResult.rows[0].count),
      monthSpendInr,
      blendedCplInr: monthConversions > 0 ? monthSpendInr / monthConversions : null,
    };
  });
}
```

The three queries run on one client inside one transaction, so all three see the same tenant context — a `Promise.all` over `getPool().query` would have spread them across three connections, only one of which has the tenant set.

Replace `getSpendCplTrend` (lines 37–57) with:

```ts
export async function getSpendCplTrend(scope: Scope, days: number): Promise<TrendPoint[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<TrendRow>(
      `SELECT date_trunc('day', captured_at) AS day,
              COALESCE(SUM(spend), 0) AS spend,
              COALESCE(SUM(conversions), 0) AS conversions
         FROM adsagent.performance_snapshots
        WHERE ${s.sql} AND captured_at >= NOW() - ($2 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC`,
      [...s.params, days],
    );

    return rows.map((row) => {
      const spendInr = Number(row.spend);
      const conversions = Number(row.conversions);
      return {
        date: row.day.toISOString().slice(0, 10),
        spendInr,
        cplInr: conversions > 0 ? spendInr / conversions : null,
      };
    });
  });
}
```

Replace `listCampaignsWithLatestCpl` (lines 79–101) with:

```ts
export async function listCampaignsWithLatestCpl(scope: Scope): Promise<CampaignWithCplRow[]> {
  const s = scopeClause(scope, "c.org_id");
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignWithCplSqlRow>(
      `SELECT c.id, c.name, c.platform, c.status, c.daily_budget, c.corridor,
              latest.cpl AS latest_cpl
         FROM adsagent.campaigns c
         LEFT JOIN LATERAL (
           SELECT p.cpl FROM adsagent.performance_snapshots p
            WHERE p.campaign_id = c.id AND p.org_id = c.org_id
            ORDER BY p.captured_at DESC
            LIMIT 1
         ) latest ON true
        WHERE ${s.sql}
        ORDER BY c.created_at DESC`,
      [...s.params],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      status: row.status,
      dailyBudget: row.daily_budget === null ? null : Number(row.daily_budget),
      corridor: row.corridor,
      latestCplInr: row.latest_cpl === null ? null : Number(row.latest_cpl),
    }));
  });
}
```

The `p.org_id = c.org_id` predicate in the lateral is redundant under RLS and deliberate: it keeps the join correct if a policy is ever dropped, and it lets the planner use `performance_snapshots_org_campaign_idx`, whose leading column is `org_id`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/db/dashboard.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Update the four call sites**

`ads-agent/app/(admin)/page.tsx`: add

```ts
import { requireSession } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
```

then `const scope = await scopeForSession(await requireSession());` before the data loads, and pass `scope` as the first argument to `getOverviewStats`, `getSpendCplTrend` and `listCampaignsWithLatestCpl`.

`ads-agent/app/(admin)/campaigns/page.tsx`: same two imports, same scope derivation, then `listCampaignsWithLatestCpl(scope)`.

`ads-agent/components/SpendCplChart.tsx`: it is a client component and must not derive scope itself. Its parent already loads the trend data; change the component to accept the already-loaded `TrendPoint[]` as a prop rather than calling `getSpendCplTrend`, and have `app/(admin)/page.tsx` pass `await getSpendCplTrend(scope, 30)` into it. A client component that could name its own tenant is the shape this whole task exists to remove.

`ads-agent/lib/openui/analytics-tools.ts`: every tool handler takes `scope: Scope` as its first parameter and threads it into `getOverviewStats`, `getSpendCplTrend` and `listCampaignsWithLatestCpl`. Add `import type { Scope } from "@/lib/db/scope-sql";`.

- [ ] **Step 6: Typecheck, run the suite, commit**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors.

Run: `cd ads-agent && npx vitest run`
Expected: all green.

```bash
git add ads-agent/lib/db/dashboard.ts ads-agent/lib/db/dashboard.test.ts \
        ads-agent/app ads-agent/components/SpendCplChart.tsx ads-agent/lib/openui/analytics-tools.ts
git commit -m "feat(db): scope the dashboard aggregates

The three overview queries now share one client inside one transaction, so all
three see the same tenant context -- a Promise.all over getPool().query would
have spread them across three connections with the tenant set on one.
SpendCplChart receives loaded data instead of querying, because a client
component must not be able to name its own tenant."
```

## Task 15 (U7): `ai-action-log` → `audit-log`

**Skills:** `refactoring-specialist`, `gdpr-dsgvo-expert`
**Model:** `inherit` — the audit vocabulary and the actor-presence constraint are design decisions with compliance consequences.

**Files:**
- Delete: `ads-agent/lib/db/ai-action-log.ts`, `ads-agent/lib/db/ai-action-log.test.ts`
- Create: `ads-agent/lib/db/audit-log.ts`, `ads-agent/lib/db/audit-log.test.ts`
- Create: `ads-agent/lib/db/migrations/013_audit_log.up.sql` / `.down.sql`
- Modify: `ads-agent/app/(admin)/page.tsx`
- Modify: `ads-agent/app/api/crm/opportunities/[id]/stage/route.ts`
- Modify: `ads-agent/lib/decision-engine/cycle.ts`, `ads-agent/lib/openui/crm-tools.ts`

**Interfaces:**
- Consumes: `Scope`, `scopeClause`, `withTenantTransaction` from Task 9; `scopeForSession`/`scopeForJob` from `lib/auth/scope-interim.ts`.
- Produces:
  - `type AuditActorType = "human" | "agent" | "system"`
  - `type AuditEntry = { id: string; actorType: AuditActorType; actorUserId: string | null; action: string; entityType: string; entityId: string | null; createdAt: string }`
  - `writeAudit(scope: Scope, input: { actorType: AuditActorType; actorUserId?: string | null; action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown }): Promise<void>`
  - `listAudit(scope: Scope, limit: number): Promise<AuditEntry[]>`
  - `countAuditToday(scope: Scope): Promise<number>`

**Context.** `ai_action_log` has three columns, no `org_id`, and a `domain` CHECK of `('marketing','crm')` — it cannot record who acted, which is the whole point of an audit trail. `audit_log` replaces it with the actor-presence constraint that is the table's reason to exist: a human action **cannot** be recorded without naming the human (tenancy spec §2e). `ai_action_log` is retained in place, unread, and dropped in a later cleanup once `audit_log` is proven, keeping this reversible.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/db/audit-log.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { countAuditToday, listAudit, writeAudit } from "./audit-log";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("writeAudit", () => {
  it("stamps org_id and records the actor", async () => {
    query.mockResolvedValue({ rows: [] });
    await writeAudit(ORG, {
      actorType: "human",
      actorUserId: "user-1",
      action: "proposal.approved",
      entityType: "proposal",
      entityId: "prop-1",
      after: { status: "approved" },
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.audit_log");
    expect(params[0]).toBe(ORG.orgId);
    expect(params[1]).toBe("human");
    expect(params[2]).toBe("user-1");
    expect(params[3]).toBe("proposal.approved");
  });

  it("refuses a human action with no actor before touching the database", async () => {
    await expect(
      writeAudit(ORG, { actorType: "human", action: "proposal.approved", entityType: "proposal" }),
    ).rejects.toThrow("a human audit entry requires actorUserId");
    expect(query).not.toHaveBeenCalled();
  });

  it("allows an agent action with no actor user", async () => {
    query.mockResolvedValue({ rows: [] });
    await writeAudit(ORG, { actorType: "agent", action: "cycle.run", entityType: "cycle" });
    expect(query.mock.calls[0][1][2]).toBeNull();
  });
});

describe("listAudit", () => {
  it("scopes the listing and passes the limit as $2", async () => {
    query.mockResolvedValue({ rows: [] });
    await listAudit(ORG, 10);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual([ORG.orgId, 10]);
  });
});

describe("countAuditToday", () => {
  it("scopes the count", async () => {
    query.mockResolvedValue({ rows: [{ count: "4" }] });
    await expect(countAuditToday(ORG)).resolves.toBe(4);
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/audit-log.test.ts`
Expected: FAIL — `Cannot find module './audit-log'`.

- [ ] **Step 3: Write migration 013**

Create `ads-agent/lib/db/migrations/013_audit_log.up.sql`:

```sql
-- Replaces ai_action_log, which had three columns, no org_id, and no way to
-- record who acted. ai_action_log is retained in place and unread; it is
-- dropped in a later cleanup once this table is proven, which keeps this
-- migration reversible.
CREATE TABLE IF NOT EXISTS adsagent.audit_log (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('human','agent','system')),
  actor_user_id UUID REFERENCES public.users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  before        JSONB,
  after         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The point of the table: a human action cannot be recorded without naming
-- the human.
ALTER TABLE adsagent.audit_log DROP CONSTRAINT IF EXISTS audit_actor_present;
ALTER TABLE adsagent.audit_log ADD CONSTRAINT audit_actor_present
  CHECK (actor_type <> 'human' OR actor_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS audit_log_org_time_idx
  ON adsagent.audit_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_org_entity_idx
  ON adsagent.audit_log (org_id, entity_type, entity_id);

ALTER TABLE adsagent.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.audit_log FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.audit_log;
CREATE POLICY tenant_isolation ON adsagent.audit_log
  USING      (org_id = public.current_tenant() OR public.is_platform_read())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT ON adsagent.audit_log TO adsagent_rw;
GRANT SELECT ON adsagent.audit_log TO agent_ro;
-- Append-only by grant as well as by convention: no UPDATE, no DELETE.
```

Create `ads-agent/lib/db/migrations/013_audit_log.down.sql`:

```sql
DROP POLICY IF EXISTS tenant_isolation ON adsagent.audit_log;
DROP TABLE IF EXISTS adsagent.audit_log;
```

- [ ] **Step 4: Implement `audit-log.ts`**

Create `ads-agent/lib/db/audit-log.ts`:

```ts
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type AuditActorType = "human" | "agent" | "system";

export type AuditEntry = {
  id: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

type AuditRow = {
  id: string;
  actor_type: AuditActorType;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: Date;
};

/**
 * Action vocabulary, extensible: proposal.created, proposal.approved,
 * proposal.rejected, proposal.canceled, proposal.reopened, proposal.executed,
 * proposal.failed, proposal.edited, draft.created, draft.converted,
 * member.role_changed, member.removed, credits.granted, settings.changed,
 * cycle.run, opportunity.stage_changed.
 */
export async function writeAudit(
  scope: Scope,
  input: {
    actorType: AuditActorType;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  // Mirrors the audit_actor_present constraint so the caller gets a useful
  // error rather than a constraint violation from three layers down.
  if (input.actorType === "human" && !input.actorUserId) {
    throw new Error("a human audit entry requires actorUserId");
  }
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.audit_log
         (org_id, actor_type, actor_user_id, action, entity_type, entity_id, before, after)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        ...s.params,
        input.actorType,
        input.actorUserId ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
      ],
    ),
  );
}

export async function listAudit(scope: Scope, limit: number): Promise<AuditEntry[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<AuditRow>(
      `SELECT id, actor_type, actor_user_id, action, entity_type, entity_id, created_at
         FROM adsagent.audit_log
        WHERE ${s.sql}
        ORDER BY created_at DESC
        LIMIT $2`,
      [...s.params, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: row.created_at.toISOString(),
    }));
  });
}

export async function countAuditToday(scope: Scope): Promise<number> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM adsagent.audit_log
        WHERE ${s.sql} AND created_at >= date_trunc('day', now())`,
      [...s.params],
    );
    return Number(rows[0].count);
  });
}
```

Remove the old module:

```bash
git rm ads-agent/lib/db/ai-action-log.ts ads-agent/lib/db/ai-action-log.test.ts
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/db/audit-log.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Update the four call sites**

`ads-agent/lib/decision-engine/cycle.ts`: replace `logAiAction({ domain: "marketing", summary })` with

```ts
await writeAudit(scope, {
  actorType: "agent",
  action: "cycle.run",
  entityType: "cycle",
  after: { proposalsCreated: created.length, summary },
});
```

and change the import to `import { writeAudit } from "@/lib/db/audit-log";`.

`ads-agent/app/api/crm/opportunities/[id]/stage/route.ts`: replace `logAiAction({ domain: "crm", summary })` with

```ts
await writeAudit(scope, {
  actorType: "human",
  actorUserId: access.session.userId,
  action: "opportunity.stage_changed",
  entityType: "opportunity",
  before: { stage: previousStage },
  after: { stage: nextStage },
});
```

`entityId` is deliberately omitted: it is a `UUID` column and a Twenty opportunity id is a `TEXT` identifier from another system. Recording it in `after` keeps the trail without lying about the type.

`ads-agent/lib/openui/crm-tools.ts`: each tool handler takes `scope: Scope` as its first parameter and calls `writeAudit(scope, { actorType: "agent", action: ..., entityType: ... })` where it previously called `logAiAction`.

`ads-agent/app/(admin)/page.tsx`: replace `countAiActionsToday()` with `countAuditToday(scope)` and `listRecentAiActions(limit)` with `listAudit(scope, limit)`. The rendered tile displayed `domain` and `summary`; render `actorType` and `action` instead, which is strictly more information.

- [ ] **Step 7: Typecheck, apply, run the suite, commit**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors.

Run: `cd ads-agent && npx tsx lib/db/migrate.ts`
Expected stdout: `ads-agent: applied 1 migration(s): 013_audit_log`

Verify the constraint actually refuses an anonymous human action:

```bash
psql "$DATABASE_URL" -c "
BEGIN;
SELECT public.set_tenant('00000000-0000-0000-0000-000000000001');
INSERT INTO adsagent.audit_log (org_id, actor_type, action, entity_type)
VALUES ('00000000-0000-0000-0000-000000000001', 'human', 'proposal.approved', 'proposal');
ROLLBACK;"
```

Expected: `ERROR:  new row for relation "audit_log" violates check constraint "audit_actor_present"`.

Run: `cd ads-agent && npx vitest run`
Expected: all green.

```bash
git add ads-agent/lib/db/audit-log.ts ads-agent/lib/db/audit-log.test.ts \
        ads-agent/lib/db/migrations/ ads-agent/app ads-agent/lib/decision-engine \
        ads-agent/lib/openui/crm-tools.ts
git rm ads-agent/lib/db/ai-action-log.ts ads-agent/lib/db/ai-action-log.test.ts
git commit -m "feat(db): replace ai_action_log with a tenant-scoped audit_log

ai_action_log had three columns, no org_id, and no way to record who acted.
audit_log carries the actor-presence constraint that is the table's reason to
exist: a human action cannot be recorded without naming the human. Granted
SELECT and INSERT only, so it is append-only by privilege as well as by
convention. ai_action_log is retained unread for reversibility."
```

## Task 16 (U8): the interim Twenty platform-only guard

**Skills:** `senior-backend`, `security-auditor`
**Model:** `inherit` — nine consumers, two apps, and a containment boundary whose failure mode is a silent leak.

**Files:**
- Modify: `ads-agent/lib/crm/twenty-pipeline.ts`, `ads-agent/lib/crm/twenty-pipeline.test.ts`
- Modify: `ads-agent/lib/connectors/twenty.ts`
- Modify: `ads-agent/lib/bifrost/twenty-mcp-tools.ts`, `ads-agent/lib/bifrost/mcp-client.ts`
- Modify: `ads-agent/app/(admin)/page.tsx`, `ads-agent/app/(admin)/crm/page.tsx`
- Modify: `ads-agent/app/api/crm/opportunities/[id]/stage/route.ts`
- Modify: `ads-agent/lib/openui/crm-tools.ts`, `ads-agent/lib/openui/opportunity-openui-lang.ts`, `ads-agent/lib/openui/resolve-tools-then-generate.ts`
- Modify: `ads-agent/lib/decision-engine/cycle.ts`
- Modify: `lib/crm/twenty.ts` (root listings app), `app/api/leads/route.ts` (root listings app)
- Create: `ads-agent/lib/crm/twenty-guard.test.ts`

**Interfaces:**
- Consumes: `Scope` from Task 9.
- Produces, in `ads-agent/lib/crm/twenty-pipeline.ts`:
  - `assertPlatformScope(scope: Scope, fn: string): void` — throws for non-platform callers
  - `listOpportunities(scope: Scope): Promise<Opportunity[]>`
  - `getOpportunity(scope: Scope, id: string): Promise<Opportunity | null>`
  - `updateOpportunityStage(scope: Scope, id: string, stage: PipelineStageValue): Promise<UpdateStageResult>`
  - `getPipelineValue(scope: Scope): Promise<number>`
  - In `ads-agent/lib/connectors/twenty.ts`: `fetchLeadSignal(scope: Scope): Promise<LeadSignal>`
  - In root `lib/crm/twenty.ts`: `type TwentyCaller = "platform"` and `createLeadInTwenty(caller: TwentyCaller, input: ...)`

**Context.** Q4 is answered: Twenty is **one shared pipeline today**, not partitioned by org, so no scoping in this repository can make that data tenant-safe. Twenty's deduplication actively **merges** contacts across tenant lines, which is contamination that cannot be reversed — this is why the shared instance is never migrated. Containment therefore belongs **in the client, not the routes**: every exported function refuses non-platform callers, so a new call site inherits the block instead of having to remember it. **It throws rather than returning empty**, because an empty pipeline is indistinguishable from a quiet leak in the surfaces that render it.

This guard is **interim**. The end state is one Twenty instance per org (`2026-08-12-twenty-tenancy-ownership-design.md`, TW1), landing at S4. The guard is removed only once every org has its own instance.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/crm/twenty-guard.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const callTwentyTool = vi.fn();
vi.mock("../bifrost/mcp-client", () => ({
  callTwentyTool,
  TWENTY_MCP_TOOLS: {
    listOpportunities: "list_opportunities",
    getOpportunity: "get_opportunity",
    updateOpportunity: "update_opportunity",
  },
}));

import type { Scope } from "../db/scope-sql";
import {
  assertPlatformScope,
  getOpportunity,
  getPipelineValue,
  listOpportunities,
  updateOpportunityStage,
} from "./twenty-pipeline";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

beforeEach(() => callTwentyTool.mockReset());

describe("assertPlatformScope", () => {
  it("names the function it is protecting in the error", () => {
    expect(() => assertPlatformScope(ORG, "listOpportunities")).toThrow(
      /listOpportunities is platform-only/,
    );
  });

  it("permits platform scope", () => {
    expect(() => assertPlatformScope(PLATFORM, "listOpportunities")).not.toThrow();
  });
});

describe("every Twenty read and write refuses org scope", () => {
  it("listOpportunities throws rather than returning an empty array", async () => {
    await expect(listOpportunities(ORG)).rejects.toThrow("platform-only");
    expect(callTwentyTool, "must not reach Twenty at all").not.toHaveBeenCalled();
  });

  it("getOpportunity throws rather than returning null", async () => {
    await expect(getOpportunity(ORG, "opp-1")).rejects.toThrow("platform-only");
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("updateOpportunityStage throws rather than returning { ok: false }", async () => {
    await expect(updateOpportunityStage(ORG, "opp-1", "NEW")).rejects.toThrow("platform-only");
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("getPipelineValue throws rather than returning 0", async () => {
    await expect(getPipelineValue(ORG)).rejects.toThrow("platform-only");
    expect(callTwentyTool).not.toHaveBeenCalled();
  });
});

describe("platform callers still get data", () => {
  it("listOpportunities reaches Twenty under platform scope", async () => {
    callTwentyTool.mockResolvedValue([]);
    await expect(listOpportunities(PLATFORM)).resolves.toEqual([]);
    expect(callTwentyTool).toHaveBeenCalledTimes(1);
  });
});
```

The four "throws rather than returning X" cases each name the fail-soft value the function returns today. That is deliberate: fail-soft is correct for an outage and wrong for a tenancy boundary, and the test records which is which.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-guard.test.ts`
Expected: FAIL — `assertPlatformScope` is not exported, and the four functions take no scope.

- [ ] **Step 3: Add the guard and convert the four functions**

Add to `ads-agent/lib/crm/twenty-pipeline.ts`, after the existing imports:

```ts
import type { Scope } from "../db/scope-sql";

/**
 * INTERIM CONTAINMENT — remove at S4, not before.
 *
 * Twenty is one shared pipeline today: it is not partitioned by org, so no
 * scoping in this repository can make that data tenant-safe (tenancy spec, Q4
 * resolution). Worse, Twenty's deduplication actively merges contacts across
 * tenant lines in a shared instance, so this is contamination rather than only
 * a read exposure -- which is why the shared instance is never migrated.
 *
 * Containment lives here, in the client, rather than in the routes, so a new
 * call site inherits the block instead of having to remember it. That is what
 * makes it survive the next feature.
 *
 * It throws rather than returning empty: an empty pipeline is
 * indistinguishable from a quiet leak in the surfaces that render it.
 *
 * The end state is one Twenty instance per org
 * (2026-08-12-twenty-tenancy-ownership-design.md, TW1). This guard is removed
 * only once every org has its own.
 */
export function assertPlatformScope(scope: Scope, fn: string): void {
  if (scope.kind !== "platform") {
    throw new Error(
      `${fn} is platform-only: Twenty is one shared pipeline and is not tenant-safe. ` +
        `Removed at S4, once every org has its own instance.`,
    );
  }
}
```

Replace lines 169–214 (the four exported data functions) with:

```ts
/** List every open opportunity, via the Twenty MCP server. Platform-only. */
export async function listOpportunities(scope: Scope): Promise<Opportunity[]> {
  assertPlatformScope(scope, "listOpportunities");
  if (!isConfigured()) return [];
  try {
    const result = await callTwentyTool(TWENTY_MCP_TOOLS.listOpportunities, { limit: 200 });
    return extractRawOpportunities(result).map(toOpportunity);
  } catch {
    // Fail soft on an outage -- but never on a tenancy check, which is why the
    // assert is above the try and not inside it.
    return [];
  }
}

/** Fetch a single opportunity by id via the Twenty MCP server. Platform-only. */
export async function getOpportunity(scope: Scope, id: string): Promise<Opportunity | null> {
  assertPlatformScope(scope, "getOpportunity");
  if (!isConfigured()) return null;
  try {
    const [record] = extractRawOpportunities(
      await callTwentyTool(TWENTY_MCP_TOOLS.getOpportunity, { id }),
    );
    return record ? toOpportunity(record) : null;
  } catch {
    return null;
  }
}

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

/** Advance (or move back) an opportunity's stage. Platform-only. */
export async function updateOpportunityStage(
  scope: Scope,
  id: string,
  stage: PipelineStageValue,
): Promise<UpdateStageResult> {
  assertPlatformScope(scope, "updateOpportunityStage");
  if (!isConfigured()) return { ok: false, error: "Twenty is not configured" };
  try {
    await callTwentyTool(TWENTY_MCP_TOOLS.updateOpportunity, { id, stage });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sum of amountInr across every opportunity. Backs Home's Pipeline Value stat. Platform-only. */
export async function getPipelineValue(scope: Scope): Promise<number> {
  assertPlatformScope(scope, "getPipelineValue");
  const opportunities = await listOpportunities(scope);
  return opportunities.reduce((sum, o) => sum + (o.amountInr ?? 0), 0);
}
```

- [ ] **Step 4: Guard the connector and the MCP tool surface**

In `ads-agent/lib/connectors/twenty.ts`, change `fetchLeadSignal` to take a scope first and assert:

```ts
import type { Scope } from "../db/scope-sql";
import { assertPlatformScope } from "../crm/twenty-pipeline";

export async function fetchLeadSignal(scope: Scope): Promise<LeadSignal> {
  assertPlatformScope(scope, "fetchLeadSignal");
  // ... existing body unchanged from the apiKey lookup onward ...
}
```

In `ads-agent/lib/bifrost/twenty-mcp-tools.ts`, gate the tool list on scope so the Twenty tools are absent from any agent profile serving a broker tenant rather than present-and-failing:

```ts
import type { Scope } from "../db/scope-sql";

/**
 * Twenty MCP tools are removed from a non-platform agent profile entirely.
 * A tool that exists and throws still tells the model the data is there.
 */
export function twentyMcpTools(scope: Scope) {
  if (scope.kind !== "platform") return [];
  return TWENTY_TOOL_DEFINITIONS;
}
```

Rename the existing exported constant to `TWENTY_TOOL_DEFINITIONS` and export `twentyMcpTools` in its place, updating `ads-agent/lib/bifrost/mcp-client.ts` to call `twentyMcpTools(scope)` where it previously spread the constant.

- [ ] **Step 5: Update the nine ads-agent consumers**

| File | Change |
|---|---|
| `app/(admin)/page.tsx` | wrap the Pipeline Value tile and lead-signal tile in `scope.kind === "platform"` and pass `scope` into `getPipelineValue` / `fetchLeadSignal`; render nothing for an org-scoped viewer |
| `app/(admin)/crm/page.tsx` | `if (scope.kind !== "platform") notFound();` as the first statement, then pass `scope` into `listOpportunities` |
| `app/api/crm/opportunities/[id]/stage/route.ts` | after the role check, `if (scope.kind !== "platform") return NextResponse.json({ error: "not found" }, { status: 404 });` then `updateOpportunityStage(scope, id, stage)` |
| `lib/openui/crm-tools.ts` | every tool handler takes `scope: Scope` first and threads it into `listOpportunities`, `getOpportunity`, `updateOpportunityStage` |
| `lib/openui/opportunity-openui-lang.ts` | takes `scope: Scope` first and threads it into `getOpportunity` |
| `lib/openui/resolve-tools-then-generate.ts` | takes `scope: Scope` first and threads it into the crm tool handlers |
| `lib/bifrost/mcp-client.ts` | `twentyMcpTools(scope)` instead of the raw constant |
| `lib/decision-engine/cycle.ts` | the cycle runs under org scope, so it must no longer read Twenty at all: delete the `fetchLeadSignal` call and the CRM-signal branch that consumed it, and record `recordCrmSignalSnapshot(scope, { campaignId: null, hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 })` only when `scope.kind === "platform"`, passing `scope` into `fetchLeadSignal` there |
| `lib/crm/twenty-pipeline.test.ts` | every existing call gains the platform scope as its first argument |

The `cycle.ts` change is the one with product consequence and it is deliberate: an autonomous decision cycle running for a broker tenant currently reads a shared pipeline containing other tenants' opportunities, and acts on it with nobody watching. Under this guard it stops doing that. The CRM signal returns for that tenant at S4, from its own Twenty instance.

- [ ] **Step 6: Guard the root listings app's write path**

The root app has no `Scope` type and no shared package with `ads-agent` — the same intentional duplication as the `AUTH_ISSUER` literal. Rather than duplicating `Scope`, `createLeadInTwenty` takes a single-member union, so a future non-platform call site is a compile error.

In `lib/crm/twenty.ts`, add above `createLeadInTwenty`:

```ts
/**
 * Twenty is one shared pipeline today, so only the platform may write to it.
 * A single-member union rather than a boolean: adding a second caller kind is
 * then a deliberate type change reviewed on its own, not a flag flipped.
 * Removed at S4, once every org has its own Twenty instance
 * (2026-08-12-twenty-tenancy-ownership-design.md).
 */
export type TwentyCaller = "platform";
```

and change its signature (currently `createLeadInTwenty(payload: LeadPayload, qualification: LeadQualification)` at line 89) to:

```ts
export async function createLeadInTwenty(
  caller: TwentyCaller,
  payload: LeadPayload,
  qualification: LeadQualification,
): Promise<TwentyCreateLeadResult> {
  if (caller !== "platform") {
    throw new Error("createLeadInTwenty is platform-only: Twenty is one shared pipeline");
  }
  if (!isTwentyConfigured()) return { status: "skipped" };
  // ... existing body unchanged from `const { firstName, lastName }` onward ...
```

In `app/api/leads/route.ts`, change the call to `createLeadInTwenty("platform", payload, qualification)`. This is correct rather than a loophole: the marketing site's leads are Gentle Space's own, and Gentle Space is itself a tenant whose org is `internal` (TW7).

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/crm/`
Expected: PASS, including the 7 new guard tests.

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors.

Run: `cd ads-agent && npx vitest run`
Expected: all green.

Run: `cd /Users/swami/Documents/GentleSpace_Web && npx tsc --noEmit && npx vitest run`
Expected: zero errors, all green.

- [ ] **Step 8: Commit**

```bash
git add ads-agent/lib/crm/ ads-agent/lib/connectors/twenty.ts ads-agent/lib/bifrost/ \
        ads-agent/lib/openui/ ads-agent/lib/decision-engine/ ads-agent/app \
        lib/crm/twenty.ts app/api/leads/route.ts
git commit -m "feat(crm): interim platform-only guard on every Twenty path

Q4 is answered: Twenty is one shared pipeline today and its dedup merges
contacts across tenant lines, so the contamination is irreversible and the
instance is never migrated. Containment lives in the client, not the routes, so
a new call site inherits the block. It throws rather than returning empty --
an empty pipeline is indistinguishable from a quiet leak in the surfaces that
render it. The Twenty MCP tools are absent from a non-platform agent profile
rather than present-and-failing, and the decision cycle no longer reads Twenty
under org scope. Removed at S4."
```

---

## S3-C: API layer, session hardening, and the release gate

## Task 17 (fan-in): API layer and session hardening

**Skills:** `api-designer`, `senior-backend`, `security-auditor`
**Model:** `inherit` — merging seven branches and deciding per-route ownership loaders.

**Files:**
- Create: `ads-agent/lib/auth/scope.ts`, `ads-agent/lib/auth/scope.test.ts`
- Create: `ads-agent/lib/auth/guard.ts`, `ads-agent/lib/auth/guard.test.ts`
- Delete: `ads-agent/lib/auth/scope-interim.ts`
- Modify: all 18 files under `ads-agent/app/api/**/route.ts`
- Modify: `ads-agent/lib/auth/dal.ts`, `ads-agent/app/(admin)/layout.tsx`, `ads-agent/components/CommandPalette.tsx`
- Modify: `ads-agent/app/api/route-auth.test.ts`

**Interfaces:**
- Consumes: every S3-B branch.
- Produces:
  - `scopeFor(session: Session, orgKind: "internal" | "external"): Scope`
  - `guard(min: MemberRole): Promise<{ ok: true; session: Session; scope: Scope } | { ok: false; response: NextResponse }>`
  - `ownedOr404<T>(loader: (scope: Scope) => Promise<T | null>, scope: Scope): Promise<{ ok: true; entity: T } | { ok: false; response: NextResponse }>`

**Context.** Two guarantees on every mutation route: the caller is authorised, and the caller owns the entity. Error semantics: unauthenticated → `401`; authenticated but insufficient role → `403`; authenticated, sufficient role, wrong tenant → **`404`**. A 403 for a cross-tenant hit confirms the UUID exists and leaks the shape of other customers' data. `Session.orgId` is typed `string | null`, which is why `credits/page.tsx` needed a non-null assertion; `requireSession()` already renders a pending-approval card when `role` is null, and the same gate now covers a null `orgId`.

- [ ] **Step 1: Merge the seven S3-B branches**

```bash
git checkout main
git merge --no-ff s3b/u1-proposals-drafts
git merge --no-ff s3b/u2-settings
git merge --no-ff s3b/u6-credits
git merge --no-ff s3b/u3-campaigns-snapshots
git merge --no-ff s3b/u4-dashboard
git merge --no-ff s3b/u7-audit-log
git merge --no-ff s3b/u8-twenty-guard
```

Expected conflicts, all anticipated by the wave table:
- `lib/decision-engine/cycle.ts` — U1 added `scope` as the first parameter and threaded proposals calls; U3 threaded campaigns and snapshots calls; U7 replaced `logAiAction` with `writeAudit`; U8 removed the Twenty read. The resolved function signature is `runDecisionCycle(scope: Scope)` and all four sets of body changes apply.
- `lib/executor/execute.ts` — U1 and U3 both added `scope` as the first parameter of `executeProposal`. Keep one.
- `app/(admin)/page.tsx` — U4, U7 and U8 each changed a different tile. All three apply.
- `lib/openui/analytics-tools.ts` — U1 and U4 both added `scope` to the same handlers. Keep one parameter, both bodies.
- `lib/openui/crm-tools.ts` — U7 and U8 both added `scope`. Keep one parameter, both bodies.
- `app/api/crm/opportunities/[id]/stage/route.ts` — U7 added the audit write, U8 added the platform check. Both apply, platform check first.
- `lib/auth/scope-interim.ts` — created identically by several branches; identical content merges cleanly.

Run: `cd ads-agent && npx tsc --noEmit && npx vitest run`
Expected: zero errors, all green, before writing any new code.

- [ ] **Step 2: Write the failing `scopeFor` test**

Create `ads-agent/lib/auth/scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scopeFor } from "./scope";
import type { Session } from "./dal";

const session: Session = {
  userId: "u1",
  email: "a@b.com",
  orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  role: "admin",
};

describe("scopeFor", () => {
  it("gives an internal org platform scope", () => {
    expect(scopeFor(session, "internal")).toEqual({ kind: "platform", orgId: session.orgId });
  });

  it("hard-bounds an external org to itself", () => {
    expect(scopeFor(session, "external")).toEqual({ kind: "org", orgId: session.orgId });
  });

  it("refuses a session with no org rather than defaulting one", () => {
    expect(() => scopeFor({ ...session, orgId: null }, "external")).toThrow(
      "session has no orgId",
    );
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/auth/scope.test.ts`
Expected: FAIL — `Cannot find module './scope'`.

- [ ] **Step 4: Implement `scope.ts`**

Create `ads-agent/lib/auth/scope.ts`:

```ts
import type { Scope } from "@/lib/db/scope-sql";
import type { Session } from "./dal";

/**
 * Two scopes, derived from the existing orgs.kind column -- no new column, no
 * new concept. orgs.kind already carries CHECK (kind IN ('internal','external'))
 * and the seed row is 'internal', so existing staff keep working through the
 * migration with no data change.
 */
export function scopeFor(session: Session, orgKind: "internal" | "external"): Scope {
  if (!session.orgId) throw new Error("session has no orgId");
  return orgKind === "internal"
    ? { kind: "platform", orgId: session.orgId }
    : { kind: "org", orgId: session.orgId };
}
```

- [ ] **Step 5: Write the failing `guard` and `ownedOr404` test**

Create `ads-agent/lib/auth/guard.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiRole = vi.fn();
const query = vi.fn();
vi.mock("./dal", () => ({ requireApiRole }));
vi.mock("@/lib/db/client", () => ({ getPool: () => ({ query }) }));

import { guard, ownedOr404 } from "./guard";
import type { Scope } from "@/lib/db/scope-sql";

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const session = { userId: "u1", email: "a@b.com", orgId: ORG_ID, role: "admin" as const };

beforeEach(() => {
  requireApiRole.mockReset();
  query.mockReset();
});

describe("guard", () => {
  it("passes the role check failure straight through", async () => {
    const response = new Response(null, { status: 403 });
    requireApiRole.mockResolvedValue({ ok: false, response });
    const result = await guard("admin");
    expect(result).toEqual({ ok: false, response });
  });

  it("returns platform scope for an internal org", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session });
    query.mockResolvedValue({ rows: [{ kind: "internal" }] });
    const result = await guard("viewer");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scope).toEqual({ kind: "platform", orgId: ORG_ID });
  });

  it("returns org scope for an external org", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session });
    query.mockResolvedValue({ rows: [{ kind: "external" }] });
    const result = await guard("viewer");
    if (result.ok) expect(result.scope).toEqual({ kind: "org", orgId: ORG_ID });
  });

  it("returns 403 rather than throwing when the session has no org", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { ...session, orgId: null } });
    const result = await guard("viewer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("treats an unknown org as external — fail closed", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session });
    query.mockResolvedValue({ rows: [] });
    const result = await guard("viewer");
    if (result.ok) expect(result.scope.kind).toBe("org");
  });
});

describe("ownedOr404", () => {
  const scope: Scope = { kind: "org", orgId: ORG_ID };

  it("returns the entity when the loader finds it in scope", async () => {
    const result = await ownedOr404(async () => ({ id: "x" }), scope);
    expect(result).toEqual({ ok: true, entity: { id: "x" } });
  });

  it("returns 404 and never 403 for a miss", async () => {
    const result = await ownedOr404(async () => null, scope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status, "403 would confirm the row exists").toBe(404);
      await expect(result.response.json()).resolves.toEqual({ error: "not found" });
    }
  });

  it("passes the scope to the loader", async () => {
    const loader = vi.fn().mockResolvedValue({ id: "x" });
    await ownedOr404(loader, scope);
    expect(loader).toHaveBeenCalledWith(scope);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/auth/guard.test.ts`
Expected: FAIL — `Cannot find module './guard'`.

- [ ] **Step 7: Implement `guard.ts`**

Create `ads-agent/lib/auth/guard.ts`:

```ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/client";
import type { Scope } from "@/lib/db/scope-sql";
import { requireApiRole, type MemberRole, type Session } from "./dal";
import { scopeFor } from "./scope";

export type GuardResult =
  | { ok: true; session: Session; scope: Scope }
  | { ok: false; response: NextResponse };

/**
 * Role check plus server-derived scope. The caller never names its own tenant.
 *
 * An org whose kind cannot be read is treated as external, which is the
 * fail-closed reading: the cost of a mistake is a platform user seeing only
 * their own org, not a customer seeing everyone's.
 */
export async function guard(min: MemberRole): Promise<GuardResult> {
  const access = await requireApiRole(min);
  if (!access.ok) return { ok: false, response: access.response };

  if (!access.session.orgId) {
    // Authenticated, but not yet attached to an org. Not a 401 -- the session
    // is valid -- and not a 404, because there is no entity involved.
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const { rows } = await getPool().query<{ kind: "internal" | "external" }>(
    `SELECT kind FROM public.orgs WHERE id = $1`,
    [access.session.orgId],
  );
  const orgKind = rows[0]?.kind ?? "external";
  return { ok: true, session: access.session, scope: scopeFor(access.session, orgKind) };
}

/**
 * Loads an entity under scope. A miss returns 404 -- never 403 -- so the
 * response cannot be used to probe whether another tenant's UUID exists.
 */
export async function ownedOr404<T>(
  loader: (scope: Scope) => Promise<T | null>,
  scope: Scope,
): Promise<{ ok: true; entity: T } | { ok: false; response: NextResponse }> {
  const entity = await loader(scope);
  if (!entity) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not found" }, { status: 404 }),
    };
  }
  return { ok: true, entity };
}
```

- [ ] **Step 8: Run both tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/auth/`
Expected: PASS — 3 scope tests, 8 guard tests, plus the existing dal tests.

- [ ] **Step 9: Convert all 18 routes from `requireApiRole` + `scopeForSession` to `guard`**

The substitution in every route is the same two lines. Replace:

```ts
  const access = await requireApiRole("<role>");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
```

with:

```ts
  const access = await guard("<role>");
  if (!access.ok) return access.response;
  const { scope } = access;
```

and replace the `requireApiRole` / `scopeForSession` imports with `import { guard } from "@/lib/auth/guard";`.

The complete role and ownership table for all 18 routes:

| Route | Method | Role | Ownership loader |
|---|---|---|---|
| `auth/accept` | POST | none — pre-session by design | — |
| `auth/signout` | POST | none — clearing a cookie needs no role | — |
| `campaign-drafts/[id]` | PATCH | `operator` | `ownedOr404((s) => getDraftById(s, id), scope)` |
| `campaign-drafts/[id]/messages` | GET, POST | `operator` | `ownedOr404((s) => getDraftById(s, id), scope)` |
| `campaign-drafts/[id]/create-proposal` | POST | `operator` | `ownedOr404((s) => getDraftById(s, id), scope)` |
| `campaigns/[id]/status` | PATCH | `operator` | `ownedOr404((s) => getCampaignById(s, id), scope)` |
| `copilot/chat` | POST | `operator` | — no entity id in the request |
| `credits/grant` | POST | `admin` | — writes the caller's own org |
| `crm/chat` | POST | `operator` | — platform-only via the Twenty guard |
| `crm/opportunities/[id]/stage` | PATCH | `operator` | platform check, then the Twenty guard |
| `cycle/run` | POST | `admin` | — scope-bounded, runs only the caller's org |
| `hermes/chat` | POST | `operator` | — |
| `openui/tools` | POST | `operator` | — |
| `proposals/[id]` | PATCH | `operator` | `ownedOr404((s) => getProposalById(s, id), scope)` |
| `proposals/[id]/approve` | POST | `operator` | `ownedOr404((s) => getProposalById(s, id), scope)` |
| `proposals/[id]/reject` | POST | `operator` | `ownedOr404((s) => getProposalById(s, id), scope)` |
| `reports/chat` | POST | `operator` | — |
| `settings` | GET `viewer`, PATCH `admin` | — | writes only the caller's `org_cron_settings` row |

`ads-agent/app/api/proposals/[id]/approve/route.ts` in its final form is exactly:

```ts
import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { decideProposal, getProposalById } from "@/lib/db/proposals";
import { executeProposal } from "@/lib/executor/execute";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getProposalById(s, id), scope);
  if (!owned.ok) return owned.response;
  if (owned.entity.status !== "pending") {
    return NextResponse.json(
      { error: `proposal is ${owned.entity.status}, not pending` },
      { status: 409 },
    );
  }

  await decideProposal(scope, id, "approved", access.session.userId, "ui");
  const result = await executeProposal(scope, id);
  return NextResponse.json({ ok: true, result });
}
```

`ads-agent/app/api/proposals/[id]/reject/route.ts` in its final form is exactly:

```ts
import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { decideProposal, getProposalById } from "@/lib/db/proposals";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getProposalById(s, id), scope);
  if (!owned.ok) return owned.response;
  if (owned.entity.status !== "pending") {
    return NextResponse.json(
      { error: `proposal is ${owned.entity.status}, not pending` },
      { status: 409 },
    );
  }

  await decideProposal(scope, id, "rejected", access.session.userId, "ui");
  return NextResponse.json({ ok: true });
}
```

`ads-agent/app/api/settings/route.ts` in its final form is exactly:

```ts
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getOrgSettings, setCronEnabled } from "@/lib/db/org-settings";

export async function GET() {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  return NextResponse.json(await getOrgSettings(access.scope));
}

export async function PATCH(req: Request) {
  const access = await guard("admin");
  if (!access.ok) return access.response;
  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setCronEnabled(access.scope, body.enabled);
  return NextResponse.json({ ok: true });
}
```

Then delete the interim helper:

```bash
git rm ads-agent/lib/auth/scope-interim.ts
```

and replace its two server-component uses with `scopeFor`. In `app/(admin)/layout.tsx` and every other server component, derive scope once from the session the component already holds:

```ts
import { requireSession } from "@/lib/auth/dal";
import { scopeFor } from "@/lib/auth/scope";
import { getPool } from "@/lib/db/client";

const session = await requireSession();
const { rows } = await getPool().query<{ kind: "internal" | "external" }>(
  `SELECT kind FROM public.orgs WHERE id = $1`,
  [session.orgId],
);
const scope = scopeFor(session, rows[0]?.kind ?? "external");
```

Background jobs (`scripts/run-decision-cycle.ts`, `scripts/run-once.ts`, `mcp/google-ads-server/tools.ts`) replace `scopeForJob(orgId)` with the literal `{ kind: "org" as const, orgId }`, keeping the "never platform" property inline where it is read.

- [ ] **Step 10: Update `route-auth.test.ts` to assert the new guard**

Replace the two `it.each` bodies in `ads-agent/app/api/route-auth.test.ts` so the static check tracks `guard` rather than `requireApiRole`:

```ts
describe("every mutation route is guarded", () => {
  it.each(GUARDED_ROUTES)("%s calls guard", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("await guard(");
  });

  it.each(GUARDED_ROUTES)("%s returns the guard's response on failure", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("if (!access.ok) return access.response;");
  });

  it.each(GUARDED_ROUTES)("%s never returns 403 for a missing entity", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).not.toMatch(/"not found".*403|403.*"not found"/);
  });
});
```

- [ ] **Step 11: Session hardening and the two role-gating UI fixes**

In `ads-agent/lib/auth/dal.ts`, extend `ensureShadowRows` to seed the org's settings row so a newly-onboarded org has defaults from its first request:

```ts
  await getPool().query(
    `INSERT INTO adsagent.org_cron_settings (org_id) VALUES ($1)
     ON CONFLICT (org_id) DO NOTHING`,
    [session.orgId],
  );
```

In `ads-agent/app/(admin)/layout.tsx`, the pending-approval card at lines 19–43 currently triggers on a null `role`. Widen its condition to cover a null `orgId`, which removes the `credits/page.tsx` crash class outright rather than patching one call site:

```ts
  if (!session.role || !session.orgId) {
    return <PendingApprovalCard email={session.email} />;
  }
```

Also at line 78, `RunNowButton` renders for every role including `viewer`. Gate it:

```ts
  {session.role === "admin" ? <RunNowButton /> : null}
```

In `ads-agent/components/CommandPalette.tsx`, the Actions group at lines 68–73 offers "Run decision cycle now" to viewers because it is not role-filtered. Accept the role as a prop from the layout and filter:

```ts
  const actions = role === "admin" ? ADMIN_ACTIONS : [];
```

Both are authorization bugs rather than polish, which is why they are fixed here rather than deferred to the UX epic.

- [ ] **Step 12: Typecheck, run everything, commit**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: zero errors.

Run: `cd ads-agent && npx vitest run`
Expected: all green.

```bash
git add ads-agent/lib/auth/ ads-agent/app ads-agent/components ads-agent/scripts ads-agent/mcp
git rm ads-agent/lib/auth/scope-interim.ts
git commit -m "feat(api): guard + ownedOr404 on every route, and session hardening

guard derives scope server-side so a caller never names its own tenant.
ownedOr404 returns 404 and never 403 for a cross-tenant hit, because a 403
confirms the UUID exists. An org whose kind cannot be read is treated as
external -- fail closed. The pending-approval gate now covers a null orgId,
which removes the non-null-assertion crash class rather than patching one call
site, and RunNowButton and the command palette stop offering the decision cycle
to viewers."
```

## Task 18 (release gate): the cross-tenant isolation suite

**Skills:** `senior-qa`, `security-auditor`, `tdd-guide`
**Model:** `inherit` — this is the verdict on whether S3 ships.

**Files:**
- Create: `ads-agent/lib/db/cross-tenant.test.ts`
- Create: `ads-agent/lib/db/rls-coverage.test.ts`
- Create: `ads-agent/lib/db/fixtures/tenants.ts`

**Interfaces:**
- Consumes: everything from Tasks 9–17.
- Produces: the release gate. Green means S3 passes and D2 lifts.

**Context.** The acceptance test for S3 is the cross-tenant suite run **against a pooled connection**, proving a second request on a reused connection cannot see the first request's tenant. It must be exhaustive over the module inventory rather than a sample: a new scoped function with no corresponding case fails a meta-test comparing exported names against covered names.

- [ ] **Step 1: Write the fixtures**

Create `ads-agent/lib/db/fixtures/tenants.ts`:

```ts
import { getPool } from "../client";

export const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
export const ORG_I = "00000000-0000-0000-0000-000000000001";
export const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
export const USER_B = "bbbbbbbb-0000-0000-0000-000000000001";

/**
 * Two external orgs and the seeded internal one. Rows are created with the
 * tenant context set, so the fixtures themselves exercise WITH CHECK.
 */
export async function seedTenants(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO public.orgs (id, name, kind) VALUES
       ($1, 'Test Org A', 'external'),
       ($2, 'Test Org B', 'external')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `INSERT INTO public.users (id, org_id, email, display_name, role) VALUES
       ($1, $3, 'a@test.local', 'A', 'admin'),
       ($2, $4, 'b@test.local', 'B', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [USER_A, USER_B, ORG_A, ORG_B],
  );
}
```

- [ ] **Step 2: Write the RLS coverage test**

Create `ads-agent/lib/db/rls-coverage.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
let pool: Pool;

beforeAll(() => {
  if (url) pool = new Pool({ connectionString: url, max: 2 });
});
afterAll(async () => {
  if (pool) await pool.end();
});

suite("RLS coverage", () => {
  it("every table carrying org_id has RLS both ENABLEd and FORCEd", async () => {
    // Keyed off the presence of an org_id column rather than a hand-maintained
    // list, so a new tenant table added tomorrow fails this test on the day it
    // lands rather than the day it leaks.
    const { rows } = await pool.query<{ unprotected: string }>(
      `SELECT format('%s.%s', n.nspname, c.relname) AS unprotected
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('adsagent','context','derived')
          AND EXISTS (
                SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
              )
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.unprotected), "these tables are unprotected").toEqual([]);
  });

  it("every policy carries WITH CHECK as well as USING", async () => {
    const { rows } = await pool.query<{ missing: string }>(
      `SELECT format('%s.%s/%s', schemaname, tablename, policyname) AS missing
         FROM pg_policies
        WHERE schemaname IN ('adsagent','context','derived')
          AND with_check IS NULL
        ORDER BY 1`,
    );
    // USING alone stops a tenant reading another's rows but not writing rows
    // carrying another tenant's org_id.
    expect(rows.map((r) => r.missing)).toEqual([]);
  });

  it("no policy compares against current_setting directly", async () => {
    // Everything goes through public.current_tenant(), which is the single
    // helper that no code path bypasses.
    const { rows } = await pool.query<{ policyname: string; qual: string }>(
      `SELECT policyname, qual FROM pg_policies
        WHERE schemaname IN ('adsagent','context','derived')
          AND qual LIKE '%current_setting%'`,
    );
    expect(rows).toEqual([]);
  });

  it("the application role owns no table it can read", async () => {
    // FORCE ROW LEVEL SECURITY covers the owner case, but a non-owning role is
    // the belt to that braces (validation F-20).
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'adsagent' AND c.relkind = 'r' AND r.rolname = 'adsagent_rw'`,
    );
    expect(rows).toEqual([]);
  });

  it("every org_id-carrying table has an index leading with org_id", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT format('%s.%s', n.nspname, c.relname) AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('adsagent','context')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
          AND NOT EXISTS (
                SELECT 1 FROM pg_index i
                 WHERE i.indrelid = c.oid
                   AND (SELECT a.attname FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attnum = i.indkey[0]) = 'org_id'
              )
        ORDER BY 1`,
    );
    // A missing leading-edge tenant index quietly destroys customer-facing
    // query latency at scale.
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and see which tables are unprotected**

```bash
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/rls-coverage.test.ts
```

Expected on the first run: PASS on all five, because Tasks 10–15 applied a policy to every table they gave `org_id`. **If any table is listed, that table is unprotected and S3 has not passed** — add its policy to the owning task's migration rather than removing it from the query.

- [ ] **Step 4: Write the cross-tenant suite**

Create `ads-agent/lib/db/cross-tenant.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getPool } from "./client";
import type { Scope } from "./scope-sql";
import { ORG_A, ORG_B, ORG_I, USER_A, seedTenants } from "./fixtures/tenants";
import { createCampaignRecord, getCampaignById, listCampaigns } from "./campaigns";
import {
  createProposal,
  decideProposal,
  getProposalById,
  listProposals,
  markProposalExecuted,
  markProposalFailed,
  updateProposalPayload,
} from "./proposals";
import {
  appendDraftMessage,
  createDraft,
  getDraftById,
  listDraftMessages,
  markDraftConverted,
  setDraftStatus,
  updateDraftFields,
} from "./campaign-drafts";
import {
  latestCrmSignalSnapshot,
  recentPerformanceSnapshots,
  recordCrmSignalSnapshot,
  recordPerformanceSnapshot,
} from "./snapshots";
import { getOverviewStats, getSpendCplTrend, listCampaignsWithLatestCpl } from "./dashboard";
import { getOrgSettings, setCronEnabled, touchLastRunAt } from "./org-settings";
import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "./credits";
import { countAuditToday, listAudit, writeAudit } from "./audit-log";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const A: Scope = { kind: "org", orgId: ORG_A };
const B: Scope = { kind: "org", orgId: ORG_B };
const PLATFORM: Scope = { kind: "platform", orgId: ORG_I };

let campaignA: string;
let proposalA: string;
let draftA: string;

beforeAll(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  await seedTenants();
  const campaign = await createCampaignRecord(A, {
    platform: "google",
    name: "A's campaign",
    dailyBudget: 700,
    corridor: "HSR",
  });
  campaignA = campaign.id;
  const proposal = await createProposal(A, {
    kind: "pause",
    campaignId: campaignA,
    payload: { campaignId: campaignA },
    triggeredRule: "kill_rule",
  });
  proposalA = proposal.id;
  draftA = (await createDraft(A)).id;
});

afterAll(async () => {
  if (url) await getPool().end();
});

suite("org B cannot read org A's rows", () => {
  it("getCampaignById", async () => {
    await expect(getCampaignById(B, campaignA)).resolves.toBeNull();
  });
  it("listCampaigns", async () => {
    const rows = await listCampaigns(B);
    expect(rows.map((r) => r.id)).not.toContain(campaignA);
  });
  it("getProposalById", async () => {
    await expect(getProposalById(B, proposalA)).resolves.toBeNull();
  });
  it("listProposals", async () => {
    const rows = await listProposals(B);
    expect(rows.map((r) => r.id)).not.toContain(proposalA);
  });
  it("getDraftById", async () => {
    await expect(getDraftById(B, draftA)).resolves.toBeNull();
  });
  it("listDraftMessages", async () => {
    await expect(listDraftMessages(B, draftA)).resolves.toEqual([]);
  });
  it("recentPerformanceSnapshots", async () => {
    await recordPerformanceSnapshot(A, {
      campaignId: campaignA,
      spend: 100,
      clicks: 5,
      impressions: 90,
      conversions: 1,
    });
    const rows = await recentPerformanceSnapshots(B, 30);
    expect(rows.filter((r) => r.campaignId === campaignA)).toEqual([]);
  });
  it("latestCrmSignalSnapshot", async () => {
    await recordCrmSignalSnapshot(A, {
      campaignId: campaignA,
      hotCount: 9,
      warmCount: 0,
      coldCount: 0,
      unscoredCount: 0,
    });
    const snap = await latestCrmSignalSnapshot(B);
    expect(snap?.hotCount ?? 0).not.toBe(9);
  });
  it("getOverviewStats counts only B's rows", async () => {
    const stats = await getOverviewStats(B);
    expect(stats.activeCampaignCount).toBe(0);
    expect(stats.pendingProposalCount).toBe(0);
  });
  it("listCampaignsWithLatestCpl", async () => {
    const rows = await listCampaignsWithLatestCpl(B);
    expect(rows.map((r) => r.id)).not.toContain(campaignA);
  });
  it("getSpendCplTrend", async () => {
    await expect(getSpendCplTrend(B, 30)).resolves.toEqual([]);
  });
  it("getOrgSettings falls back to defaults rather than reading A's row", async () => {
    await setCronEnabled(A, true);
    const settings = await getOrgSettings(B);
    expect(settings.cronEnabled).toBe(false);
  });
  it("listMemberBalances", async () => {
    const rows = await listMemberBalances(B);
    expect(rows.map((r) => r.userId)).not.toContain(USER_A);
  });
  it("getSpendByFeature / getSpendByModel / getSpendTrend", async () => {
    await expect(getSpendByFeature(B, 30)).resolves.toEqual([]);
    await expect(getSpendByModel(B, 30)).resolves.toEqual([]);
    await expect(getSpendTrend(B, 30)).resolves.toEqual([]);
  });
  it("listAudit / countAuditToday", async () => {
    await writeAudit(A, {
      actorType: "human",
      actorUserId: USER_A,
      action: "proposal.created",
      entityType: "proposal",
    });
    await expect(listAudit(B, 10)).resolves.toEqual([]);
    await expect(countAuditToday(B)).resolves.toBe(0);
  });
});

suite("org B cannot write org A's rows", () => {
  it("decideProposal affects nothing", async () => {
    await decideProposal(B, proposalA, "approved", USER_A, "api");
    const still = await getProposalById(A, proposalA);
    expect(still?.status).toBe("pending");
  });
  it("markProposalExecuted affects nothing", async () => {
    await markProposalExecuted(B, proposalA);
    expect((await getProposalById(A, proposalA))?.status).toBe("pending");
  });
  it("markProposalFailed affects nothing", async () => {
    await markProposalFailed(B, proposalA, "nope");
    expect((await getProposalById(A, proposalA))?.error).toBeNull();
  });
  it("updateProposalPayload throws rather than silently succeeding", async () => {
    await expect(updateProposalPayload(B, proposalA, { x: 1 })).rejects.toThrow("not found");
  });
  it("updateDraftFields throws", async () => {
    await expect(updateDraftFields(B, draftA, { corridor: "stolen" })).rejects.toThrow("not found");
  });
  it("setDraftStatus affects nothing", async () => {
    await setDraftStatus(B, draftA, "ready");
    expect((await getDraftById(A, draftA))?.status).toBe("chatting");
  });
  it("markDraftConverted affects nothing", async () => {
    await markDraftConverted(B, draftA, proposalA);
    expect((await getDraftById(A, draftA))?.proposalId).toBeNull();
  });
  it("appendDraftMessage throws", async () => {
    await expect(appendDraftMessage(B, draftA, "user", "hi")).rejects.toThrow("not found");
  });
  it("recordPerformanceSnapshot throws for A's campaign", async () => {
    await expect(
      recordPerformanceSnapshot(B, {
        campaignId: campaignA,
        spend: 1,
        clicks: 1,
        impressions: 1,
        conversions: 1,
      }),
    ).rejects.toThrow("not found");
  });
  it("touchLastRunAt affects nothing", async () => {
    const before = (await getOrgSettings(A)).lastRunAt;
    await touchLastRunAt(B);
    expect((await getOrgSettings(A)).lastRunAt).toBe(before);
  });
});

suite("platform scope reads across orgs but never writes across them", () => {
  it("reads both orgs' campaigns", async () => {
    const rows = await listCampaigns(PLATFORM);
    expect(rows.map((r) => r.id)).toContain(campaignA);
  });
  it("reads a specific org's proposal", async () => {
    await expect(getProposalById(PLATFORM, proposalA)).resolves.not.toBeNull();
  });
  it("listOrgBalances works only under platform scope", async () => {
    await expect(listOrgBalances(PLATFORM)).resolves.toBeInstanceOf(Array);
    await expect(listOrgBalances(A)).rejects.toThrow("requires platform scope");
  });
  it("a platform INSERT carrying another org's org_id is rejected by WITH CHECK", async () => {
    // WITH CHECK pins writes to current_tenant() even under platform scope, so
    // the read affordance cannot become a write bypass.
    await expect(
      (async () => {
        const { withTenantTransaction } = await import("./tx");
        await withTenantTransaction(PLATFORM, (client) =>
          client.query(
            `INSERT INTO adsagent.campaigns (org_id, platform, name)
             VALUES ($1::uuid, 'google', 'smuggled')`,
            [ORG_A],
          ),
        );
      })(),
    ).rejects.toThrow(/row-level security/i);
  });
});

suite("the pooled-connection case — the release gate", () => {
  it("a second request on a reused connection cannot see the first's tenant", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const first = await pool.connect();
      const pidA = (await first.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await first.query("BEGIN");
      await first.query("SELECT public.set_tenant($1)", [ORG_A]);
      const seen = await first.query<{ n: string }>(
        `SELECT count(*) AS n FROM adsagent.campaigns WHERE id = $1`,
        [campaignA],
      );
      expect(Number(seen.rows[0].n)).toBe(1);
      await first.query("COMMIT");
      first.release();

      const second = await pool.connect();
      const pidB = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      expect(pidB, "same physical connection is the whole point").toBe(pidA);
      await second.query("BEGIN");
      await second.query("SELECT public.set_tenant($1)", [ORG_B]);
      const leaked = await second.query<{ n: string }>(
        `SELECT count(*) AS n FROM adsagent.campaigns WHERE id = $1`,
        [campaignA],
      );
      await second.query("COMMIT");
      second.release();
      expect(Number(leaked.rows[0].n), "org A's row visible to org B on a reused connection").toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("a request with no tenant set sees nothing — fail closed", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM adsagent.campaigns`,
      );
      expect(Number(rows[0].n), "no tenant set must mean no rows, not all rows").toBe(0);
    } finally {
      await pool.end();
    }
  });
});

suite("coverage meta-test", () => {
  it("every exported data-layer function has a cross-tenant case", async () => {
    const modules = {
      "./campaigns": await import("./campaigns"),
      "./proposals": await import("./proposals"),
      "./campaign-drafts": await import("./campaign-drafts"),
      "./snapshots": await import("./snapshots"),
      "./dashboard": await import("./dashboard"),
      "./org-settings": await import("./org-settings"),
      "./credits": await import("./credits"),
      "./audit-log": await import("./audit-log"),
    };
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(__filename, "utf8");

    const uncovered: string[] = [];
    for (const [path, mod] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== "function") continue;
        if (name === "ensureOrgSettings") continue; // exercised by dal, not a read path
        if (!source.includes(`${name}(`)) uncovered.push(`${path}:${name}`);
      }
    }
    // A new scoped function with no case fails here, on the day it lands.
    expect(uncovered).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the gate**

```bash
cd ads-agent && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run lib/db/cross-tenant.test.ts lib/db/rls-coverage.test.ts lib/db/tx.pooled.test.ts
```

Expected: PASS across all three files.

**If the pooled-connection case fails, S3 has not passed. Do not loosen a policy to make it pass.** Revert the policy migrations (009 through 013 `.down.sql`), keep the `org_id` columns and the `Scope` parameters — both additive and safe to leave — and re-enter S3 with the pooling model fixed first. RLS half-applied is worse than not applied, because the surfaces above it start assuming a guarantee the database is not making.

- [ ] **Step 6: Run everything, both apps**

```bash
cd ads-agent && npx tsc --noEmit && TEST_DATABASE_URL="$DATABASE_URL" npx vitest run
cd /Users/swami/Documents/GentleSpace_Web && npx tsc --noEmit && npx vitest run && npm run graph:check
```

Expected: zero type errors, all suites green, non-zero graph overlap.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/cross-tenant.test.ts ads-agent/lib/db/rls-coverage.test.ts \
        ads-agent/lib/db/fixtures/
git commit -m "test(db): the cross-tenant isolation release gate

Exhaustive over the module inventory rather than a sample, with a meta-test
that fails when a new scoped function has no case. The pooled-connection case
is the gate: pool size 1, tenant A in a transaction, commit, then tenant B on
the same physical backend must not see A's row. RLS coverage is keyed off the
presence of an org_id column rather than a hand-maintained list, so a tenant
table added tomorrow fails on the day it lands rather than the day it leaks."
```

**S3 gate — release-blocking.** The cross-tenant suite green including the pooled-connection case; zero rows from the `ENABLE`/`FORCE` catalogue query; zero policies missing `WITH CHECK`; every `org_id` table carrying an `org_id`-leading index; the platform `WITH CHECK` case proving the read affordance is not a write bypass; the no-tenant case proving fail-closed. Nothing customer-facing ships before all of this passes.

**Only after this gate passes** may the `ads_agent` instance on :5434 be decommissioned and the pre-S2 backups retired.

---

## Final review

Dispatch one `adversarial-reviewer` on `inherit` over `git diff $(git merge-base main HEAD)..HEAD`, with the Global Constraints section above as its attention lens.

**Skills:** `adversarial-reviewer`, `security-engineer`
**Model:** `inherit`

Point its Security Auditor persona specifically at:

1. **The pooled-connection test.** Does it prove what it claims? Does the control case actually leak, and would the assertion fail if `set_config`'s third argument were removed from `set_tenant`?
2. **The `FORCE` assertion.** Is the catalogue query's table set the right one, or does it miss a schema?
3. **Every query in the eight converted modules.** Can any of them reach a table without `scopeClause`, or number a placeholder assuming a scope kind?
4. **The platform read affordance.** Can an org-scoped session cause `public.is_platform_read()` to return true by any path? Can platform scope write a row under another org's `org_id`?
5. **The Twenty guard.** Is there any exported path into Twenty data that does not assert platform scope, in either app?
6. **`withTenantTransaction`'s error path.** Can a failed `ROLLBACK` leave a connection in the pool carrying a tenant setting?

Its Saboteur persona should be pointed at the migration down-paths: does any `.down.sql` leave a table with `org_id` but no policy, which is the exact half-applied state the abort criteria forbid?

---

## Self-review

Run against the specs with fresh eyes.

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| Build sequence S1 — four live defects | 1 (F-2), 2 (F-3), 3 (F-7), 9 (F-1) |
| Build sequence S1 gate | 4 |
| Build sequence S2 — consolidation, PG18 | 5, 7, 8 |
| Build sequence S2 abort criteria | stated at the head of S2; row-count diff in 8 Step 2, 30-minute run in 8 Step 9 |
| Build sequence "gated on a rehearsed restore" | 6 |
| Build sequence "old instances stay running" | stated at the head of S2 and at the S3 gate |
| Build sequence S3 — scope, RLS, authz | 9–18 |
| Build sequence S3 abort criteria | stated at the head of S3 and in 18 Step 5 |
| Build sequence "Twenty platform-only, throwing, nine call sites" | 16 |
| Validation §9 Tier 1 F-1 transaction-local tenant | 9 (migration 006, `withTenantTransaction`, pooled test) |
| Validation §9 Tier 1 F-20 non-owner role + FORCE + CI cross-tenant test | 7 (roles, no BYPASSRLS), 10–15 (FORCE), 18 (both catalogue and behavioural tests) |
| Validation §9 Tier 1 F-2 role vocabulary with explicit ALTER | 1 |
| Validation §9 Tier 1 F-3 route authorisation | 2, 17 |
| Validation §9 Tier 1 F-7 record the decider | 3 |
| Data model §0 conventions — schema-qualified, `uuidv7()`, `org_id`, org-leading index, TIMESTAMPTZ, numbered migrations | 1 (runner), 5 (`uuidv7`), 7 (schemas), 9 (indexes), 13/15 (`uuidv7()` on `audit_log`), 18 (index coverage test) |
| Data model §0 schema layout and `agent_ro` | 7 |
| Data model §1.1 `set_tenant` / `current_tenant` | 9 |
| Data model §1.2 policy template | 10, 11, 12, 13, 15 |
| Data model §1.3 `org_ref`, `lifecycle_state` | 9 |
| Data model §2 fixes to existing tables | 1 (role CHECK), 3 (`decided_by`), 9 (`org_id` backfill), 11 (per-org cron) |
| Data model §10 migration plan | mapped onto 001–013; the §10 numbering (010–020) is renumbered into this plan's owned range, same order |
| Data model §11 schema analysis — plural entity tables, singular collective nouns | 15 (`audit_log` singular, matching `ai_action_log`) |
| Tenancy §1 scope derivation from `orgs.kind` | 17 |
| Tenancy §2 schema migration 2a–2e | 9 (2a), 1 (2b), 3 (2c), 11 (2d), 15 (2e) |
| Tenancy §3 data layer, 31 signatures | 10–16 |
| Tenancy §3 `listOrgBalances` platform-only | 12 |
| Tenancy §3a RLS backstop, three failure details | 9, 10–15, 18 |
| Tenancy §4 API layer, `guard`, `ownedOr404`, 404-not-403 | 17 |
| Tenancy §4 two UI authorization bugs | 17 Step 11 |
| Tenancy §5 session hardening, `ensureShadowRows` upserts settings | 17 Step 11 |
| Tenancy §6 rollout sequence | the S1/S2/S3 wave order |
| Tenancy "Testing plan" cross-tenant release gate | 18 |
| Tenancy Q4 resolution | 16 |
| Datastore §4 consolidation | 8 |
| Datastore §5 tenancy, pooling hazard | 9 |
| Datastore §5.1 cross-tenant path | out of S3 scope; the boundary is recorded in "Contradictions", and Task 7 creates no `BYPASSRLS` role, which is the precondition |
| Datastore §12.5 backup and restore, drill performed | 6 |

**Gaps I could not turn into a task, deliberately:**

- **Tenancy §2c's remaining proposal-lifecycle columns** (`execute_after`, `canceled_at`, `reopened_at`, the widened `status` CHECK, `idx_proposals_due`) and data model §2's `scheduled_for`, `undo_until`, `proposed_by`, `evidence`. These belong to the undo window and agent provenance, which are Epic 2 and S10 respectively. Migration 002 lands only `decided_by` and `decided_via`, which is what F-7 requires. Migrations 014–019 are reserved and unclaimed for exactly this.
- **Tenancy §6 step 7 cleanup** — dropping `cron_settings` and `ai_action_log`. Both are deliberately retained unread so Tasks 11 and 15 stay reversible; the spec itself defers the drop until after Epic 2 repoints Home.
- **Data model §10 migration 020 `agent_ro` tenant-scoped views.** The role is created in Task 7 with `SELECT`-only grants; the views it selects from are the MCP context server's surface, which is S9.
- **Datastore §12.5's ClickHouse and snapshot lines.** Nothing exists to back up until S6 and S8.
- **`public.corridors`.** Data model §0 lists it as shared reference data in `public`, but the table itself is created at S7 attribution. Task 5 mentions no `corridors` grant; Task 7's `ALTER DEFAULT PRIVILEGES IN SCHEMA public` covers it when it lands.

### 2. Placeholder scan

Searched for `TBD`, `TODO`, `implement later`, `add appropriate error handling`, `add validation`, `handle edge cases`, `write tests for the above`, `similar to Task`. None present. Every code step carries a code block. Every command step carries the exact command and the expected output. The one cross-task reference — Tasks 11 and 12 needing `scope-interim.ts` if they run before Task 10 — repeats the instruction to create it with the contents given in Task 10 Step 7 rather than saying "see Task 10", and notes that identical content merges cleanly.

Two places name a value to be discovered rather than a literal: the AGE branch in Task 5 (`<AGE_REF>`, with the exact `git ls-remote` command that produces it and an escalation if it does not exist) and the role passwords in Task 7 (generated by `openssl rand`). Both are cases where writing a literal would be wrong.

### 3. Type consistency

- `Scope` is `{ kind: "platform" | "org"; orgId: string }` in Task 9 and used with those exact members in Tasks 10–18.
- `scopeClause(scope, column?)` returns `{ sql, params }` in Task 9; every consumer destructures as `const s = scopeClause(...)` and uses `s.sql` / `...s.params`.
- `withTenantTransaction(scope, fn)` takes `(client: PoolClient) => Promise<T>` in Task 9; every module's mock replaces it with `(_scope, fn) => fn({ query })`, matching the single-`query` shape used.
- `decideProposal` is `(id, status, decidedBy, decidedVia?)` in Task 3 and `(scope, id, status, decidedBy, decidedVia?)` in Task 10, and Task 3's Interfaces block states the coming change explicitly. Task 17's final `approve/route.ts` uses the five-argument form.
- `decided_via` is `('ui','bulk','api','system')` in migration 002 and in the TypeScript union in Tasks 3 and 10.
- `settings.ts`'s `getCronSettings` returning `{ enabled, lastRunAt }` becomes `org-settings.ts`'s `getOrgSettings` returning `{ cronEnabled, lastRunAt, undoWindowSeconds, approvalThresholdInr }`; Task 11 Step 6 renames the field at all four consuming sites.
- `ai-action-log`'s `logAiAction` / `countAiActionsToday` / `listRecentAiActions` become `writeAudit` / `countAuditToday` / `listAudit`; Task 15 Step 6 rewrites all four call sites and Task 18 imports the new names.
- `TWENTY_TOOL_DEFINITIONS` is the renamed constant and `twentyMcpTools(scope)` the new export; Task 16 Step 4 names both and updates `mcp-client.ts`.
- `guard` returns `{ ok, session, scope }`; `ownedOr404` returns `{ ok, entity }`. Task 17's route bodies use `access.scope`, `access.session.userId` and `owned.entity` consistently.
- Migration numbers: 001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013 each appear exactly once across all tasks, and the per-task table matches the per-task **Files** blocks.
