# S1–S3 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four live defects, consolidate the databases onto PostgreSQL 18, and make the system tenant-safe — the release gate before any customer data exists.

**Architecture:** Three sequential stages with hard gates. S1 repairs defects in the code as it stands. S2 merges `ads_agent` into the listings instance as a schema on PG18. S3 adds `Scope` at the application layer and row-level security beneath it. Parallelism happens *inside* S3, fanned out along a dependency graph derived from the import structure.

**Tech Stack:** PostgreSQL 18, Apache AGE `PG18/v1.8.0-rc0`, pgvector, `node-pg`, Next.js, TypeScript, Vitest.

## Global Constraints

Every task inherits these. Copied verbatim into every reviewer dispatch.

- **Every SQL object is schema-qualified.** The deployed role has `search_path = "ag_catalog, $user, public"`; an unqualified `CREATE TABLE` lands inside the AGE extension's schema.
- **Every schema change is an explicit `ALTER`.** `ads-agent/lib/db/migrate.ts` re-runs `schema.sql`, and `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table — changes written inside a `CREATE TABLE` body never reach a provisioned database.
- **`set_config('app.current_tenant_id', $1, true)`** — the third argument is mandatory. Both apps use `pg.Pool`; without transaction scoping the setting persists on the connection and the next request inherits the previous tenant.
- **`ENABLE` *and* `FORCE ROW LEVEL SECURITY`** on every tenant table. Owners ignore RLS unless forced.
- **Policies carry `WITH CHECK` as well as `USING`.** `USING` alone permits writing rows under another tenant's `org_id`.
- **Wrong tenant returns `404`, never `403`.** A 403 confirms the row exists.
- **No new dependencies** without asking.
- Tests are Vitest, colocated as `*.test.ts`, and run with `npm test` from `ads-agent/`.

## Parallel execution model

`superpowers:subagent-driven-development` lists "dispatch multiple implementation subagents in parallel" under **Never**, because agents sharing a working tree corrupt each other. Parallelism here therefore uses **one git worktree and branch per agent** (`best-of-n-runner`), fanned out only where the import graph proves no shared files, then merged at a fan-in gate.

| Wave | Width | Why that width |
|---|---|---|
| S1-A | 3 | three defect groups, disjoint file sets |
| S1-B | 1 | fan-in: integration test across all three |
| S2 | 1 | inherently sequential — image, then dump/restore, then repoint |
| S3-A | 1 | `scope-sql.ts` is the shared foundation everything imports |
| S3-B | **7** | seven independent module+call-site units (below) |
| S3-C | 1 | fan-in: API layer, session hardening, release gate |

**The S3-B decomposition, derived from the import graph rather than assumed:**

| Unit | Module | Call sites that move with it |
|---|---|---|
| U1 | `proposals` + `campaign-drafts` | 11 + 6 importers; joined because `campaign-drafts/[id]/create-proposal/route.ts` imports both |
| U2 | `settings` | `settings/route.ts`, `cycle/run/route.ts`, 2 via `../lib/db/settings` |
| U3 | `campaigns` | `campaigns/[id]/status/route.ts`, 2 via `../db/campaigns` |
| U4 | `dashboard` | 4 importers |
| U5 | `snapshots` | 1 importer |
| U6 | `credits` | 1 importer |
| U7 | `ai-action-log` → `audit-log` | 4 importers |
| U8 | `twenty-pipeline` | 8 non-test consumers. **No longer excluded** — Q4 answered: Twenty is shared *today*, per-org by design. Converts like the rest *and* gains a platform-only guard inside the client, which is **interim** containment until every org has its own instance. Guard must throw, not return empty. See tenancy spec "Q4 resolution" and `2026-08-12-twenty-tenancy-ownership-design.md` |

**Skill and model per role.** Always specify the model explicitly; an omitted model inherits the session's, usually the most expensive.

| Role | Skill | Model tier |
|---|---|---|
| Migration / DDL tasks | `postgres-pro`, `database-designer` | standard |
| Route authorisation | `senior-backend`, `security-auditor` | cheap — mechanical, one file each |
| Data-layer signature conversion | `refactoring-specialist`, `typescript-pro` | standard |
| Cross-tenant test suite | `senior-qa`, `tdd-guide` | standard |
| PG18 image / infra | `senior-devops`, `docker-expert` | standard |
| Task review | `code-reviewer` | scaled to diff |
| Final whole-branch review | `adversarial-reviewer` | most capable |

---

# S1 — Fix the live defects

Repairs code as it stands today. No schema consolidation, no RLS. Produces working software on its own.

## Task 1: Role vocabulary

**Files:**
- Create: `ads-agent/lib/db/migrations/001_role_vocabulary.up.sql`
- Create: `ads-agent/lib/db/migrations/001_role_vocabulary.down.sql`
- Modify: `ads-agent/lib/db/schema.sql:101`
- Test: `ads-agent/lib/auth/dal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the database can store `admin | operator | viewer`. `MemberRole` in `lib/auth/dal.ts:12` is unchanged and becomes correct.

**Context:** `schema.sql` declares `role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member'))` while `dal.ts:12` declares `MemberRole = "admin" | "operator" | "viewer"` with `ROLE_RANK = { viewer: 1, operator: 2, admin: 3 }`. The database cannot store two of the three roles, and a stored `member` resolves to `undefined` in the rank lookup — so `requireRole` denies unpredictably.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/auth/dal.test.ts
import { describe, it, expect } from "vitest";
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
});
```

`ROLE_RANK` is currently module-private; export it as part of this task.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/auth/dal.test.ts`
Expected: FAIL — `ROLE_RANK` is not exported.

- [ ] **Step 3: Export `ROLE_RANK`**

```ts
// ads-agent/lib/auth/dal.ts:15 — add `export`
export const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };
```

- [ ] **Step 4: Write the migration**

```sql
-- 001_role_vocabulary.up.sql
BEGIN;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
-- 'member' has no equivalent in the code's vocabulary. Operator is the
-- closest existing meaning: can act, cannot administer.
UPDATE public.users SET role = 'operator' WHERE role = 'member';
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin','operator','viewer'));
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'viewer';
COMMIT;
```

```sql
-- 001_role_vocabulary.down.sql
BEGIN;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'member' WHERE role IN ('operator','viewer');
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin','member'));
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'member';
COMMIT;
```

- [ ] **Step 5: Update `schema.sql` to match, for fresh databases**

Change line 101 to `role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','operator','viewer')),`. The migration is what reaches existing databases; this keeps a fresh `migrate.ts` run consistent.

- [ ] **Step 6: Run tests and commit**

Run: `cd ads-agent && npx vitest run lib/auth/dal.test.ts`
Expected: PASS

```bash
git add ads-agent/lib/auth/dal.ts ads-agent/lib/auth/dal.test.ts ads-agent/lib/db/schema.sql ads-agent/lib/db/migrations/
git commit -m "fix(auth): make the role vocabulary storable

schema.sql permitted only admin|member while dal.ts expected
admin|operator|viewer, so two of three roles could not be stored and a
stored 'member' resolved to undefined in ROLE_RANK."
```

## Task 2: Route authorisation

**Files (seven, each independent):**
- Modify: `ads-agent/app/api/settings/route.ts`
- Modify: `ads-agent/app/api/cycle/run/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/approve/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/reject/route.ts`
- Modify: `ads-agent/app/api/campaign-drafts/[id]/route.ts`
- Modify: `ads-agent/app/api/campaign-drafts/[id]/create-proposal/route.ts`
- Test: `ads-agent/app/api/route-auth.test.ts` (new)

**Interfaces:**
- Consumes: `requireApiRole(min: MemberRole): Promise<ApiRoleCheckResult>` from `@/lib/auth/dal:98`.
- Produces: every mutation route returns 401/403 before touching the database.

**Context:** `middleware.ts:26` excludes `/api` from its matcher, so these routes have no guard at all. `proposals/[id]/approve` decides *and executes* against live Google Ads. The other eleven API routes already call `requireApiRole` — follow their existing pattern exactly rather than inventing one.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/app/api/route-auth.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MUTATION_ROUTES = [
  "settings/route.ts",
  "cycle/run/route.ts",
  "proposals/[id]/route.ts",
  "proposals/[id]/approve/route.ts",
  "proposals/[id]/reject/route.ts",
  "campaign-drafts/[id]/route.ts",
  "campaign-drafts/[id]/create-proposal/route.ts",
];

describe("every mutation route is guarded", () => {
  it.each(MUTATION_ROUTES)("%s calls requireApiRole", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("requireApiRole");
  });
});
```

This is a static check, deliberately: it costs nothing to run, it cannot be satisfied by accident, and it fails loudly if a future route is added without a guard.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run app/api/route-auth.test.ts`
Expected: FAIL on all seven.

- [ ] **Step 3: Add the guard to each route**

Pattern, matching the existing eleven guarded routes:

```ts
import { requireApiRole } from "@/lib/auth/dal";

export async function POST(req: Request) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  // ... existing body unchanged ...
}
```

Minimum role per route — deliberately not uniform:

| Route | Role | Why |
|---|---|---|
| `settings` GET | `viewer` | reading configuration |
| `settings` PATCH | `admin` | changes org-wide behaviour |
| `cycle/run` POST | `admin` | triggers the decision cycle |
| `proposals/[id]` PATCH | `operator` | edits a pending proposal |
| `proposals/[id]/approve` POST | `operator` | spends money — see note |
| `proposals/[id]/reject` POST | `operator` | — |
| `campaign-drafts/[id]` PATCH | `operator` | — |
| `campaign-drafts/[id]/create-proposal` POST | `operator` | — |

`approve` stays at `operator` because approving is the operator's daily job; the guardrail against mistakes is the undo window in the UX spec, not a higher role. Raising it to `admin` would make a solo-broker tenant unable to work.

- [ ] **Step 4: Run tests and commit**

Run: `cd ads-agent && npx vitest run app/api/route-auth.test.ts && npx vitest run`
Expected: PASS, and no regression elsewhere.

```bash
git add ads-agent/app/api/
git commit -m "fix(api): guard the seven unauthenticated mutation routes

middleware.ts excludes /api from its matcher, so these had no guard at
all -- including proposals/[id]/approve, which decides and executes
against live Google Ads."
```

## Task 3: Record who decided

**Files:**
- Modify: `ads-agent/lib/db/proposals.ts:68-74`
- Create: `ads-agent/lib/db/migrations/002_proposal_decider.up.sql` / `.down.sql`
- Modify: `ads-agent/app/api/proposals/[id]/approve/route.ts`, `.../reject/route.ts`
- Test: `ads-agent/lib/db/proposals.test.ts`

**Interfaces:**
- Consumes: `requireApiRole` result from Task 2, which carries the session user id.
- Produces: `decideProposal(id, status, decidedBy, decidedVia)` — later tasks in S3 add `scope` as the **first** parameter, so expect this signature to change again.

**Context:** `decideProposal` currently runs `UPDATE proposals SET status = $2, decided_at = NOW() WHERE id = $1`. The product's entire premise is human-gated approval, and no human is recorded.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/proposals.test.ts
import { describe, it, expect, vi } from "vitest";

describe("decideProposal", () => {
  it("persists who decided and by what route", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    vi.doMock("./client", () => ({ getPool: () => ({ query }) }));
    const { decideProposal } = await import("./proposals");

    await decideProposal("11111111-1111-1111-1111-111111111111", "approved",
      "22222222-2222-2222-2222-222222222222", "ui");

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("decided_by");
    expect(sql).toContain("decided_via");
    expect(params).toContain("22222222-2222-2222-2222-222222222222");
    expect(params).toContain("ui");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts`
Expected: FAIL — `decideProposal` takes two arguments.

- [ ] **Step 3: Migration**

```sql
-- 002_proposal_decider.up.sql
BEGIN;
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS decided_by  UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS decided_via TEXT CHECK (decided_via IN ('ui','bulk','api'));
COMMIT;
```

```sql
-- 002_proposal_decider.down.sql
BEGIN;
ALTER TABLE public.proposals DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS decided_via;
COMMIT;
```

- [ ] **Step 4: Implement**

```ts
// ads-agent/lib/db/proposals.ts
export async function decideProposal(
  id: string,
  status: "approved" | "rejected",
  decidedBy: string,
  decidedVia: "ui" | "bulk" | "api" = "ui",
): Promise<void> {
  await getPool().query(
    `UPDATE proposals
        SET status = $2, decided_at = NOW(), decided_by = $3, decided_via = $4
      WHERE id = $1`,
    [id, status, decidedBy, decidedVia],
  );
}
```

- [ ] **Step 5: Update both call sites**

`approve/route.ts` and `reject/route.ts` pass `access.session.userId` and `"ui"`.

- [ ] **Step 6: Run tests and commit**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts`
Expected: PASS

```bash
git add ads-agent/lib/db/proposals.ts ads-agent/lib/db/proposals.test.ts ads-agent/lib/db/migrations/ ads-agent/app/api/proposals/
git commit -m "feat(proposals): record who decided and by what route

The human-gated approval workflow recorded no human."
```

## Task 4 (fan-in): S1 gate

**Files:** Test: `ads-agent/lib/db/migrations/migrations.test.ts` (new)

- [ ] **Step 1: Assert every migration has a reversible counterpart**

```ts
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";

describe("migrations", () => {
  it("every up has a matching down", () => {
    const files = readdirSync(__dirname).filter((f) => f.endsWith(".sql"));
    const ups = files.filter((f) => f.endsWith(".up.sql"));
    for (const up of ups) {
      expect(files, `${up} needs a down`).toContain(up.replace(".up.sql", ".down.sql"));
    }
    expect(ups.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Full suite, then commit**

Run: `cd ads-agent && npx vitest run`
Expected: all green.

**S1 gate:** three defects fixed, every migration reversible, full suite green. Stop and confirm before S2.

---

# S2 — Consolidation onto PostgreSQL 18

Sequential throughout. One agent, `senior-devops` plus `postgres-pro`.

## Task 5: PG18 + AGE image

**Files:** Modify `docker/Dockerfile.postgres`, `docker-compose.listings.yml`

- [ ] **Step 1:** Change base to `pgvector/pgvector:pg18` and `ARG AGE_BRANCH` to the PG18 release branch corresponding to tag `PG18/v1.8.0-rc0`. Confirm the exact branch name against the repository at build time — AGE's branch names differ from its tag names, and the current pin is `release/PG16/1.6.0`.

- [ ] **Step 2:** Build and verify all three extensions load.

Run: `docker compose -f docker-compose.listings.yml build && docker compose -f docker-compose.listings.yml up -d`
Then: `psql -c "SELECT extname, extversion FROM pg_extension"`
Expected: `age`, `vector`, `plpgsql` present.

- [ ] **Step 3:** Verify `uuidv7()` exists — this is the reason for the upgrade.

Run: `psql -c "SELECT uuidv7()"`
Expected: a UUID with a time-ordered prefix.

- [ ] **Step 4:** Verify the existing graph still answers. Run `npm run graph:check`. Expected: non-zero overlap for a known Bellandur row, matching pre-upgrade behaviour.

- [ ] **Step 5:** Commit.

**If AGE fails to build against PG18:** stop and escalate. Do not proceed to Task 6 — the listings search boost depends on it, and the fallback (dropping AGE and moving the boost onto the node/edge tables) is a design change, not an implementation choice.

## Task 6: Schema consolidation

**Files:** Create `scripts/consolidate/` — `01-dump.sh`, `02-restore.sh`, `03-verify.sql`

- [ ] **Step 1:** `pg_dump` `ads_agent` schema-and-data to a file. Verify row counts per table are recorded in the dump log.
- [ ] **Step 2:** Restore into the listings instance under a new `adsagent` schema (`--schema=public` renamed via `sed` on the dump, or restore then `ALTER SCHEMA public RENAME` in a scratch database then move). Prefer the scratch-database route: it is reversible and does not touch the source.
- [ ] **Step 3:** `03-verify.sql` asserts row counts match the source for all 14 tables. Any mismatch fails the task.
- [ ] **Step 4:** Create roles and grants: `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, per data model §0.
- [ ] **Step 5:** Repoint `ads-agent/.env` `DATABASE_URL` and set `search_path` to `adsagent, public`. Run the full ads-agent suite against the consolidated instance.
- [ ] **Step 6:** Commit.

**S2 gate:** both apps run against one instance, row counts verified equal, both suites green.

---

# S3 — Tenancy

## Task 7 (S3-A, sequential foundation)

**Files:** Create `ads-agent/lib/db/scope-sql.ts` + test; create `ads-agent/lib/db/migrations/003_tenant_helpers.up.sql` / `.down.sql`

**Interfaces:**
- Produces: `type Scope`, `scopeClause(scope, column?)`, and the SQL functions `public.set_tenant(uuid)` / `public.current_tenant()`. **Every unit in S3-B imports these.** Their signatures cannot change after this task without invalidating seven parallel branches.

- [ ] **Step 1:** Write tests for `scopeClause` — platform scope yields `TRUE` with no params; org scope yields `org_id = $1` with the org id; a custom column name is honoured.
- [ ] **Step 2:** Run, watch fail.
- [ ] **Step 3:** Implement `scope-sql.ts` per tenancy spec §3.
- [ ] **Step 4:** Write `003_tenant_helpers.up.sql` containing `set_tenant` and `current_tenant` exactly as in data model §1.1 — including the third argument `true` to `set_config`.
- [ ] **Step 5:** Write a test that proves transaction scoping on a **pooled** connection: open a pool of size 1, set tenant A in a transaction, commit, then in a second query on the same physical connection assert `current_tenant()` is NULL. This is the test that catches the leak; without it the bug ships silently.
- [ ] **Step 6:** Run, commit.

## Tasks 8–14 (S3-B, seven parallel units)

Each unit is one worktree, one branch, one agent, `refactoring-specialist` + `typescript-pro`, standard model.

**Every unit follows the same contract:**
1. Add `scope: Scope` as the **first** parameter of every exported function in its module. First and required, so a missed call site is a TypeScript error rather than a silent full-table read.
2. Apply `scopeClause` to every query in the module.
3. Update **all** call sites listed for that unit.
4. Update the module's colocated `*.test.ts`.
5. Add the RLS migration for its tables: `ENABLE`, `FORCE`, and a policy with both `USING` and `WITH CHECK`.
6. Run `npx vitest run <module>.test.ts` plus the tests of every call site touched.

| Task | Unit | Module file(s) | Functions | Call sites |
|---|---|---|---|---|
| 8 | U1 | `proposals.ts`, `campaign-drafts.ts` | 7 + 7 | 11 + 6 importers, incl. the shared `create-proposal` route |
| 9 | U2 | `settings.ts` → `org_settings` | 3 | `settings/route.ts`, `cycle/run/route.ts`, 2 via `../lib/db/settings` |
| 10 | U3 | `campaigns.ts` | 6 | `campaigns/[id]/status/route.ts`, 2 via `../db/campaigns` |
| 11 | U4 | `dashboard.ts` | 3 | 4 importers |
| 12 | U5 | `snapshots.ts` | 4 | 1 importer; scoped by joining `campaigns` |
| 13 | U6 | `credits.ts` | 5 | 1 importer; `listOrgBalances` is **platform scope only** and must throw on org scope |
| 14 | U7 | `ai-action-log.ts` → `audit-log.ts` | 3 | 4 importers |

Task 8 is materially larger than the rest; dispatch it first so its worktree has the longest runway.

## Task 15 (S3-C, fan-in): API layer and release gate

**Files:** all seven routes from Task 2; `ads-agent/lib/auth/dal.ts`; `ads-agent/app/api/cross-tenant.test.ts` (new)

- [ ] **Step 1:** Merge the seven S3-B branches. Resolve conflicts — expected only in shared route files.
- [ ] **Step 2:** Every mutation route derives `Scope` from the session and passes it as the first argument. Wrong tenant returns **404**, not 403.
- [ ] **Step 3:** Write the cross-tenant suite. For every table in the data model §3–§6: seed a row under org A, set tenant B, attempt to read it by primary key, assert zero rows. Then repeat **against a pooled connection with two sequential requests**, asserting the second cannot see the first's tenant.
- [ ] **Step 4:** Assert `FORCE ROW LEVEL SECURITY` is set on every tenant table:

```sql
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('adsagent','context') AND c.relkind = 'r'
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
```

Expected: zero rows. Any table listed is unprotected.

- [ ] **Step 5:** Full suite, both apps.
- [ ] **Step 6:** Commit.

**S3 gate — release-blocking.** The cross-tenant suite green, including the pooled-connection case, and zero rows from the `FORCE` check. Nothing customer-facing ships before this passes.

---

## Final review

Dispatch one `adversarial-reviewer` on the most capable model over `git merge-base main HEAD..HEAD`, with the Global Constraints above as its attention lens. Its Security Auditor persona should be pointed specifically at: the pooled-connection tenant test, the `FORCE` assertion, and whether any query in the seven converted modules can reach a table without `scopeClause`.
