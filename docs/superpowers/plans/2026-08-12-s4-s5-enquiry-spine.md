# S4–S5 Enquiry Spine and Twenty Ownership Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the enquiry spine in Postgres as the system of record, make Twenty CRM a per-tenant asynchronous projection of it, and close the enquiry loop with call logging, reminders, notifications, requirement extraction and suppression-based erasure.

**Architecture:** Postgres owns *what happened*; Twenty owns *who a person is*. Every enquiry write commits to Postgres in one tenant-scoped transaction and reaches Twenty later through a projection worker, so a Twenty outage delays enrichment and never loses an enquiry. Each org gets its own Twenty instance, registered in `context.twenty_connections`, reached only through a single resolver `getTwentyClient(orgId)`. Suppression columns and the deletion ledger are present in the *first* migration of every enquiry-spine table, because retrofitting deletion semantics after data exists is materially harder.

**Tech Stack:** PostgreSQL 18 (`uuidv7()`, RLS), Apache AGE `PG18/v1.8.0-rc0`, `pg` (`Pool`/`PoolClient`), Next.js 15 App Router, TypeScript, Vitest, `node-cron` (already a dependency), Coolify REST API, Bifrost (`chatCompletion`) for requirement extraction.

## Preconditions

**The S3 gate must have passed before Task 1 starts.** Specifically, from `docs/superpowers/plans/2026-08-12-s1-s3-foundation.md`:

- `ads-agent/lib/db/scope-sql.ts` exports `type Scope` and `scopeClause(scope: Scope, column = "org_id"): { sql: string; params: unknown[] }`.
- SQL functions `public.set_tenant(uuid)` and `public.current_tenant()` exist, with `set_config(..., true)`.
- Schemas `listings`, `adsagent`, `context`, `public`, `derived` exist, with roles `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, `derived_rw`, `agent_ro`.
- `public.lifecycle_state` enum `('active','suppressed','erased')` and the `public.org_ref` domain exist.
- `public.orgs` and `public.users` exist in the `public` schema; both apps run against one consolidated PostgreSQL 18 instance.
- The interim platform-only guard exists inside the Twenty client. **This plan carries it forward into the consolidated client and removes it in Task 24, last.**
- The cross-tenant suite is green, including the pooled-connection case.

Verify before starting:

```bash
cd ads-agent && npx vitest run && psql "$DATABASE_URL" -c "SELECT public.current_tenant()" \
  -c "SELECT 1 FROM pg_type WHERE typname = 'lifecycle_state'" \
  -c "SELECT nspname FROM pg_namespace WHERE nspname IN ('adsagent','context','listings','derived')"
```

Expected: suite green; `current_tenant()` returns NULL (unset, fail-closed); one row for `lifecycle_state`; four rows for the schemas.

## Global Constraints

Every task inherits these. Copied verbatim into every implementer and reviewer dispatch.

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

- **Every data-layer read and write runs inside `withTenantTransaction(scope, …)`.** With `FORCE ROW LEVEL SECURITY` a bare `getPool().query()` has no tenant set, so `public.current_tenant()` is NULL and the policy denies every row. `scopeClause` stays as defence in depth *above* RLS, not as a replacement for it.
- **`scopeClause` output is placed first in the `WHERE` clause and its params first in the array**, because it numbers placeholders from `$1`.
- **No enquiry-spine data-layer module may import anything under `lib/crm/`.** This is asserted by a static test. It is the structural reason an enquiry survives Twenty being down: the request path cannot reach Twenty even by accident.
- **Twenty is reached only through `getTwentyClient(orgId)`.** Constructing a client from environment variables is the equivalent of a missing `scopeClause`. The resolver **throws** when the connection is absent, suspended, or not `active` — an empty result is indistinguishable from a customer with no contacts, which is how a leak hides.
- **No data migration out of the shared Twenty instance exists in this plan, and none may be added.** Twenty's deduplication has already merged contacts across tenant lines and a merge destroys the information needed to reverse it. The shared instance becomes read-only and platform-only and is retained for history only.
- **Cross-tenant reads are declared, read-only, and audited.** Workers that scan every org use `withCrossTenantRead`, which sets `app.cross_tenant` transaction-scoped and writes `context.access_log` with `actor_kind = 'cross_tenant'`. The matching RLS policy is `FOR SELECT` only, so a cross-tenant session can never write.
- **Migration numbers 020–039 only.** Migrations live in `ads-agent/lib/db/migrations/NNN_name.up.sql` and `.down.sql`.
- **New tables are declared in migrations only, never also in `ads-agent/lib/db/schema.sql`.** Two sources of truth for one table is how the current `CREATE TABLE IF NOT EXISTS` trap was created. Task 1 makes `migrate.ts` apply the numbered migrations, so a fresh database is still correct.

## Sequencing decisions this plan makes, and why

Three places where the specs do not fully determine the implementation. Recorded here so no implementer re-litigates them mid-task.

**1. The outbox does not exist yet, so S4 uses a claim-based projection worker.** Twenty tenancy spec §7 routes enquiry enrichment "through the outbox (S5a)", but the build sequence puts S5a *after* S5. The property S4's gate actually needs is *nothing on the request path touches Twenty*, which a poller satisfies as completely as a relay does. So S4 ships `projectPendingContacts()` / `projectPendingActivities()`, which claim work from `sync_state = 'pending'` and `synced_to_twenty_at IS NULL` with `FOR UPDATE SKIP LOCKED` and exponential backoff. At S5a these two functions become outbox consumers with unchanged signatures, so the swap is a call-site change in one script, not a redesign.

**2. `enquiries.contact_*` and `contacts.*` are not duplicates.** Data model §3 puts `contact_name`/`contact_phone`/`contact_email` on `enquiries`; Twenty tenancy spec §4 puts `name`/`phone`/`email` on `contacts`. Both are correct and they mean different things: **`enquiries.contact_*` is the immutable as-captured submission** (what the enquirer actually typed, which is evidence and must not be overwritten), and **`contacts.*` is the Twenty-reconciled cache** (wholesale-overwritten by sync, because dedup may have merged the person). Contact reveal (A5) prefers the reconciled value when `sync_state = 'synced'` and falls back to the captured one, and says which it returned.

**3. Reply state projects to a Twenty stage only where the mapping is honest.** Backend spec A2 requires reply state to be "mapped not conflated" with pipeline stage. `waiting → NEW_BRIEF` and `called → SHORTLIST` are real correspondences. `closed` is not: closing an enquiry says nothing about whether the deal was won, lost, or parked, so it maps to `null`, meaning *do not project* and leave Twenty's stage to the pipeline. Inventing `closed → HANDOVER` would write a false deal outcome into the CRM.

## File Structure

**`ads-agent/lib/db/` — data layer. Every function takes `Scope` first.**

| File | Responsibility |
|---|---|
| `migration-runner.ts` | applies numbered migrations in order, records them in `public.schema_migrations`, rolls back the last one |
| `scope-write.ts` | `orgIdForWrite(scope)` — the one place platform scope is refused for a tenant write |
| `tx.ts` | `withTenantTransaction(scope, fn)` — the only way a query reaches the database |
| `cross-tenant.ts` | `withCrossTenantRead(actorRef, fn)` — declared, audited, read-only cross-org scan |
| `access-log.ts` | `recordAccess` — `context.access_log` writes |
| `deletion-requests.ts` | `context.deletion_requests` and `context.deletion_propagations` |
| `contacts.ts` | `adsagent.contacts`, including the one-hop merge follow |
| `enquiries.ts` | `adsagent.enquiries` — the spine |
| `enquiry-messages.ts` | `adsagent.enquiry_messages` — inbound only, channel provenance |
| `enquiry-activities.ts` | `adsagent.enquiry_activities` — append-only calls, notes, state changes |
| `enquiry-requirements.ts` | `adsagent.enquiry_requirements` and its revisions |
| `enquiry-signals.ts` | `adsagent.enquiry_signals` — derived, rebuildable |
| `reminders.ts` | `adsagent.reminders` |
| `notifications.ts` | `adsagent.notifications` |
| `today-feed.ts` | the Today query: due reminders, waiting enquiries, no-contact-since |
| `contact-reveal.ts` | authorised unmask, joining captured and reconciled identity |
| `erasure.ts` | suppression, ledger propagation, the scheduled hard delete |
| `twenty-connections.ts` | `context.twenty_connections` registry |

**`ads-agent/lib/crm/` — the Twenty boundary. Nothing in `lib/db/` may import from here.**

| File | Responsibility |
|---|---|
| `twenty-client.ts` | `getTwentyClient(orgId)`: the only constructor, registry-backed, throwing |
| `twenty-secrets.ts` | `resolveTwentyApiKey(apiKeyRef)` — one seam for open question B4 |
| `twenty-projection.ts` | Postgres → Twenty: persons, opportunities, notes, stage; merge handling |
| `twenty-provisioning.ts` | Coolify service plan and the provisioning state machine |
| `twenty-pipeline.ts` | *existing* — re-pointed from the MCP sidecar onto the resolving client |

**Deleted by this plan:** `ads-agent/lib/connectors/twenty.ts` (its one function moves into `twenty-pipeline.ts` on the resolving client) and `lib/crm/twenty.ts` in the root app (after inversion the marketing site never calls Twenty at all). `ads-agent/lib/bifrost/twenty-mcp-tools.ts` and `mcp-client.ts` are **not** deleted here — `resolve-tools-then-generate.ts` still needs them, and the sidecar's removal is S9 per Twenty tenancy spec §12.

**Workers (`ads-agent/scripts/`):** `run-twenty-projection.ts`, `run-reminder-scheduler.ts`, `run-erasure-sweep.ts`, `provision-twenty-instance.ts`, `check-twenty-coverage.ts`.

**Root listings app:** `lib/enquiries/capture.ts` (new — the marketing site commits to Postgres), `app/api/leads/route.ts` (inverted).

## Parallel execution model

`superpowers:subagent-driven-development` lists "dispatch multiple implementation subagents in parallel" under **Never**, because agents sharing a working tree corrupt each other. Parallelism here therefore means **one git worktree and branch per agent** (`best-of-n-runner`), fanned out only where the file sets are provably disjoint, with an explicit fan-in merge task closing each wave. Ceiling: 8 concurrent implementers; this plan never needs more than 4.

| Wave | Tasks | Width | Why that width |
|---|---|---|---|
| S4-0 | 1, 2 | 2 | Two foundation files with no overlap: Task 1 owns `migration-runner.ts` + `migrate.ts` + `ads-agent/package.json`; Task 2 owns `scope-write.ts` + `tx.ts`. Every later task imports both, so nothing else can start. |
| S4-A | 3, 4, 5 | 3 | Three independent tables with three distinct migration numbers (020, 025, 026) and no shared file. `contacts` has no FK to `enquiries`; `twenty_connections` and the compliance ledger are in `context` and reference only `public.orgs`. |
| S4-B | 6 | 1 | `adsagent.enquiries` FKs `adsagent.contacts` (020) and every child table FKs `enquiries`. A dependency, not a choice. |
| S4-C | 7, 8, 9 | 3 | Three child tables of `enquiries` (022, 023, 024), each with its own data-layer file. None imports another. |
| S4-D | 10, 11 | 2 | Task 10 rewrites the Twenty client and its 6 consumers **including `lib/decision-engine/cycle.ts`**; Task 11 touches only new provisioning files. Both read `twenty-connections.ts` (Task 4) and neither writes the other's files. Width is 2 and not 3 because a third Twenty task would have to touch `twenty-client.ts`. |
| S4-E | 12, 13, 14, 15 | 4 | Proved disjoint below. |
| S4-F | 16 | 1 | Fan-in: merge four branches, run the S4 gate. |
| S5-A | 17, 18, 19 | 3 | Three independent tables (027, 028, 029), three data-layer files, no shared file. Task 17 *imports* `enquiry-activities.ts` but does not modify it. |
| S5-B | 20, 21, 22 | 3 | Proved disjoint below. |
| S5-C | 23 | 1 | Fan-in: merge three branches, run the S5 gate. |
| S5-D | 24 | 1 | Guard removal, gated on the coverage check. Deliberately last and alone. |

**`ads-agent/lib/decision-engine/cycle.ts` is the highest-blast-radius file in the repo.** Exactly one task in this plan modifies it — Task 10, when `fetchLeadSignal` gains a `Scope` parameter and moves off the deleted `connectors/twenty.ts`. No other task in wave S4-D or anywhere else touches it.

**`ads-agent/package.json` is modified by exactly one task — Task 1**, which registers `migrate:down` and `worker:projection` and `worker:reminders` in the same edit. Task 15's erasure sweep is deliberately invoked as `npx tsx --env-file=.env.local scripts/run-erasure-sweep.ts` rather than adding a script, so that no second agent in wave S4-E needs to touch `package.json`.

### Wave S4-E disjointness proof

| Task | Creates | Modifies |
|---|---|---|
| 12 | `ads-agent/lib/crm/twenty-projection.ts`, `.test.ts`, `ads-agent/scripts/run-twenty-projection.ts` | — |
| 13 | `ads-agent/app/api/enquiries/route.ts`, `[id]/route.ts`, `[id]/state/route.ts`, `[id]/calls/route.ts`, `[id]/requirements/route.ts`, `ads-agent/app/api/enquiries/routes.test.ts` | — |
| 14 | `lib/enquiries/capture.ts`, `lib/enquiries/capture.test.ts` | `app/api/leads/route.ts`, `app/api/leads/route.test.ts`; **deletes** `lib/crm/twenty.ts`, `lib/crm/twenty.test.ts` |
| 15 | `ads-agent/lib/db/erasure.ts`, `.test.ts`, `ads-agent/scripts/run-erasure-sweep.ts`, `ads-agent/app/api/enquiries/[id]/suppress/route.ts` | — |

Tasks 13 and 15 both add files under `ads-agent/app/api/enquiries/`, but no filename is shared. Task 14 is entirely in the root listings app. Task 12 is entirely in `lib/crm/` and `scripts/`.

### Wave S5-B disjointness proof

| Task | Creates | Modifies |
|---|---|---|
| 20 | `ads-agent/lib/db/today-feed.ts`, `.test.ts`, `ads-agent/lib/reminders/scheduler.ts`, `.test.ts`, `ads-agent/scripts/run-reminder-scheduler.ts`, `ads-agent/app/api/today/route.ts`, `ads-agent/app/api/reminders/route.ts`, `ads-agent/app/api/reminders/[id]/route.ts` | — |
| 21 | `ads-agent/lib/enquiries/requirement-extraction.ts`, `.test.ts`, `ads-agent/app/api/enquiries/[id]/requirements/extract/route.ts`, `ads-agent/app/api/enquiries/[id]/requirements/revisions/[revisionId]/apply/route.ts` | — |
| 22 | `ads-agent/lib/db/contact-reveal.ts`, `.test.ts`, `ads-agent/app/api/enquiries/[id]/reveal/route.ts` | — |

All three read `lib/db/*` modules from earlier waves; none modifies one. "No contact since X" lands in the new `today-feed.ts` rather than in `enquiries.ts` specifically so that Task 20 and Task 22 do not both edit `enquiries.ts`.

### Migration number ownership

Two tasks in one wave never claim the same number, and no number repeats anywhere.

| Migration | Task | Wave |
|---|---|---|
| `020_contacts` | 3 | S4-A |
| `021_enquiries` | 6 | S4-B |
| `022_enquiry_messages` | 7 | S4-C |
| `023_enquiry_activities` | 8 | S4-C |
| `024_enquiry_requirements` | 9 | S4-C |
| `025_twenty_connections` | 4 | S4-A |
| `026_compliance_ledger` | 5 | S4-A |
| `027_reminders` | 17 | S5-A |
| `028_notifications` | 18 | S5-A |
| `029_enquiry_signals` | 19 | S5-A |

`030`–`039` are unallocated and reserved for follow-up work inside this plan's scope.

### Review

Each task ends with a `code-reviewer` dispatch scaled to its diff. Each fan-in task (16, 23) ends with an `adversarial-reviewer` on the most capable model over the merged wave, pointed at the Global Constraints as its attention lens.

---

# S4 — Enquiry spine and the Twenty ownership boundary

**Gate:** a broker can work an enquiry end to end, **and an enquiry survives Twenty being down.**

## Task 1: Migration runner

**Wave:** S4-0 · **Skills:** `postgres-pro`, `senior-devops` · **Model:** `composer-2.5-fast` (the plan contains the code)

**Files:**
- Create: `ads-agent/lib/db/migration-runner.ts`
- Create: `ads-agent/lib/db/migration-runner.test.ts`
- Modify: `ads-agent/lib/db/migrate.ts:1-19` (whole file)
- Modify: `ads-agent/package.json:11-16` (scripts block)

**Interfaces:**
- Consumes: `getPool()` from `ads-agent/lib/db/client.ts:5`.
- Produces:
  - `stripOuterTransaction(sql: string): string`
  - `pendingMigrations(files: string[], applied: string[]): string[]`
  - `applyMigrations(pool: Pool, dir: string): Promise<string[]>` — returns the names applied, in order
  - `rollbackLast(pool: Pool, dir: string): Promise<string | null>` — returns the name rolled back, or null
  - npm scripts `migrate`, `migrate:down`, `worker:projection`, `worker:reminders`

**Context:** `ads-agent/lib/db/migrate.ts` today reads `lib/db/schema.sql` and runs it, nothing else. `schema.sql` is all `CREATE TABLE IF NOT EXISTS`, so every one of the 29 migrations this programme adds would have to be applied by hand. The runner must make migration and ledger insert **atomic**, which means the runner owns the transaction — so it strips the `BEGIN;`/`COMMIT;` that the existing migration files (`001_role_vocabulary.up.sql` onward) wrap themselves in. Without stripping, the `COMMIT;` inside the file would commit the runner's transaction and leave the ledger insert outside it.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/migration-runner.test.ts
import { describe, expect, it } from "vitest";
import { pendingMigrations, stripOuterTransaction } from "./migration-runner";

describe("stripOuterTransaction", () => {
  it("removes a leading BEGIN and trailing COMMIT so the runner owns the transaction", () => {
    const sql = "BEGIN;\nALTER TABLE public.users ADD COLUMN x TEXT;\nCOMMIT;\n";
    expect(stripOuterTransaction(sql)).toBe("ALTER TABLE public.users ADD COLUMN x TEXT;");
  });

  it("leaves a file with no outer transaction untouched", () => {
    expect(stripOuterTransaction("CREATE INDEX i ON t (c);")).toBe("CREATE INDEX i ON t (c);");
  });

  it("does not strip an inner COMMIT that is not at the end", () => {
    const sql = "BEGIN;\nDO $$ BEGIN COMMIT; END $$;\nSELECT 1;\nCOMMIT;";
    expect(stripOuterTransaction(sql)).toBe("DO $$ BEGIN COMMIT; END $$;\nSELECT 1;");
  });
});

describe("pendingMigrations", () => {
  it("returns unapplied up-migrations in numeric order and ignores down files", () => {
    const files = [
      "021_enquiries.up.sql",
      "021_enquiries.down.sql",
      "020_contacts.up.sql",
      "020_contacts.down.sql",
    ];
    expect(pendingMigrations(files, ["020_contacts"])).toEqual(["021_enquiries"]);
  });

  it("returns an empty list when everything is applied", () => {
    expect(pendingMigrations(["020_contacts.up.sql"], ["020_contacts"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/migration-runner.test.ts`
Expected: FAIL — `Failed to resolve import "./migration-runner"`.

- [ ] **Step 3: Write the runner**

```ts
// ads-agent/lib/db/migration-runner.ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

const LEDGER = `CREATE TABLE IF NOT EXISTS public.schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/**
 * The runner owns the transaction so that applying a migration and recording it
 * commit together. A file's own BEGIN/COMMIT would otherwise commit the
 * runner's transaction and leave the ledger insert outside it.
 */
export function stripOuterTransaction(sql: string): string {
  return sql
    .replace(/^\s*BEGIN\s*;/i, "")
    .replace(/COMMIT\s*;\s*$/i, "")
    .trim();
}

export function pendingMigrations(files: string[], applied: string[]): string[] {
  const done = new Set(applied);
  return files
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.slice(0, -".up.sql".length))
    .filter((name) => !done.has(name))
    .sort();
}

async function appliedNames(pool: Pool): Promise<string[]> {
  await pool.query(LEDGER);
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM public.schema_migrations`,
  );
  return rows.map((r) => r.name);
}

export async function applyMigrations(pool: Pool, dir: string): Promise<string[]> {
  const pending = pendingMigrations(readdirSync(dir), await appliedNames(pool));
  for (const name of pending) {
    const sql = stripOuterTransaction(readFileSync(path.join(dir, `${name}.up.sql`), "utf-8"));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO public.schema_migrations (name) VALUES ($1)`, [name]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }
  return pending;
}

export async function rollbackLast(pool: Pool, dir: string): Promise<string | null> {
  await pool.query(LEDGER);
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM public.schema_migrations ORDER BY name DESC LIMIT 1`,
  );
  const name = rows[0]?.name;
  if (!name) return null;

  const sql = stripOuterTransaction(readFileSync(path.join(dir, `${name}.down.sql`), "utf-8"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(`DELETE FROM public.schema_migrations WHERE name = $1`, [name]);
    await client.query("COMMIT");
    return name;
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`rollback ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Rewrite `migrate.ts` to apply migrations after the schema**

```ts
// ads-agent/lib/db/migrate.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./client";
import { applyMigrations, rollbackLast } from "./migration-runner";

const MIGRATIONS_DIR = path.join(process.cwd(), "lib/db/migrations");

export async function migrate(): Promise<string[]> {
  const schemaPath = path.join(process.cwd(), "lib/db/schema.sql");
  await getPool().query(readFileSync(schemaPath, "utf-8"));
  return applyMigrations(getPool(), MIGRATIONS_DIR);
}

async function main(): Promise<void> {
  if (process.argv.includes("--down")) {
    const rolled = await rollbackLast(getPool(), MIGRATIONS_DIR);
    console.log(rolled ? `ads-agent: rolled back ${rolled}` : "ads-agent: nothing to roll back");
    return;
  }
  const applied = await migrate();
  console.log(
    applied.length > 0
      ? `ads-agent: schema applied, migrations: ${applied.join(", ")}`
      : "ads-agent: schema applied, no pending migrations",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ads-agent: migration failed", err);
    process.exit(1);
  });
```

- [ ] **Step 5: Register the scripts**

Replace the `scripts` block of `ads-agent/package.json` (lines 5–17) with:

```json
  "scripts": {
    "dev": "next dev -p 3030",
    "build": "next build",
    "start": "next start -p 3030",
    "lint": "eslint",
    "test": "vitest run",
    "migrate": "tsx --env-file=.env.local lib/db/migrate.ts",
    "migrate:down": "tsx --env-file=.env.local lib/db/migrate.ts --down",
    "worker": "tsx --env-file=.env.local scripts/run-decision-cycle.ts",
    "worker:projection": "tsx --env-file=.env.local scripts/run-twenty-projection.ts",
    "worker:reminders": "tsx --env-file=.env.local scripts/run-reminder-scheduler.ts",
    "cycle:run": "tsx --env-file=.env.local scripts/run-once.ts",
    "mcp:google-ads": "tsx --env-file=.env.local scripts/run-google-ads-mcp.ts",
    "mcp:app-data": "tsx --env-file=.env.local scripts/run-app-data-mcp.ts",
    "seed:performance": "tsx --env-file=.env.local scripts/seed-dev-performance.ts"
  },
```

`worker:projection` and `worker:reminders` point at scripts created in Tasks 12 and 20. Registering them now is deliberate: it keeps `package.json` out of every later wave.

- [ ] **Step 6: Run the tests and the runner against the database**

Run: `cd ads-agent && npx vitest run lib/db/migration-runner.test.ts`
Expected: PASS, 5 tests.

Run: `cd ads-agent && npm run migrate`
Expected: `ads-agent: schema applied, migrations: 001_role_vocabulary, 002_proposal_decider, 003_tenant_helpers` on first run; `no pending migrations` on the second.

Run: `psql "$DATABASE_URL" -c "SELECT name FROM public.schema_migrations ORDER BY name"`
Expected: the three S1–S3 migration names, one per row.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migration-runner.ts ads-agent/lib/db/migration-runner.test.ts \
        ads-agent/lib/db/migrate.ts ads-agent/package.json
git commit -m "feat(db): apply numbered migrations from migrate.ts

schema.sql is all CREATE TABLE IF NOT EXISTS, so nothing expressed in a
migration reached a provisioned database without being run by hand. The
runner owns the transaction so the migration and its ledger row commit
together, which is why it strips each file's own BEGIN/COMMIT."
```

## Task 2: Write-scope and tenant-transaction helpers

**Wave:** S4-0 · **Skills:** `typescript-pro`, `security-auditor` · **Model:** `composer-2.5-fast`

**Files:**
- Create: `ads-agent/lib/db/scope-write.ts`
- Create: `ads-agent/lib/db/scope-write.test.ts`
- Create: `ads-agent/lib/db/tx.ts`
- Create: `ads-agent/lib/db/tx.test.ts`

**Interfaces:**
- Consumes: `type Scope` from `ads-agent/lib/db/scope-sql.ts` (S3). Its shape is
  `{ kind: "platform" } | { kind: "org"; orgId: string }`.
- Produces:
  - `orgIdForWrite(scope: Scope): string` — throws on platform scope
  - `withTenantTransaction<T>(scope: Scope, fn: (client: PoolClient) => Promise<T>): Promise<T>`

**Context:** With `FORCE ROW LEVEL SECURITY`, `public.current_tenant()` must be set inside the same transaction as the query or every policy denies every row — including for the table owner. So no data-layer function may call `getPool().query()` directly. `withTenantTransaction` is the single place `public.set_tenant` is called, and it is transaction-scoped, so a pooled connection cannot carry a tenant into the next request.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/scope-write.test.ts
import { describe, expect, it } from "vitest";
import { orgIdForWrite } from "./scope-write";

describe("orgIdForWrite", () => {
  it("returns the org id for an org scope", () => {
    expect(orgIdForWrite({ kind: "org", orgId: "org-1" })).toBe("org-1");
  });

  it("throws for platform scope, because a tenant row has no org to belong to", () => {
    expect(() => orgIdForWrite({ kind: "platform" })).toThrow(/platform scope cannot write/i);
  });
});
```

```ts
// ads-agent/lib/db/tx.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));
vi.mock("./client", () => ({ getPool: () => ({ connect }) }));

import { withTenantTransaction } from "./tx";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("withTenantTransaction", () => {
  it("sets the tenant inside the transaction and commits", async () => {
    const result = await withTenantTransaction({ kind: "org", orgId: "org-1" }, async () => "ok");
    expect(result).toBe("ok");
    const statements = query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SELECT public.set_tenant($1)");
    expect(query.mock.calls[1][1]).toEqual(["org-1"]);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("never sets a tenant for platform scope, so RLS denies by default", async () => {
    await withTenantTransaction({ kind: "platform" }, async () => null);
    expect(query.mock.calls.map((c) => c[0])).not.toContain("SELECT public.set_tenant($1)");
  });

  it("rolls back and releases when the callback throws", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId: "org-1" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(query.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/db/scope-write.test.ts lib/db/tx.test.ts`
Expected: FAIL — `Failed to resolve import "./scope-write"` and `"./tx"`.

- [ ] **Step 3: Implement both helpers**

```ts
// ads-agent/lib/db/scope-write.ts
import type { Scope } from "./scope-sql";

/**
 * Every enquiry-spine row belongs to exactly one org, so a platform-scoped
 * caller has no org to write under. Refusing here rather than defaulting keeps
 * a staff tool from silently attributing a broker's enquiry to nobody.
 */
export function orgIdForWrite(scope: Scope): string {
  if (scope.kind !== "org") {
    throw new Error("orgIdForWrite: platform scope cannot write tenant rows");
  }
  return scope.orgId;
}
```

```ts
// ads-agent/lib/db/tx.ts
import type { PoolClient } from "pg";
import { getPool } from "./client";
import type { Scope } from "./scope-sql";

/**
 * The only path from the data layer into the database. FORCE ROW LEVEL
 * SECURITY means the tenant has to be set in the same transaction as the
 * query, and set_tenant's third set_config argument makes it transaction
 * scoped so a pooled connection cannot carry it into the next request.
 *
 * Platform scope deliberately sets no tenant: current_tenant() stays NULL and
 * every policy denies, which is the fail-closed direction.
 */
export async function withTenantTransaction<T>(
  scope: Scope,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (scope.kind === "org") {
      await client.query("SELECT public.set_tenant($1)", [scope.orgId]);
    }
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/db/scope-write.test.ts lib/db/tx.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/scope-write.ts ads-agent/lib/db/scope-write.test.ts \
        ads-agent/lib/db/tx.ts ads-agent/lib/db/tx.test.ts
git commit -m "feat(db): tenant-transaction and write-scope helpers

FORCE ROW LEVEL SECURITY denies every row unless the tenant is set in the
same transaction as the query, so no data-layer function may call
getPool().query() directly."
```

## Task 3: `adsagent.contacts` — the local contact row

**Wave:** S4-A · **Skills:** `postgres-pro`, `database-designer` · **Model:** `inherit` (the merge-hop semantics need judgement)

**Files:**
- Create: `ads-agent/lib/db/migrations/020_contacts.up.sql`
- Create: `ads-agent/lib/db/migrations/020_contacts.down.sql`
- Create: `ads-agent/lib/db/contacts.ts`
- Create: `ads-agent/lib/db/contacts.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite` (Task 2); `withTenantTransaction` (Task 2).
- Produces:
  - `type ContactSyncState = "pending" | "synced" | "failed" | "merged_away"`
  - `type Contact = { id, orgId, twentyPersonId, name, phone, email, syncState, syncedAt, mergedInto, syncAttempts }`
  - `createContact(scope, input: { name: string; phone?: string | null; email?: string | null }, client?: PoolClient): Promise<Contact>`
  - `getContactById(scope, id): Promise<Contact | null>` — follows exactly one merge hop
  - `markContactSynced(scope, id, twentyPersonId, canonical: { name: string; phone: string | null; email: string | null }): Promise<void>`
  - `markContactSyncFailed(scope, id, error: string): Promise<void>`
  - `markContactMergedAway(scope, id, survivorId): Promise<void>`
  - `markContactMergedIntoPerson(scope, losingContactId, twentyPersonId): Promise<string | null>` — resolves the survivor by Twenty person id and returns its local id
  - `claimPendingContacts(client: PoolClient, limit: number): Promise<Contact[]>` — cross-tenant, used by Task 12

**Context:** Twenty tenancy spec §4. Contacts are a table and not columns on the enquiry because one person raises many enquiries and a dedup merge must be repaired in one place (TW5). `merged_away` rows survive as tombstones so existing enquiry references keep resolving. §8: a chain longer than one hop is a bug and is logged rather than followed recursively.

`createContact` takes an optional `client` so the capture path can insert the contact and the enquiry in one transaction; when omitted it opens its own.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/contacts.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  createContact,
  getContactById,
  markContactMergedAway,
  markContactMergedIntoPerson,
  markContactSyncFailed,
  markContactSynced,
} from "./contacts";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "contact-1",
  org_id: "org-1",
  twenty_person_id: null,
  name: "Asha Rao",
  phone: "+919800000000",
  email: null,
  sync_state: "pending",
  synced_at: null,
  merged_into: null,
  sync_attempts: 0,
};

beforeEach(() => query.mockReset());

describe("createContact", () => {
  it("inserts under the scope's org and starts life pending", async () => {
    query.mockResolvedValue({ rows: [row] });
    const contact = await createContact(scope, { name: "Asha Rao", phone: "+919800000000" });
    expect(contact).toEqual({
      id: "contact-1",
      orgId: "org-1",
      twentyPersonId: null,
      name: "Asha Rao",
      phone: "+919800000000",
      email: null,
      syncState: "pending",
      syncedAt: null,
      mergedInto: null,
      syncAttempts: 0,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.contacts");
    expect(params).toEqual(["org-1", "Asha Rao", "+919800000000", null]);
  });

  it("refuses platform scope", async () => {
    await expect(createContact({ kind: "platform" }, { name: "Asha Rao" })).rejects.toThrow(
      /platform scope cannot write/i,
    );
  });
});

describe("getContactById", () => {
  it("returns null when nothing matches", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getContactById(scope, "missing")).resolves.toBeNull();
  });

  it("follows exactly one merge hop to the survivor", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...row, merged_into: "contact-2", sync_state: "merged_away" }] })
      .mockResolvedValueOnce({ rows: [{ ...row, id: "contact-2", sync_state: "synced" }] });
    const contact = await getContactById(scope, "contact-1");
    expect(contact?.id).toBe("contact-2");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("logs and stops rather than following a second hop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    query
      .mockResolvedValueOnce({ rows: [{ ...row, merged_into: "contact-2" }] })
      .mockResolvedValueOnce({ rows: [{ ...row, id: "contact-2", merged_into: "contact-3" }] });
    const contact = await getContactById(scope, "contact-1");
    expect(contact?.id).toBe("contact-2");
    expect(query).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("merge chain longer than one hop"),
      expect.objectContaining({ contactId: "contact-1" }),
    );
    warn.mockRestore();
  });
});

describe("sync bookkeeping", () => {
  it("markContactSynced overwrites the cache wholesale with Twenty's values", async () => {
    query.mockResolvedValue({ rows: [] });
    await markContactSynced(scope, "contact-1", "person-9", {
      name: "Asha R Rao",
      phone: "+919800000001",
      email: "asha@example.com",
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("sync_state = 'synced'");
    expect(sql).toContain("synced_at = now()");
    expect(params).toEqual([
      "org-1",
      "contact-1",
      "person-9",
      "Asha R Rao",
      "+919800000001",
      "asha@example.com",
    ]);
  });

  it("markContactSyncFailed increments attempts so backoff can widen", async () => {
    query.mockResolvedValue({ rows: [] });
    await markContactSyncFailed(scope, "contact-1", "connect ECONNREFUSED");
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("sync_attempts = adsagent.contacts.sync_attempts + 1");
    expect(sql).toContain("sync_state = 'failed'");
  });

  it("markContactMergedAway tombstones the loser and points at the survivor", async () => {
    query.mockResolvedValue({ rows: [] });
    await markContactMergedAway(scope, "contact-1", "contact-2");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("sync_state = 'merged_away'");
    expect(sql).toContain("merged_into = $3");
    expect(params).toEqual(["org-1", "contact-1", "contact-2"]);
  });

  it("markContactMergedIntoPerson resolves the survivor by Twenty person id", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "contact-2" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(markContactMergedIntoPerson(scope, "contact-1", "person-9")).resolves.toBe(
      "contact-2",
    );
    expect(String(query.mock.calls[1][0])).toContain("sync_state = 'merged_away'");
  });

  it("markContactMergedIntoPerson returns null when no local row holds that person yet", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(markContactMergedIntoPerson(scope, "contact-1", "person-9")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/contacts.test.ts`
Expected: FAIL — `Failed to resolve import "./contacts"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/020_contacts.up.sql
BEGIN;

CREATE TABLE adsagent.contacts (
  id               UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id           public.org_ref NOT NULL REFERENCES public.orgs(id),

  -- Nullable until the first sync lands. Twenty is authoritative for this id.
  twenty_person_id TEXT,

  -- Cache of Twenty-owned fields (tenancy spec §3). Never edited in place by
  -- product code; overwritten wholesale by sync so a dedup merge wins.
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,

  synced_at        TIMESTAMPTZ,
  sync_state       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (sync_state IN ('pending','synced','failed','merged_away')),
  sync_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (sync_attempts >= 0),
  last_sync_error  TEXT,

  -- Set when Twenty merges this person into another. The row survives as a
  -- tombstone so existing enquiry references keep resolving (TW5).
  merged_into      UUID REFERENCES adsagent.contacts(id),

  -- Suppression from birth. Retrofitting deletion semantics after data exists
  -- is materially harder (build sequence, S4 note).
  lifecycle        public.lifecycle_state NOT NULL DEFAULT 'active',
  suppressed_at    TIMESTAMPTZ,
  erase_after      DATE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT contacts_twenty_person_unique UNIQUE (org_id, twenty_person_id)
);

CREATE INDEX contacts_org_sync_idx ON adsagent.contacts (org_id, sync_state)
  WHERE sync_state <> 'synced';
CREATE INDEX contacts_org_created_idx ON adsagent.contacts (org_id, created_at DESC);
CREATE INDEX contacts_erase_idx ON adsagent.contacts (org_id, erase_after)
  WHERE lifecycle = 'suppressed';

ALTER TABLE adsagent.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.contacts FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.contacts
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The projection worker must find pending rows across every org. Declared,
-- read-only, and audited (see lib/db/cross-tenant.ts). FOR SELECT only, so a
-- cross-tenant session can never write another tenant's row.
CREATE POLICY cross_tenant_read ON adsagent.contacts
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/020_contacts.down.sql
BEGIN;
DROP POLICY IF EXISTS cross_tenant_read  ON adsagent.contacts;
DROP POLICY IF EXISTS tenant_isolation   ON adsagent.contacts;
DROP TABLE IF EXISTS adsagent.contacts;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/contacts.ts
import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type ContactSyncState = "pending" | "synced" | "failed" | "merged_away";

export type Contact = {
  id: string;
  orgId: string;
  twentyPersonId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  syncState: ContactSyncState;
  syncedAt: string | null;
  mergedInto: string | null;
  syncAttempts: number;
};

type ContactRow = {
  id: string;
  org_id: string;
  twenty_person_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  sync_state: ContactSyncState;
  synced_at: Date | null;
  merged_into: string | null;
  sync_attempts: number;
};

const COLUMNS = `id, org_id, twenty_person_id, name, phone, email,
                 sync_state, synced_at, merged_into, sync_attempts`;

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    orgId: row.org_id,
    twentyPersonId: row.twenty_person_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    syncState: row.sync_state,
    syncedAt: row.synced_at?.toISOString() ?? null,
    mergedInto: row.merged_into,
    syncAttempts: row.sync_attempts,
  };
}

export async function createContact(
  scope: Scope,
  input: { name: string; phone?: string | null; email?: string | null },
  client?: PoolClient,
): Promise<Contact> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.contacts (org_id, name, phone, email)
               VALUES ($1, $2, $3, $4)
               RETURNING ${COLUMNS}`;
  const params = [orgId, input.name, input.phone ?? null, input.email ?? null];
  if (client) {
    const { rows } = await client.query<ContactRow>(sql, params);
    return rowToContact(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ContactRow>(sql, params);
    return rowToContact(rows[0]);
  });
}

/**
 * Follows exactly one merge hop. Twenty's dedup can point a losing row at a
 * survivor; a chain longer than one hop means the sync consumer wrote a
 * tombstone at a tombstone, which is a bug worth seeing rather than papering
 * over with recursion (tenancy spec §8).
 */
export async function getContactById(scope: Scope, id: string): Promise<Contact | null> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const first = await c.query<ContactRow>(
      `SELECT ${COLUMNS} FROM adsagent.contacts WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
      [...clause.params, id],
    );
    const row = first.rows[0];
    if (!row) return null;
    if (!row.merged_into) return rowToContact(row);

    const survivor = await c.query<ContactRow>(
      `SELECT ${COLUMNS} FROM adsagent.contacts WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
      [...clause.params, row.merged_into],
    );
    const next = survivor.rows[0];
    if (!next) return rowToContact(row);
    if (next.merged_into) {
      console.warn("contacts: merge chain longer than one hop, stopping at the first survivor", {
        contactId: id,
        survivorId: next.id,
        nextId: next.merged_into,
      });
    }
    return rowToContact(next);
  });
}

export async function markContactSynced(
  scope: Scope,
  id: string,
  twentyPersonId: string,
  canonical: { name: string; phone: string | null; email: string | null },
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.contacts
          SET twenty_person_id = $${n + 2},
              name             = $${n + 3},
              phone            = $${n + 4},
              email            = $${n + 5},
              sync_state       = 'synced',
              synced_at        = now(),
              sync_attempts    = 0,
              last_sync_error  = NULL,
              updated_at       = now()
        WHERE ${clause.sql} AND id = $${n + 1}`,
      [...clause.params, id, twentyPersonId, canonical.name, canonical.phone, canonical.email],
    );
  });
}

export async function markContactSyncFailed(
  scope: Scope,
  id: string,
  error: string,
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.contacts
          SET sync_state      = 'failed',
              sync_attempts   = adsagent.contacts.sync_attempts + 1,
              last_sync_error = $${n + 2},
              updated_at      = now()
        WHERE ${clause.sql} AND id = $${n + 1}`,
      [...clause.params, id, error.slice(0, 500)],
    );
  });
}

export async function markContactMergedAway(
  scope: Scope,
  id: string,
  survivorId: string,
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.contacts
          SET sync_state = 'merged_away',
              merged_into = $${n + 2},
              updated_at = now()
        WHERE ${clause.sql} AND id = $${n + 1}`,
      [...clause.params, id, survivorId],
    );
  });
}

/**
 * Twenty's dedup merged this contact into an existing person. Resolve the
 * survivor by the person id Twenty returned and tombstone the loser. Returns
 * the survivor's local id, or null when no local row holds that person id yet
 * — in which case the caller retries rather than guessing.
 */
export async function markContactMergedIntoPerson(
  scope: Scope,
  losingContactId: string,
  twentyPersonId: string,
): Promise<string | null> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const survivor = await c.query<{ id: string }>(
      `SELECT id FROM adsagent.contacts
        WHERE org_id = $1 AND twenty_person_id = $2 AND id <> $3`,
      [orgId, twentyPersonId, losingContactId],
    );
    const survivorId = survivor.rows[0]?.id;
    if (!survivorId) return null;
    await c.query(
      `UPDATE adsagent.contacts
          SET sync_state = 'merged_away', merged_into = $3, updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, losingContactId, survivorId],
    );
    return survivorId;
  });
}

/**
 * Cross-tenant claim for the projection worker. Runs inside a caller-supplied
 * client already inside withCrossTenantRead, so it takes no Scope: it is
 * deliberately every org's pending work. Backoff widens with each attempt and
 * stops at 8, so a permanently broken instance stops burning the loop.
 */
export async function claimPendingContacts(
  client: PoolClient,
  limit: number,
): Promise<Contact[]> {
  const { rows } = await client.query<ContactRow>(
    `SELECT ${COLUMNS}
       FROM adsagent.contacts
      WHERE sync_state IN ('pending','failed')
        AND lifecycle = 'active'
        AND sync_attempts < 8
        AND updated_at < now() - (least(3600, 60 * (2 ^ sync_attempts))::int * interval '1 second')
      ORDER BY created_at
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map(rowToContact);
}
```

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate`
Expected: `ads-agent: schema applied, migrations: 020_contacts`.

Run: `cd ads-agent && npx vitest run lib/db/contacts.test.ts`
Expected: PASS, 10 tests.

Run: `psql "$DATABASE_URL" -c "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'adsagent.contacts'::regclass"`
Expected: `t | t`.

- [ ] **Step 6: Verify the down migration, then re-apply**

Run: `cd ads-agent && npm run migrate:down && npm run migrate`
Expected: `rolled back 020_contacts`, then `migrations: 020_contacts`.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migrations/020_contacts.up.sql \
        ads-agent/lib/db/migrations/020_contacts.down.sql \
        ads-agent/lib/db/contacts.ts ads-agent/lib/db/contacts.test.ts
git commit -m "feat(db): adsagent.contacts, the local contact row

Enquiries reference this table and never a Twenty person id (TW5), so a
dedup merge needs repairing in exactly one place. Merged rows survive as
tombstones and reads follow one hop only."
```

## Task 4: `context.twenty_connections` — the connection registry

**Wave:** S4-A · **Skills:** `postgres-pro`, `security-auditor` · **Model:** `composer-2.5-fast`

**Files:**
- Create: `ads-agent/lib/db/migrations/025_twenty_connections.up.sql`
- Create: `ads-agent/lib/db/migrations/025_twenty_connections.down.sql`
- Create: `ads-agent/lib/db/twenty-connections.ts`
- Create: `ads-agent/lib/db/twenty-connections.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `withTenantTransaction` (Task 2).
- Produces:
  - `type TwentyConnectionState = "provisioning" | "active" | "suspended" | "deprovisioned" | "failed"`
  - `type TwentyConnection = { orgId, baseUrl, apiKeyRef, coolifyServiceUuid, twentyVersion, state, provisionedAt, lastSyncAt, lastError }`
  - `getTwentyConnection(orgId: string): Promise<TwentyConnection | null>`
  - `upsertTwentyConnection(input: { orgId; baseUrl; apiKeyRef; coolifyServiceUuid; twentyVersion; state }): Promise<TwentyConnection>`
  - `setTwentyConnectionState(orgId, state, lastError?): Promise<void>`
  - `touchTwentyLastSync(orgId): Promise<void>`
  - `orgsWithoutOwnInstance(sharedBaseUrl: string): Promise<{ orgId: string; reason: string }[]>`

**Context:** Twenty tenancy spec §5. The registry stores a **pointer** into the secret store (`api_key_ref`), never the key, so it is safe to back up and read and open question B4 can be settled without a schema change. The API key is scoped in Twenty to person and opportunity access only; a workspace-admin key must not be issued.

`getTwentyConnection` takes a raw `orgId` rather than a `Scope` because the resolver is called *with* an org id by definition — it is the function that turns an org id into a client — and it must work from the provisioning script and the cross-tenant worker as well as from a request. Every call sets the tenant to that org id internally, so the row it can read is exactly that org's.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/twenty-connections.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  getTwentyConnection,
  orgsWithoutOwnInstance,
  setTwentyConnectionState,
  upsertTwentyConnection,
} from "./twenty-connections";

const row = {
  org_id: "org-1",
  base_url: "https://crm-org-1.gentlespace.in",
  api_key_ref: "secret://twenty/org-1",
  coolify_service_uuid: "svc-abc",
  twenty_version: "1.9.0",
  state: "active",
  provisioned_at: new Date("2026-08-12T00:00:00.000Z"),
  last_sync_at: null,
  last_error: null,
};

beforeEach(() => query.mockReset());

describe("getTwentyConnection", () => {
  it("maps the row", async () => {
    query.mockResolvedValue({ rows: [row] });
    await expect(getTwentyConnection("org-1")).resolves.toEqual({
      orgId: "org-1",
      baseUrl: "https://crm-org-1.gentlespace.in",
      apiKeyRef: "secret://twenty/org-1",
      coolifyServiceUuid: "svc-abc",
      twentyVersion: "1.9.0",
      state: "active",
      provisionedAt: "2026-08-12T00:00:00.000Z",
      lastSyncAt: null,
      lastError: null,
    });
  });

  it("returns null when the org has no instance", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getTwentyConnection("org-2")).resolves.toBeNull();
  });

  it("never selects a secret, only its reference", async () => {
    query.mockResolvedValue({ rows: [] });
    await getTwentyConnection("org-1");
    expect(query.mock.calls[0][0]).toContain("api_key_ref");
    expect(query.mock.calls[0][0]).not.toMatch(/api_key\b(?!_ref)/);
  });
});

describe("upsertTwentyConnection", () => {
  it("upserts on org_id", async () => {
    query.mockResolvedValue({ rows: [{ ...row, state: "provisioning" }] });
    const result = await upsertTwentyConnection({
      orgId: "org-1",
      baseUrl: "https://crm-org-1.gentlespace.in",
      apiKeyRef: "secret://twenty/org-1",
      coolifyServiceUuid: "svc-abc",
      twentyVersion: "1.9.0",
      state: "provisioning",
    });
    expect(result.state).toBe("provisioning");
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT (org_id) DO UPDATE");
  });
});

describe("setTwentyConnectionState", () => {
  it("records the error alongside the state", async () => {
    query.mockResolvedValue({ rows: [] });
    await setTwentyConnectionState("org-1", "failed", "health check timed out");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("UPDATE context.twenty_connections");
    expect(params).toEqual(["org-1", "failed", "health check timed out"]);
  });
});

describe("orgsWithoutOwnInstance", () => {
  it("lists orgs with no row, a non-active row, or the shared base url", async () => {
    query.mockResolvedValue({
      rows: [
        { org_id: "org-2", reason: "no connection" },
        { org_id: "org-3", reason: "state=suspended" },
        { org_id: "org-4", reason: "shared instance" },
      ],
    });
    const gaps = await orgsWithoutOwnInstance("https://crm.gentlespace.in");
    expect(gaps).toEqual([
      { orgId: "org-2", reason: "no connection" },
      { orgId: "org-3", reason: "state=suspended" },
      { orgId: "org-4", reason: "shared instance" },
    ]);
    expect(query.mock.calls[0][1]).toEqual(["https://crm.gentlespace.in"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/twenty-connections.test.ts`
Expected: FAIL — `Failed to resolve import "./twenty-connections"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/025_twenty_connections.up.sql
BEGIN;

CREATE TABLE context.twenty_connections (
  org_id               public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  base_url             TEXT NOT NULL,

  -- A pointer into the secret store, never the key itself, so this table is
  -- safe to back up and read and open question B4 can be settled later
  -- without a schema change (tenancy spec §5).
  api_key_ref          TEXT NOT NULL,

  coolify_service_uuid TEXT NOT NULL UNIQUE,

  -- N instances drift. The client must know what it is talking to.
  twenty_version       TEXT NOT NULL,

  state                TEXT NOT NULL CHECK (state IN
                         ('provisioning','active','suspended','deprovisioned','failed')),
  provisioned_at       TIMESTAMPTZ,
  last_sync_at         TIMESTAMPTZ,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX twenty_connections_state_idx ON context.twenty_connections (state)
  WHERE state <> 'active';

ALTER TABLE context.twenty_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.twenty_connections FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.twenty_connections
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The coverage check and the projection worker read every org's row. Read-only
-- and audited, same declared-actor pattern as adsagent.contacts.
CREATE POLICY cross_tenant_read ON context.twenty_connections
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/025_twenty_connections.down.sql
BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON context.twenty_connections;
DROP POLICY IF EXISTS tenant_isolation  ON context.twenty_connections;
DROP TABLE IF EXISTS context.twenty_connections;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/twenty-connections.ts
import { withTenantTransaction } from "./tx";

export type TwentyConnectionState =
  | "provisioning"
  | "active"
  | "suspended"
  | "deprovisioned"
  | "failed";

export type TwentyConnection = {
  orgId: string;
  baseUrl: string;
  apiKeyRef: string;
  coolifyServiceUuid: string;
  twentyVersion: string;
  state: TwentyConnectionState;
  provisionedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

type ConnectionRow = {
  org_id: string;
  base_url: string;
  api_key_ref: string;
  coolify_service_uuid: string;
  twenty_version: string;
  state: TwentyConnectionState;
  provisioned_at: Date | null;
  last_sync_at: Date | null;
  last_error: string | null;
};

const COLUMNS = `org_id, base_url, api_key_ref, coolify_service_uuid,
                 twenty_version, state, provisioned_at, last_sync_at, last_error`;

function rowToConnection(row: ConnectionRow): TwentyConnection {
  return {
    orgId: row.org_id,
    baseUrl: row.base_url,
    apiKeyRef: row.api_key_ref,
    coolifyServiceUuid: row.coolify_service_uuid,
    twentyVersion: row.twenty_version,
    state: row.state,
    provisionedAt: row.provisioned_at?.toISOString() ?? null,
    lastSyncAt: row.last_sync_at?.toISOString() ?? null,
    lastError: row.last_error,
  };
}

/**
 * Takes a raw org id rather than a Scope: this is the function that turns an
 * org id into a connection, and it runs from requests, from the provisioning
 * script and from the cross-tenant worker. The tenant is set to that same org,
 * so the only row readable is that org's.
 */
export async function getTwentyConnection(orgId: string): Promise<TwentyConnection | null> {
  return withTenantTransaction({ kind: "org", orgId }, async (c) => {
    const { rows } = await c.query<ConnectionRow>(
      `SELECT ${COLUMNS} FROM context.twenty_connections WHERE org_id = $1`,
      [orgId],
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  });
}

export async function upsertTwentyConnection(input: {
  orgId: string;
  baseUrl: string;
  apiKeyRef: string;
  coolifyServiceUuid: string;
  twentyVersion: string;
  state: TwentyConnectionState;
}): Promise<TwentyConnection> {
  return withTenantTransaction({ kind: "org", orgId: input.orgId }, async (c) => {
    const { rows } = await c.query<ConnectionRow>(
      `INSERT INTO context.twenty_connections
         (org_id, base_url, api_key_ref, coolify_service_uuid, twenty_version, state,
          provisioned_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'active' THEN now() END)
       ON CONFLICT (org_id) DO UPDATE
         SET base_url             = EXCLUDED.base_url,
             api_key_ref          = EXCLUDED.api_key_ref,
             coolify_service_uuid = EXCLUDED.coolify_service_uuid,
             twenty_version       = EXCLUDED.twenty_version,
             state                = EXCLUDED.state,
             provisioned_at       = COALESCE(context.twenty_connections.provisioned_at,
                                             EXCLUDED.provisioned_at),
             updated_at           = now()
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.baseUrl,
        input.apiKeyRef,
        input.coolifyServiceUuid,
        input.twentyVersion,
        input.state,
      ],
    );
    return rowToConnection(rows[0]);
  });
}

export async function setTwentyConnectionState(
  orgId: string,
  state: TwentyConnectionState,
  lastError: string | null = null,
): Promise<void> {
  await withTenantTransaction({ kind: "org", orgId }, async (c) => {
    await c.query(
      `UPDATE context.twenty_connections
          SET state = $2,
              last_error = $3,
              provisioned_at = CASE WHEN $2 = 'active'
                                    THEN COALESCE(provisioned_at, now())
                                    ELSE provisioned_at END,
              updated_at = now()
        WHERE org_id = $1`,
      [orgId, state, lastError],
    );
  });
}

export async function touchTwentyLastSync(orgId: string): Promise<void> {
  await withTenantTransaction({ kind: "org", orgId }, async (c) => {
    await c.query(
      `UPDATE context.twenty_connections SET last_sync_at = now(), updated_at = now()
        WHERE org_id = $1`,
      [orgId],
    );
  });
}

/**
 * The gate for removing the interim platform-only guard (Task 24). An org
 * counts as covered only when it has an active connection whose base_url is
 * not the contaminated shared instance.
 */
export async function orgsWithoutOwnInstance(
  sharedBaseUrl: string,
): Promise<{ orgId: string; reason: string }[]> {
  const { withCrossTenantRead } = await import("./cross-tenant");
  return withCrossTenantRead("twenty-coverage-check", async (c) => {
    const { rows } = await c.query<{ org_id: string; reason: string }>(
      `SELECT o.id AS org_id,
              CASE
                WHEN t.org_id IS NULL          THEN 'no connection'
                WHEN t.base_url = $1           THEN 'shared instance'
                ELSE 'state=' || t.state
              END AS reason
         FROM public.orgs o
         LEFT JOIN context.twenty_connections t ON t.org_id = o.id
        WHERE t.org_id IS NULL
           OR t.state <> 'active'
           OR t.base_url = $1
        ORDER BY o.id`,
      [sharedBaseUrl],
    );
    return rows.map((r) => ({ orgId: r.org_id, reason: r.reason }));
  });
}
```

`orgsWithoutOwnInstance` imports `./cross-tenant` dynamically because that module is created by Task 5 in the same wave; the dynamic import keeps this file compiling in isolation and resolves once both branches merge. Wave S4-F's fan-in converts it to a static import.

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate`
Expected: `ads-agent: schema applied, migrations: 025_twenty_connections`.

Run: `cd ads-agent && npx vitest run lib/db/twenty-connections.test.ts`
Expected: PASS, 6 tests.

Run: `psql "$DATABASE_URL" -c "SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'context.twenty_connections'::regclass ORDER BY polname"`
Expected: two rows — `cross_tenant_read | r` and `tenant_isolation | *`. The `r` proves the cross-tenant policy is SELECT-only.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/migrations/025_twenty_connections.up.sql \
        ads-agent/lib/db/migrations/025_twenty_connections.down.sql \
        ads-agent/lib/db/twenty-connections.ts ads-agent/lib/db/twenty-connections.test.ts
git commit -m "feat(db): context.twenty_connections registry

One Twenty instance per org (TW1). The table holds a pointer into the
secret store, never the key, so open question B4 can be answered without a
migration."
```

## Task 5: Compliance ledger and the cross-tenant read helper

**Wave:** S4-A · **Skills:** `gdpr-dsgvo-expert`, `postgres-pro` · **Model:** `inherit` (retention semantics need judgement)

**Files:**
- Create: `ads-agent/lib/db/migrations/026_compliance_ledger.up.sql`
- Create: `ads-agent/lib/db/migrations/026_compliance_ledger.down.sql`
- Create: `ads-agent/lib/db/access-log.ts`
- Create: `ads-agent/lib/db/access-log.test.ts`
- Create: `ads-agent/lib/db/cross-tenant.ts`
- Create: `ads-agent/lib/db/cross-tenant.test.ts`
- Create: `ads-agent/lib/db/deletion-requests.ts`
- Create: `ads-agent/lib/db/deletion-requests.test.ts`

**Interfaces:**
- Consumes: `type Scope` (S3); `withTenantTransaction` (Task 2); `getPool` from `./client`.
- Produces:
  - `recordAccess(scope, entry: { actorKind; actorRef; action; subjectKind?; subjectRef? }, client?): Promise<void>`
  - `withCrossTenantRead<T>(actorRef: string, fn: (client: PoolClient) => Promise<T>): Promise<T>`
  - `RETENTION_FLOOR_DAYS = 365`, `GRIEVANCE_RESPONSE_DAYS = 90`
  - `createDeletionRequest(scope, input: { subjectKind; subjectRef }): Promise<DeletionRequest>`
  - `setPropagation(scope, requestId, store: PropagationStore, state: PropagationState, detail?): Promise<void>`
  - `listDueErasures(client: PoolClient, limit: number): Promise<DeletionRequest[]>` — cross-tenant
  - `markErased(scope, requestId): Promise<void>`

**Context:** Data model §6.1 and §6.2; datastore §11.1. Erasure is suppression, then hard delete once the one-year floor passes — building delete-on-request would be non-compliant in the opposite direction from the usual mistake. Rule 14(3) caps the grievance response at 90 days, so `respond_by` is `requested_at + 90 days`. `access_log` is partitioned monthly so retention is a `DROP PARTITION` rather than a mass `DELETE`; this migration creates the parent plus the first three partitions and a `DEFAULT` partition so an insert can never fail for want of a partition.

`context.access_log` deliberately carries `org_id UUID NOT NULL` with **no** foreign key: an audit row must survive the deletion of anything it refers to.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/access-log.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { recordAccess } from "./access-log";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("recordAccess", () => {
  it("writes the actor, the subject and the action", async () => {
    await recordAccess(scope, {
      actorKind: "user",
      actorRef: "user-7",
      action: "contact.reveal",
      subjectKind: "enquirer",
      subjectRef: "enquiry-3",
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO context.access_log");
    expect(params).toEqual(["org-1", "user", "user-7", "enquirer", "enquiry-3", "contact.reveal"]);
  });

  it("uses a caller-supplied client so the audit row commits with the read", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    await recordAccess(scope, { actorKind: "system", actorRef: "sweep", action: "erase" }, {
      query: clientQuery,
    } as never);
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });
});
```

```ts
// ads-agent/lib/db/cross-tenant.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ connect: async () => ({ query, release }) }) }));

import { withCrossTenantRead } from "./cross-tenant";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("withCrossTenantRead", () => {
  it("declares the cross-tenant session transaction-scoped and audits it", async () => {
    const result = await withCrossTenantRead("twenty-projection", async () => 3);
    expect(result).toBe(3);
    const statements = query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SELECT set_config('app.cross_tenant', 'projector', true)");
    expect(statements.some((s: string) => s.includes("INSERT INTO context.access_log"))).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("audits with actor_kind cross_tenant, which is what the alert watches for", async () => {
    await withCrossTenantRead("twenty-projection", async () => null);
    const auditCall = query.mock.calls.find((c) => String(c[0]).includes("context.access_log"));
    expect(auditCall?.[1]).toEqual(["cross_tenant", "twenty-projection", "cross_tenant.read"]);
  });

  it("rolls back and releases on failure", async () => {
    await expect(
      withCrossTenantRead("twenty-projection", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(query.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
```

```ts
// ads-agent/lib/db/deletion-requests.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  GRIEVANCE_RESPONSE_DAYS,
  RETENTION_FLOOR_DAYS,
  createDeletionRequest,
  setPropagation,
} from "./deletion-requests";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => query.mockReset());

describe("createDeletionRequest", () => {
  it("sets the retention floor and the grievance deadline from the request date", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "req-1",
          org_id: "org-1",
          subject_kind: "enquirer",
          subject_ref: "enquiry-3",
          requested_at: new Date("2026-08-12T00:00:00.000Z"),
          suppressed_at: null,
          erase_after: new Date("2027-08-12T00:00:00.000Z"),
          erased_at: null,
          respond_by: new Date("2026-11-10T00:00:00.000Z"),
        },
      ],
    });
    const request = await createDeletionRequest(scope, {
      subjectKind: "enquirer",
      subjectRef: "enquiry-3",
    });
    expect(request.id).toBe("req-1");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`now()::date + $4`);
    expect(sql).toContain(`now()::date + $5`);
    expect(params).toEqual([
      "org-1",
      "enquirer",
      "enquiry-3",
      RETENTION_FLOOR_DAYS,
      GRIEVANCE_RESPONSE_DAYS,
    ]);
  });

  it("retains for a year, not zero days", () => {
    expect(RETENTION_FLOOR_DAYS).toBe(365);
    expect(GRIEVANCE_RESPONSE_DAYS).toBe(90);
  });
});

describe("setPropagation", () => {
  it("upserts one row per store so a regulator can see each one", async () => {
    query.mockResolvedValue({ rows: [] });
    await setPropagation(scope, "req-1", "twenty", "suppressed", "person deleted");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO context.deletion_propagations");
    expect(sql).toContain("ON CONFLICT (request_id, store) DO UPDATE");
    expect(params).toEqual(["req-1", "twenty", "suppressed", "person deleted"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/db/access-log.test.ts lib/db/cross-tenant.test.ts lib/db/deletion-requests.test.ts`
Expected: FAIL — three unresolved imports.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/026_compliance_ledger.up.sql
BEGIN;

CREATE TABLE context.deletion_requests (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('enquirer','user','tenant')),
  subject_ref   TEXT NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Access blocked; user-visible "deleted".
  suppressed_at TIMESTAMPTZ,
  -- requested_at + the DPDP Rule 8(3) one-year retention floor.
  erase_after   DATE NOT NULL,
  erased_at     TIMESTAMPTZ,
  -- Rule 14(3): grievance response within 90 days maximum.
  respond_by    DATE NOT NULL
);

CREATE INDEX deletion_requests_org_subject_idx
  ON context.deletion_requests (org_id, subject_kind, subject_ref);
CREATE INDEX deletion_requests_due_idx ON context.deletion_requests (erase_after)
  WHERE erased_at IS NULL;

-- Per-store propagation. Cascading FK deletes prove nothing to a regulator.
CREATE TABLE context.deletion_propagations (
  request_id  UUID NOT NULL REFERENCES context.deletion_requests(id) ON DELETE CASCADE,
  store       TEXT NOT NULL CHECK (store IN
                ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
                 'vector_index','objectstore','langfuse','clickhouse_raw')),
  state       TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','suppressed','erased','failed')),
  detail      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, store)
);

-- No foreign key on org_id: an audit row must survive the deletion of
-- everything it refers to.
CREATE TABLE context.access_log (
  id            UUID NOT NULL DEFAULT uuidv7(),
  org_id        UUID NOT NULL,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('user','agent','system','cross_tenant')),
  actor_ref     TEXT NOT NULL,
  subject_kind  TEXT,
  subject_ref   TEXT,
  action        TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE context.access_log_2026_08 PARTITION OF context.access_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE context.access_log_2026_09 PARTITION OF context.access_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE context.access_log_2026_10 PARTITION OF context.access_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- A missing partition would make an INSERT fail, which would turn an audit
-- gap into an outage. The default partition absorbs anything unrouted; an
-- alert on non-empty default is the signal to add the next month.
CREATE TABLE context.access_log_default PARTITION OF context.access_log DEFAULT;

CREATE INDEX access_log_org_occurred_idx ON context.access_log (org_id, occurred_at DESC);
CREATE INDEX access_log_subject_idx ON context.access_log (org_id, subject_kind, subject_ref);

ALTER TABLE context.deletion_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.deletion_requests     FORCE  ROW LEVEL SECURITY;
ALTER TABLE context.access_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.access_log            FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.deletion_requests
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY cross_tenant_read ON context.deletion_requests
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

CREATE POLICY tenant_isolation ON context.access_log
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- A declared cross-tenant actor has no tenant set, and must still be able to
-- record that it read across tenants. Insert-only: it can write its own audit
-- trail and read nothing.
CREATE POLICY cross_tenant_audit ON context.access_log
  FOR INSERT
  WITH CHECK (current_setting('app.cross_tenant', true) = 'projector');

-- deletion_propagations carries no org_id of its own; it is reachable only
-- through an RLS-protected request row, so it inherits isolation by reference.
COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/026_compliance_ledger.down.sql
BEGIN;
DROP POLICY IF EXISTS cross_tenant_audit ON context.access_log;
DROP POLICY IF EXISTS tenant_isolation   ON context.access_log;
DROP POLICY IF EXISTS cross_tenant_read  ON context.deletion_requests;
DROP POLICY IF EXISTS tenant_isolation   ON context.deletion_requests;
DROP TABLE IF EXISTS context.access_log;
DROP TABLE IF EXISTS context.deletion_propagations;
DROP TABLE IF EXISTS context.deletion_requests;
COMMIT;
```

- [ ] **Step 4: Write `access-log.ts` and `cross-tenant.ts`**

```ts
// ads-agent/lib/db/access-log.ts
import type { PoolClient } from "pg";
import type { Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type ActorKind = "user" | "agent" | "system" | "cross_tenant";

export type AccessLogEntry = {
  actorKind: ActorKind;
  actorRef: string;
  action: string;
  subjectKind?: string | null;
  subjectRef?: string | null;
};

const INSERT = `INSERT INTO context.access_log
  (org_id, actor_kind, actor_ref, subject_kind, subject_ref, action)
  VALUES ($1, $2, $3, $4, $5, $6)`;

/**
 * Rule 6(1)(c) and (e) require access logs retained a year and queryable by
 * tenant, because breach notification has no de-minimis threshold. Passing a
 * client makes the audit row commit in the same transaction as the read it
 * describes, so an audit gap cannot open between the two.
 */
export async function recordAccess(
  scope: Scope,
  entry: AccessLogEntry,
  client?: PoolClient,
): Promise<void> {
  const orgId = orgIdForWrite(scope);
  const params = [
    orgId,
    entry.actorKind,
    entry.actorRef,
    entry.subjectKind ?? null,
    entry.subjectRef ?? null,
    entry.action,
  ];
  if (client) {
    await client.query(INSERT, params);
    return;
  }
  await withTenantTransaction(scope, async (c) => {
    await c.query(INSERT, params);
  });
}
```

```ts
// ads-agent/lib/db/cross-tenant.ts
import type { PoolClient } from "pg";
import { getPool } from "./client";

/**
 * The one way to read across tenants. Sets app.cross_tenant transaction-scoped
 * (third set_config argument) so it cannot leak onto the pooled connection,
 * and writes the audit row the observability alert watches for — any
 * cross-tenant row not attributable to a scheduled job is the isolation
 * boundary being crossed (datastore §12.4).
 *
 * The matching RLS policies are FOR SELECT only, so this session can read
 * every org and write none of them.
 */
export async function withCrossTenantRead<T>(
  actorRef: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.cross_tenant', 'projector', true)");
    await client.query(
      `INSERT INTO context.access_log (org_id, actor_kind, actor_ref, action)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, $3)`,
      ["cross_tenant", actorRef, "cross_tenant.read"],
    );
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
```

The all-zero `org_id` on the cross-tenant audit row is deliberate: the read spans every org, so naming one would be a lie. It is the sentinel the "cross-tenant rows not attributable to a scheduled job" alert filters on.

- [ ] **Step 5: Write `deletion-requests.ts`**

```ts
// ads-agent/lib/db/deletion-requests.ts
import type { PoolClient } from "pg";
import type { Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

/** DPDP Rule 8(3): personal data and processing logs retained at least a year. */
export const RETENTION_FLOOR_DAYS = 365;
/** DPDP Rule 14(3): grievance response within 90 days maximum. */
export const GRIEVANCE_RESPONSE_DAYS = 90;

export type SubjectKind = "enquirer" | "user" | "tenant";
export type PropagationStore =
  | "postgres"
  | "clickhouse"
  | "duckdb_snapshot"
  | "graph"
  | "twenty"
  | "vector_index"
  | "objectstore"
  | "langfuse"
  | "clickhouse_raw";
export type PropagationState = "pending" | "suppressed" | "erased" | "failed";

export type DeletionRequest = {
  id: string;
  orgId: string;
  subjectKind: SubjectKind;
  subjectRef: string;
  requestedAt: string;
  suppressedAt: string | null;
  eraseAfter: string;
  erasedAt: string | null;
  respondBy: string;
};

type RequestRow = {
  id: string;
  org_id: string;
  subject_kind: SubjectKind;
  subject_ref: string;
  requested_at: Date;
  suppressed_at: Date | null;
  erase_after: Date;
  erased_at: Date | null;
  respond_by: Date;
};

const COLUMNS = `id, org_id, subject_kind, subject_ref, requested_at,
                 suppressed_at, erase_after, erased_at, respond_by`;

function rowToRequest(row: RequestRow): DeletionRequest {
  return {
    id: row.id,
    orgId: row.org_id,
    subjectKind: row.subject_kind,
    subjectRef: row.subject_ref,
    requestedAt: row.requested_at.toISOString(),
    suppressedAt: row.suppressed_at?.toISOString() ?? null,
    eraseAfter: row.erase_after.toISOString().slice(0, 10),
    erasedAt: row.erased_at?.toISOString() ?? null,
    respondBy: row.respond_by.toISOString().slice(0, 10),
  };
}

export async function createDeletionRequest(
  scope: Scope,
  input: { subjectKind: SubjectKind; subjectRef: string },
): Promise<DeletionRequest> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RequestRow>(
      `INSERT INTO context.deletion_requests
         (org_id, subject_kind, subject_ref, suppressed_at, erase_after, respond_by)
       VALUES ($1, $2, $3, now(), now()::date + $4, now()::date + $5)
       RETURNING ${COLUMNS}`,
      [orgId, input.subjectKind, input.subjectRef, RETENTION_FLOOR_DAYS, GRIEVANCE_RESPONSE_DAYS],
    );
    return rowToRequest(rows[0]);
  });
}

export async function setPropagation(
  scope: Scope,
  requestId: string,
  store: PropagationStore,
  state: PropagationState,
  detail: string | null = null,
): Promise<void> {
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `INSERT INTO context.deletion_propagations (request_id, store, state, detail)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_id, store) DO UPDATE
         SET state = EXCLUDED.state, detail = EXCLUDED.detail, updated_at = now()`,
      [requestId, store, state, detail],
    );
  });
}

/** Cross-tenant: the sweep runs for every org. Called inside withCrossTenantRead. */
export async function listDueErasures(
  client: PoolClient,
  limit: number,
): Promise<DeletionRequest[]> {
  const { rows } = await client.query<RequestRow>(
    `SELECT ${COLUMNS} FROM context.deletion_requests
      WHERE erased_at IS NULL AND erase_after <= now()::date
      ORDER BY erase_after
      LIMIT $1`,
    [limit],
  );
  return rows.map(rowToRequest);
}

export async function markErased(scope: Scope, requestId: string): Promise<void> {
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE context.deletion_requests SET erased_at = now() WHERE id = $1 AND erased_at IS NULL`,
      [requestId],
    );
  });
}
```

- [ ] **Step 6: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate`
Expected: `ads-agent: schema applied, migrations: 026_compliance_ledger`.

Run: `cd ads-agent && npx vitest run lib/db/access-log.test.ts lib/db/cross-tenant.test.ts lib/db/deletion-requests.test.ts`
Expected: PASS, 8 tests.

Run: `psql "$DATABASE_URL" -c "SELECT relname FROM pg_class WHERE relnamespace = 'context'::regnamespace AND relname LIKE 'access_log%' ORDER BY relname"`
Expected: five rows — parent plus three months plus `access_log_default`.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migrations/026_compliance_ledger.up.sql \
        ads-agent/lib/db/migrations/026_compliance_ledger.down.sql \
        ads-agent/lib/db/access-log.ts ads-agent/lib/db/access-log.test.ts \
        ads-agent/lib/db/cross-tenant.ts ads-agent/lib/db/cross-tenant.test.ts \
        ads-agent/lib/db/deletion-requests.ts ads-agent/lib/db/deletion-requests.test.ts
git commit -m "feat(db): deletion ledger, access log, cross-tenant read helper

DPDP Rule 8(3) requires a one-year retention floor even after account
deletion, so erasure is suppression then scheduled hard delete. The
cross-tenant helper is read-only by policy and audits every use."
```

## Task 6: `adsagent.enquiries` — the spine

**Wave:** S4-B (sequential; every child table depends on it) · **Skills:** `postgres-pro`, `database-designer` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/db/migrations/021_enquiries.up.sql`
- Create: `ads-agent/lib/db/migrations/021_enquiries.down.sql`
- Create: `ads-agent/lib/db/enquiries.ts`
- Create: `ads-agent/lib/db/enquiries.test.ts`
- Create: `ads-agent/lib/db/no-crm-imports.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite`, `withTenantTransaction` (Task 2); `createContact` (Task 3).
- Produces:
  - `type ReplyState = "waiting" | "called" | "closed"`
  - `type Enquiry = { id, orgId, contactId, twentyOpportunityId, listingId, listingUrl, corridorId, replyState, contactName, contactPhone, contactEmail, firstSeenAt, lastActivityAt, lifecycle, createdAt }`
  - `type NewEnquiry = { contactId: string | null; listingId?: string | null; listingUrl?: string | null; contactName: string; contactPhone?: string | null; contactEmail?: string | null }`
  - `createEnquiry(scope, input: NewEnquiry, client?: PoolClient): Promise<Enquiry>`
  - `listEnquiries(scope, opts?: { replyState?: ReplyState; limit?: number }): Promise<Enquiry[]>`
  - `getEnquiryById(scope, id): Promise<Enquiry | null>`
  - `setReplyState(scope, id, replyState): Promise<Enquiry | null>`
  - `touchLastActivity(scope, id, client?): Promise<void>`
  - `setTwentyOpportunityId(scope, id, opportunityId): Promise<void>`
  - `listEnquiriesAwaitingOpportunity(scope, contactId): Promise<Enquiry[]>`
  - `countEnquiriesByState(scope): Promise<Record<ReplyState, number>>`

**Context:** Data model §3, lines 166–214. `reply_state` is deliberately separate from Twenty's pipeline stage: that is a deal stage, this is "does this need me today". `twenty_opportunity_id` is unique **per org**, not globally, because every org has its own Twenty instance issuing its own ids. `contact_id` is nullable so an enquiry can commit even if contact creation is retried.

Two deviations from data model §3, both deliberate and both narrow:

1. **`corridor_id` carries no foreign key.** `public.corridors` does not exist until S7 (attribution). The column exists now so the S7 migration is one `ADD CONSTRAINT` rather than a table rewrite; adding the FK now would fail.
2. **`contact_phone` and `contact_email` are plain `TEXT`.** Data model §6.3 requires them encrypted at rest, and §12 open question 1 — `pgcrypto` in-database versus application-side envelope encryption with GCP KMS — is unresolved. Picking one here would be a design decision disguised as an implementation choice. Recorded in "Deferred" at the end of this plan; the column is `TEXT` and the encryption task is explicitly owed.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/enquiries.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  countEnquiriesByState,
  createEnquiry,
  getEnquiryById,
  listEnquiries,
  setReplyState,
  setTwentyOpportunityId,
} from "./enquiries";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "enq-1",
  org_id: "org-1",
  contact_id: "contact-1",
  twenty_opportunity_id: null,
  listing_id: null,
  listing_url: "https://gentlespace.in/spaces/hsr-1",
  corridor_id: null,
  reply_state: "waiting",
  contact_name: "Asha Rao",
  contact_phone: "+919800000000",
  contact_email: null,
  first_seen_at: new Date("2026-08-12T04:00:00.000Z"),
  last_activity_at: new Date("2026-08-12T04:00:00.000Z"),
  lifecycle: "active",
  created_at: new Date("2026-08-12T04:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createEnquiry", () => {
  it("commits with no Twenty identifier and starts in the waiting state", async () => {
    query.mockResolvedValue({ rows: [row] });
    const enquiry = await createEnquiry(scope, {
      contactId: "contact-1",
      contactName: "Asha Rao",
      contactPhone: "+919800000000",
      listingUrl: "https://gentlespace.in/spaces/hsr-1",
    });
    expect(enquiry.replyState).toBe("waiting");
    expect(enquiry.twentyOpportunityId).toBeNull();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.enquiries");
    // The inserted column list must not mention Twenty at all. It does appear
    // in the RETURNING clause, so assert against the column list specifically.
    const insertedColumns = sql.match(/INSERT INTO adsagent\.enquiries\s*\(([^)]*)\)/)?.[1] ?? "";
    expect(insertedColumns).not.toContain("twenty_opportunity_id");
    expect(params).toEqual([
      "org-1",
      "contact-1",
      null,
      "https://gentlespace.in/spaces/hsr-1",
      "Asha Rao",
      "+919800000000",
      null,
    ]);
  });

  it("refuses platform scope", async () => {
    await expect(
      createEnquiry({ kind: "platform" }, { contactId: null, contactName: "Asha Rao" }),
    ).rejects.toThrow(/platform scope cannot write/i);
  });
});

describe("listEnquiries", () => {
  it("returns only active rows, newest activity first", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listEnquiries(scope);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("lifecycle = 'active'");
    expect(sql).toContain("ORDER BY last_activity_at DESC");
  });

  it("filters by reply state when asked", async () => {
    query.mockResolvedValue({ rows: [] });
    await listEnquiries(scope, { replyState: "called", limit: 10 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("reply_state = $2");
    expect(params).toEqual(["org-1", "called", 10]);
  });
});

describe("getEnquiryById", () => {
  it("returns null for another tenant's id, which the route turns into a 404", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getEnquiryById(scope, "enq-other")).resolves.toBeNull();
  });

  it("hides a suppressed enquiry from ordinary reads", async () => {
    query.mockResolvedValue({ rows: [] });
    await getEnquiryById(scope, "enq-1");
    expect(query.mock.calls[0][0]).toContain("lifecycle = 'active'");
  });
});

describe("setReplyState", () => {
  it("updates the state and the activity clock together", async () => {
    query.mockResolvedValue({ rows: [{ ...row, reply_state: "called" }] });
    const updated = await setReplyState(scope, "enq-1", "called");
    expect(updated?.replyState).toBe("called");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("reply_state = $2");
    expect(sql).toContain("last_activity_at = now()");
    expect(params).toEqual(["org-1", "called", "enq-1"]);
  });
});

describe("setTwentyOpportunityId", () => {
  it("writes back the projection reference", async () => {
    query.mockResolvedValue({ rows: [] });
    await setTwentyOpportunityId(scope, "enq-1", "opp-9");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("twenty_opportunity_id = $2");
    expect(params).toEqual(["org-1", "opp-9", "enq-1"]);
  });
});

describe("countEnquiriesByState", () => {
  it("returns a zero for every state the badge can show", async () => {
    query.mockResolvedValue({ rows: [{ reply_state: "waiting", n: "3" }] });
    await expect(countEnquiriesByState(scope)).resolves.toEqual({
      waiting: 3,
      called: 0,
      closed: 0,
    });
  });
});
```

```ts
// ads-agent/lib/db/no-crm-imports.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The structural reason an enquiry survives Twenty being down: the data layer
 * cannot reach Twenty even by accident. A functional test can be satisfied by a
 * mock; this cannot.
 */
describe("the enquiry data layer never imports the Twenty boundary", () => {
  const files = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it.each(files)("lib/db/%s has no crm import", (file) => {
    const src = readFileSync(join(__dirname, file), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*crm\//);
    expect(src).not.toMatch(/import\(\s*["'][^"']*crm\//);
  });

  it("checks a non-empty set of files", () => {
    expect(files.length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/db/enquiries.test.ts lib/db/no-crm-imports.test.ts`
Expected: `enquiries.test.ts` FAILs with `Failed to resolve import "./enquiries"`; `no-crm-imports.test.ts` PASSes already — it is a regression guard, and it must stay green for the rest of this plan.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/021_enquiries.up.sql
BEGIN;

CREATE TABLE adsagent.enquiries (
  id                    UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id                public.org_ref NOT NULL REFERENCES public.orgs(id),

  -- The enquiry references the local contact row, never a Twenty person id:
  -- Twenty's dedup can merge a person and invalidate its ids, and that
  -- breakage must stay in one table (TW5).
  contact_id            UUID REFERENCES adsagent.contacts(id),

  -- A projection reference, not a key. Unique per org, not globally: every org
  -- has its own Twenty instance issuing its own ids.
  twenty_opportunity_id TEXT,
  CONSTRAINT enquiries_twenty_opportunity_unique UNIQUE (org_id, twenty_opportunity_id),

  listing_id            UUID REFERENCES listings.listings(id),
  listing_url           TEXT,   -- as captured, before resolution

  -- No FK: public.corridors arrives at S7. The column exists now so S7 is one
  -- ADD CONSTRAINT rather than a table rewrite.
  corridor_id           UUID,

  -- Deliberately separate from Twenty's pipeline stage: that is a deal stage,
  -- this is "does this need me today".
  reply_state           TEXT NOT NULL DEFAULT 'waiting'
                          CHECK (reply_state IN ('waiting','called','closed')),

  -- The immutable as-captured submission. adsagent.contacts holds the
  -- Twenty-reconciled cache; these two are not duplicates of each other.
  -- Encryption at rest is owed (data model §6.3, open question 12.1).
  contact_name          TEXT,
  contact_phone         TEXT,
  contact_email         TEXT,

  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  lifecycle             public.lifecycle_state NOT NULL DEFAULT 'active',
  suppressed_at         TIMESTAMPTZ,
  erase_after           DATE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX enquiries_org_activity_idx
  ON adsagent.enquiries (org_id, last_activity_at DESC)
  WHERE lifecycle = 'active';

CREATE INDEX enquiries_org_state_idx
  ON adsagent.enquiries (org_id, reply_state, last_activity_at DESC)
  WHERE lifecycle = 'active';

CREATE INDEX enquiries_org_listing_idx ON adsagent.enquiries (org_id, listing_id);

CREATE INDEX enquiries_org_contact_idx ON adsagent.enquiries (org_id, contact_id);

CREATE INDEX enquiries_erase_idx ON adsagent.enquiries (org_id, erase_after)
  WHERE lifecycle = 'suppressed';

ALTER TABLE adsagent.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiries FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiries
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY cross_tenant_read ON adsagent.enquiries
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/021_enquiries.down.sql
BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON adsagent.enquiries;
DROP POLICY IF EXISTS tenant_isolation  ON adsagent.enquiries;
DROP TABLE IF EXISTS adsagent.enquiries;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/enquiries.ts
import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const REPLY_STATES = ["waiting", "called", "closed"] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export type Enquiry = {
  id: string;
  orgId: string;
  contactId: string | null;
  twentyOpportunityId: string | null;
  listingId: string | null;
  listingUrl: string | null;
  corridorId: string | null;
  replyState: ReplyState;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  firstSeenAt: string;
  lastActivityAt: string;
  lifecycle: "active" | "suppressed" | "erased";
  createdAt: string;
};

export type NewEnquiry = {
  contactId: string | null;
  listingId?: string | null;
  listingUrl?: string | null;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
};

type EnquiryRow = {
  id: string;
  org_id: string;
  contact_id: string | null;
  twenty_opportunity_id: string | null;
  listing_id: string | null;
  listing_url: string | null;
  corridor_id: string | null;
  reply_state: ReplyState;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  first_seen_at: Date;
  last_activity_at: Date;
  lifecycle: "active" | "suppressed" | "erased";
  created_at: Date;
};

const COLUMNS = `id, org_id, contact_id, twenty_opportunity_id, listing_id, listing_url,
                 corridor_id, reply_state, contact_name, contact_phone, contact_email,
                 first_seen_at, last_activity_at, lifecycle, created_at`;

function rowToEnquiry(row: EnquiryRow): Enquiry {
  return {
    id: row.id,
    orgId: row.org_id,
    contactId: row.contact_id,
    twentyOpportunityId: row.twenty_opportunity_id,
    listingId: row.listing_id,
    listingUrl: row.listing_url,
    corridorId: row.corridor_id,
    replyState: row.reply_state,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastActivityAt: row.last_activity_at.toISOString(),
    lifecycle: row.lifecycle,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Commits with no Twenty identifier at all. The opportunity id arrives later
 * from the projection worker, which is what makes a Twenty outage a delay in
 * enrichment rather than a lost enquiry (TW4).
 */
export async function createEnquiry(
  scope: Scope,
  input: NewEnquiry,
  client?: PoolClient,
): Promise<Enquiry> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.enquiries
                 (org_id, contact_id, listing_id, listing_url,
                  contact_name, contact_phone, contact_email)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING ${COLUMNS}`;
  const params = [
    orgId,
    input.contactId,
    input.listingId ?? null,
    input.listingUrl ?? null,
    input.contactName,
    input.contactPhone ?? null,
    input.contactEmail ?? null,
  ];
  if (client) {
    const { rows } = await client.query<EnquiryRow>(sql, params);
    return rowToEnquiry(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(sql, params);
    return rowToEnquiry(rows[0]);
  });
}

export async function listEnquiries(
  scope: Scope,
  opts: { replyState?: ReplyState; limit?: number } = {},
): Promise<Enquiry[]> {
  const clause = scopeClause(scope);
  const params: unknown[] = [...clause.params];
  let where = `${clause.sql} AND lifecycle = 'active'`;
  if (opts.replyState) {
    params.push(opts.replyState);
    where += ` AND reply_state = $${params.length}`;
  }
  params.push(opts.limit ?? 100);
  const limitPlaceholder = `$${params.length}`;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiries
        WHERE ${where}
        ORDER BY last_activity_at DESC
        LIMIT ${limitPlaceholder}`,
      params,
    );
    return rows.map(rowToEnquiry);
  });
}

export async function getEnquiryById(scope: Scope, id: string): Promise<Enquiry | null> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiries
        WHERE ${clause.sql} AND lifecycle = 'active' AND id = $${clause.params.length + 1}`,
      [...clause.params, id],
    );
    return rows[0] ? rowToEnquiry(rows[0]) : null;
  });
}

export async function setReplyState(
  scope: Scope,
  id: string,
  replyState: ReplyState,
): Promise<Enquiry | null> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `UPDATE adsagent.enquiries
          SET reply_state = $${n + 1}, last_activity_at = now(), updated_at = now()
        WHERE ${clause.sql} AND lifecycle = 'active' AND id = $${n + 2}
        RETURNING ${COLUMNS}`,
      [...clause.params, replyState, id],
    );
    return rows[0] ? rowToEnquiry(rows[0]) : null;
  });
}

export async function touchLastActivity(
  scope: Scope,
  id: string,
  client?: PoolClient,
): Promise<void> {
  const clause = scopeClause(scope);
  const sql = `UPDATE adsagent.enquiries
                  SET last_activity_at = now(), updated_at = now()
                WHERE ${clause.sql} AND id = $${clause.params.length + 1}`;
  const params = [...clause.params, id];
  if (client) {
    await client.query(sql, params);
    return;
  }
  await withTenantTransaction(scope, async (c) => {
    await c.query(sql, params);
  });
}

export async function setTwentyOpportunityId(
  scope: Scope,
  id: string,
  opportunityId: string,
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.enquiries
          SET twenty_opportunity_id = $${n + 1}, updated_at = now()
        WHERE ${clause.sql} AND id = $${n + 2}`,
      [...clause.params, opportunityId, id],
    );
  });
}

export async function listEnquiriesAwaitingOpportunity(
  scope: Scope,
  contactId: string,
): Promise<Enquiry[]> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiries
        WHERE ${clause.sql}
          AND lifecycle = 'active'
          AND contact_id = $${clause.params.length + 1}
          AND twenty_opportunity_id IS NULL
        ORDER BY first_seen_at`,
      [...clause.params, contactId],
    );
    return rows.map(rowToEnquiry);
  });
}

/** Backs the Enquiries badge. Always returns every state, so a zero renders. */
export async function countEnquiriesByState(scope: Scope): Promise<Record<ReplyState, number>> {
  const clause = scopeClause(scope);
  const counts: Record<ReplyState, number> = { waiting: 0, called: 0, closed: 0 };
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<{ reply_state: ReplyState; n: string }>(
      `SELECT reply_state, count(*) AS n FROM adsagent.enquiries
        WHERE ${clause.sql} AND lifecycle = 'active'
        GROUP BY reply_state`,
      clause.params,
    );
    for (const row of rows) counts[row.reply_state] = Number(row.n);
    return counts;
  });
}
```

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate`
Expected: `ads-agent: schema applied, migrations: 021_enquiries`.

Run: `cd ads-agent && npx vitest run lib/db/enquiries.test.ts lib/db/no-crm-imports.test.ts`
Expected: PASS, 9 + 2 tests.

Run: `psql "$DATABASE_URL" -c "\d adsagent.enquiries" | grep -c twenty_opportunity_id`
Expected: `2` — the column and its unique constraint.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/migrations/021_enquiries.up.sql \
        ads-agent/lib/db/migrations/021_enquiries.down.sql \
        ads-agent/lib/db/enquiries.ts ads-agent/lib/db/enquiries.test.ts \
        ads-agent/lib/db/no-crm-imports.test.ts
git commit -m "feat(db): adsagent.enquiries, the system of record

The enquiry is the record and Twenty is the projection (BD6 reversed
2026-08-12). It commits with no Twenty identifier, and a static test
asserts no data-layer module can import the Twenty boundary at all."
```

## Task 7: `adsagent.enquiry_messages` — inbound with channel provenance

**Wave:** S4-C · **Skills:** `postgres-pro`, `senior-backend` · **Model:** `composer-2.5-fast`

**Files:**
- Create: `ads-agent/lib/db/migrations/022_enquiry_messages.up.sql`
- Create: `ads-agent/lib/db/migrations/022_enquiry_messages.down.sql`
- Create: `ads-agent/lib/db/enquiry-messages.ts`
- Create: `ads-agent/lib/db/enquiry-messages.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite`, `withTenantTransaction` (Task 2); `adsagent.enquiries` (Task 6).
- Produces:
  - `type MessageChannel = "web_form" | "email" | "whatsapp"`
  - `type EnquiryMessage = { id, orgId, enquiryId, channel, body, externalId, replyToken, isUntrusted, receivedAt }`
  - `addMessage(scope, input: { enquiryId; channel; body; externalId?; replyToken?; receivedAt? }, client?): Promise<EnquiryMessage>`
  - `listMessages(scope, enquiryId, limit?): Promise<EnquiryMessage[]>`

**Context:** Data model §3 lines 218–240. Inbound only — outbound is voice and there is no send path (BD2), which is why `direction` carries `CHECK (direction = 'inbound')` rather than an enum: the constraint documents the decision in the schema. `is_untrusted` defaults true because an enquirer typed it, and an agent reading it must treat it as tainted. `UNIQUE (org_id, channel, external_id)` is what makes a webhook redelivery idempotent at S15.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/enquiry-messages.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { addMessage, listMessages } from "./enquiry-messages";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "msg-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  channel: "web_form",
  body: "Looking for 38 desks in HSR",
  external_id: null,
  reply_token: null,
  is_untrusted: true,
  received_at: new Date("2026-08-12T04:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("addMessage", () => {
  it("records the channel so the screen can label the source", async () => {
    query.mockResolvedValue({ rows: [row] });
    const message = await addMessage(scope, {
      enquiryId: "enq-1",
      channel: "web_form",
      body: "Looking for 38 desks in HSR",
    });
    expect(message.channel).toBe("web_form");
    expect(message.isUntrusted).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.enquiry_messages");
    expect(params).toEqual([
      "org-1",
      "enq-1",
      "web_form",
      "Looking for 38 desks in HSR",
      null,
      null,
      null,
    ]);
  });

  it("is idempotent on a provider message id, so a redelivery is a no-op", async () => {
    query.mockResolvedValue({ rows: [row] });
    await addMessage(scope, {
      enquiryId: "enq-1",
      channel: "email",
      body: "hi",
      externalId: "provider-7",
    });
    expect(query.mock.calls[0][0]).toContain(
      "ON CONFLICT (org_id, channel, external_id) DO UPDATE",
    );
  });

  it("refuses platform scope", async () => {
    await expect(
      addMessage({ kind: "platform" }, { enquiryId: "enq-1", channel: "web_form", body: "hi" }),
    ).rejects.toThrow(/platform scope cannot write/i);
  });
});

describe("listMessages", () => {
  it("returns the thread newest first, scoped to the org", async () => {
    query.mockResolvedValue({ rows: [row] });
    const messages = await listMessages(scope, "enq-1");
    expect(messages).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ORDER BY received_at DESC");
    expect(params).toEqual(["org-1", "enq-1", 200]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/enquiry-messages.test.ts`
Expected: FAIL — `Failed to resolve import "./enquiry-messages"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/022_enquiry_messages.up.sql
BEGIN;

-- Inbound only. Outbound is voice; there is no send path (BD2).
CREATE TABLE adsagent.enquiry_messages (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id     UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  channel        TEXT NOT NULL CHECK (channel IN ('web_form','email','whatsapp')),
  direction      TEXT NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
  body           TEXT NOT NULL,
  external_id    TEXT,   -- provider message id, for dedupe
  reply_token     TEXT,  -- how an inbound email threads back (S15)

  -- Untrusted content. Agents reading this must treat it as tainted.
  is_untrusted   BOOLEAN NOT NULL DEFAULT true,

  received_at    TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT enquiry_messages_external_unique UNIQUE (org_id, channel, external_id)
);

CREATE INDEX enquiry_messages_org_enquiry_idx
  ON adsagent.enquiry_messages (org_id, enquiry_id, received_at DESC);

ALTER TABLE adsagent.enquiry_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_messages FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_messages
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/022_enquiry_messages.down.sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_messages;
DROP TABLE IF EXISTS adsagent.enquiry_messages;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/enquiry-messages.ts
import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const MESSAGE_CHANNELS = ["web_form", "email", "whatsapp"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export type EnquiryMessage = {
  id: string;
  orgId: string;
  enquiryId: string;
  channel: MessageChannel;
  body: string;
  externalId: string | null;
  replyToken: string | null;
  isUntrusted: boolean;
  receivedAt: string;
};

type MessageRow = {
  id: string;
  org_id: string;
  enquiry_id: string;
  channel: MessageChannel;
  body: string;
  external_id: string | null;
  reply_token: string | null;
  is_untrusted: boolean;
  received_at: Date;
};

const COLUMNS = `id, org_id, enquiry_id, channel, body, external_id,
                 reply_token, is_untrusted, received_at`;

function rowToMessage(row: MessageRow): EnquiryMessage {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    channel: row.channel,
    body: row.body,
    externalId: row.external_id,
    replyToken: row.reply_token,
    isUntrusted: row.is_untrusted,
    receivedAt: row.received_at.toISOString(),
  };
}

export async function addMessage(
  scope: Scope,
  input: {
    enquiryId: string;
    channel: MessageChannel;
    body: string;
    externalId?: string | null;
    replyToken?: string | null;
    receivedAt?: string | null;
  },
  client?: PoolClient,
): Promise<EnquiryMessage> {
  const orgId = orgIdForWrite(scope);
  // DO UPDATE rather than DO NOTHING so a redelivery still RETURNINGs a row
  // and the caller does not have to distinguish "new" from "already had it".
  const sql = `INSERT INTO adsagent.enquiry_messages
                 (org_id, enquiry_id, channel, body, external_id, reply_token, received_at)
               VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
               ON CONFLICT (org_id, channel, external_id) DO UPDATE
                 SET body = adsagent.enquiry_messages.body
               RETURNING ${COLUMNS}`;
  const params = [
    orgId,
    input.enquiryId,
    input.channel,
    input.body,
    input.externalId ?? null,
    input.replyToken ?? null,
    input.receivedAt ?? null,
  ];
  if (client) {
    const { rows } = await client.query<MessageRow>(sql, params);
    return rowToMessage(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<MessageRow>(sql, params);
    return rowToMessage(rows[0]);
  });
}

export async function listMessages(
  scope: Scope,
  enquiryId: string,
  limit = 200,
): Promise<EnquiryMessage[]> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<MessageRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiry_messages
        WHERE ${clause.sql} AND enquiry_id = $${n + 1}
        ORDER BY received_at DESC
        LIMIT $${n + 2}`,
      [...clause.params, enquiryId, limit],
    );
    return rows.map(rowToMessage);
  });
}
```

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate && npx vitest run lib/db/enquiry-messages.test.ts lib/db/no-crm-imports.test.ts`
Expected: `migrations: 022_enquiry_messages`; PASS, 4 + 2 tests.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/migrations/022_enquiry_messages.up.sql \
        ads-agent/lib/db/migrations/022_enquiry_messages.down.sql \
        ads-agent/lib/db/enquiry-messages.ts ads-agent/lib/db/enquiry-messages.test.ts
git commit -m "feat(db): adsagent.enquiry_messages with channel provenance

Inbound only, because outbound is voice (BD2). The unique key on
(org_id, channel, external_id) is what makes a webhook redelivery a no-op
when email and WhatsApp land at S15."
```

## Task 8: `adsagent.enquiry_activities` — call logging

**Wave:** S4-C · **Skills:** `postgres-pro`, `senior-backend` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/db/migrations/023_enquiry_activities.up.sql`
- Create: `ads-agent/lib/db/migrations/023_enquiry_activities.down.sql`
- Create: `ads-agent/lib/db/enquiry-activities.ts`
- Create: `ads-agent/lib/db/enquiry-activities.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite`, `withTenantTransaction` (Task 2); `touchLastActivity` (Task 6).
- Produces:
  - `CALL_OUTCOMES` and `type CallOutcome = "spoke_interested" | "spoke_not_interested" | "no_answer" | "voicemail" | "wrong_number" | "callback_requested"`
  - `type ActivityKind = "call" | "note" | "state_change" | "reminder_set"`
  - `type EnquiryActivity = { id, orgId, enquiryId, kind, actorUserId, callOutcome, callDirection, callSeconds, occurredAt, body, syncedToTwentyAt }`
  - `logCall(scope, input: LogCallInput): Promise<EnquiryActivity>`
  - `addNote(scope, input: { enquiryId; actorUserId; body; occurredAt? }): Promise<EnquiryActivity>`
  - `logStateChange(scope, input: { enquiryId; actorUserId; body }): Promise<EnquiryActivity>`
  - `listActivities(scope, enquiryId, limit?): Promise<EnquiryActivity[]>`
  - `claimUnsyncedActivities(client: PoolClient, limit: number): Promise<UnsyncedActivity[]>` — cross-tenant, for Task 12
  - `markActivitySynced(scope, id): Promise<void>`

`LogCallInput = { enquiryId: string; actorUserId: string; outcome: CallOutcome; direction: "outgoing" | "incoming"; seconds: number; occurredAt: string; body?: string | null }`

`UnsyncedActivity = { id: string; orgId: string; enquiryId: string; twentyOpportunityId: string; kind: ActivityKind; body: string | null; callOutcome: CallOutcome | null; callSeconds: number | null; occurredAt: string }`

**Context:** Data model §3 lines 244–268; backend spec C1, C2, C7. This table is precisely what Twenty's API structurally cannot hold: per [twentyhq/twenty#8948](https://github.com/twentyhq/twenty/discussions/8948) custom timeline events cannot be created, and phone calls and SMS specifically cannot be recorded. C2 requires the outcome vocabulary to be a fixed list rather than free text so it can drive reporting. Append-only: there is no update or delete path other than `synced_to_twenty_at`.

`logCall` also advances the enquiry's `last_activity_at`, in the same transaction, because a call that does not move the enquiry up the Today list is a call the broker will make twice.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/enquiry-activities.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  CALL_OUTCOMES,
  addNote,
  listActivities,
  logCall,
  markActivitySynced,
} from "./enquiry-activities";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "act-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  kind: "call",
  actor_user_id: "user-7",
  call_outcome: "spoke_interested",
  call_direction: "outgoing",
  call_seconds: 240,
  occurred_at: new Date("2026-08-12T05:00:00.000Z"),
  body: "Wants a tour on Friday",
  synced_to_twenty_at: null,
};

beforeEach(() => query.mockReset());

describe("the outcome vocabulary", () => {
  it("is a fixed list, so it can drive reporting (C2)", () => {
    expect(CALL_OUTCOMES).toEqual([
      "spoke_interested",
      "spoke_not_interested",
      "no_answer",
      "voicemail",
      "wrong_number",
      "callback_requested",
    ]);
  });
});

describe("logCall", () => {
  it("writes the call and advances the enquiry's activity clock in one transaction", async () => {
    query.mockResolvedValue({ rows: [row] });
    const activity = await logCall(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      outcome: "spoke_interested",
      direction: "outgoing",
      seconds: 240,
      occurredAt: "2026-08-12T05:00:00.000Z",
      body: "Wants a tour on Friday",
    });
    expect(activity.kind).toBe("call");
    expect(activity.syncedToTwentyAt).toBeNull();

    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("INSERT INTO adsagent.enquiry_activities");
    expect(statements[1]).toContain("UPDATE adsagent.enquiries");
    expect(statements[1]).toContain("last_activity_at = now()");
    expect(query.mock.calls[0][1]).toEqual([
      "org-1",
      "enq-1",
      "call",
      "user-7",
      "spoke_interested",
      "outgoing",
      240,
      "2026-08-12T05:00:00.000Z",
      "Wants a tour on Friday",
    ]);
  });

  it("rejects a negative duration before it reaches the database", async () => {
    await expect(
      logCall(scope, {
        enquiryId: "enq-1",
        actorUserId: "user-7",
        outcome: "no_answer",
        direction: "outgoing",
        seconds: -1,
        occurredAt: "2026-08-12T05:00:00.000Z",
      }),
    ).rejects.toThrow(/seconds must be zero or greater/i);
  });

  it("leaves the row unsynced, so the projection worker picks it up (C7)", async () => {
    query.mockResolvedValue({ rows: [row] });
    await logCall(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      outcome: "no_answer",
      direction: "outgoing",
      seconds: 0,
      occurredAt: "2026-08-12T05:00:00.000Z",
    });
    expect(String(query.mock.calls[0][0])).not.toContain("synced_to_twenty_at");
  });
});

describe("addNote", () => {
  it("stores a note with no call fields", async () => {
    query.mockResolvedValue({ rows: [{ ...row, kind: "note", call_outcome: null }] });
    const note = await addNote(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      body: "Sent the shortlist",
    });
    expect(note.kind).toBe("note");
    expect(query.mock.calls[0][1]).toEqual([
      "org-1",
      "enq-1",
      "note",
      "user-7",
      null,
      null,
      null,
      expect.any(String),
      "Sent the shortlist",
    ]);
  });
});

describe("listActivities", () => {
  it("returns the log newest first", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listActivities(scope, "enq-1");
    expect(String(query.mock.calls[0][0])).toContain("ORDER BY occurred_at DESC");
  });
});

describe("markActivitySynced", () => {
  it("stamps the Twenty write-back time", async () => {
    query.mockResolvedValue({ rows: [] });
    await markActivitySynced(scope, "act-1");
    expect(String(query.mock.calls[0][0])).toContain("synced_to_twenty_at = now()");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/enquiry-activities.test.ts`
Expected: FAIL — `Failed to resolve import "./enquiry-activities"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/023_enquiry_activities.up.sql
BEGIN;

-- Append-only. This is what Twenty cannot hold: custom timeline events cannot
-- be created through its API, and phone calls specifically cannot be recorded.
CREATE TABLE adsagent.enquiry_activities (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id     UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  kind           TEXT NOT NULL CHECK (kind IN ('call','note','state_change','reminder_set')),
  actor_user_id  UUID REFERENCES public.users(id),

  -- Call fields, NULL for other kinds. A fixed vocabulary, not free text, so
  -- it can drive reporting (C2).
  call_outcome   TEXT CHECK (call_outcome IN
                   ('spoke_interested','spoke_not_interested','no_answer',
                    'voicemail','wrong_number','callback_requested')),
  call_direction TEXT CHECK (call_direction IN ('outgoing','incoming')),
  call_seconds   INTEGER CHECK (call_seconds >= 0),
  occurred_at    TIMESTAMPTZ NOT NULL,

  body           TEXT,
  synced_to_twenty_at TIMESTAMPTZ,   -- Notes API write-back (C7)

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A call row without an outcome would be a call nobody can report on.
  CONSTRAINT enquiry_activities_call_shape CHECK (
    kind <> 'call' OR (call_outcome IS NOT NULL AND call_direction IS NOT NULL)
  )
);

CREATE INDEX enquiry_activities_org_enquiry_idx
  ON adsagent.enquiry_activities (org_id, enquiry_id, occurred_at DESC);

-- The projection worker's only query. Partial, so it stays small as the log grows.
CREATE INDEX enquiry_activities_unsynced_idx
  ON adsagent.enquiry_activities (created_at)
  WHERE synced_to_twenty_at IS NULL AND kind IN ('call','note');

ALTER TABLE adsagent.enquiry_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_activities FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_activities
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY cross_tenant_read ON adsagent.enquiry_activities
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/023_enquiry_activities.down.sql
BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON adsagent.enquiry_activities;
DROP POLICY IF EXISTS tenant_isolation  ON adsagent.enquiry_activities;
DROP TABLE IF EXISTS adsagent.enquiry_activities;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/enquiry-activities.ts
import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const CALL_OUTCOMES = [
  "spoke_interested",
  "spoke_not_interested",
  "no_answer",
  "voicemail",
  "wrong_number",
  "callback_requested",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export type ActivityKind = "call" | "note" | "state_change" | "reminder_set";

export type EnquiryActivity = {
  id: string;
  orgId: string;
  enquiryId: string;
  kind: ActivityKind;
  actorUserId: string | null;
  callOutcome: CallOutcome | null;
  callDirection: "outgoing" | "incoming" | null;
  callSeconds: number | null;
  occurredAt: string;
  body: string | null;
  syncedToTwentyAt: string | null;
};

export type LogCallInput = {
  enquiryId: string;
  actorUserId: string;
  outcome: CallOutcome;
  direction: "outgoing" | "incoming";
  seconds: number;
  occurredAt: string;
  body?: string | null;
};

type ActivityRow = {
  id: string;
  org_id: string;
  enquiry_id: string;
  kind: ActivityKind;
  actor_user_id: string | null;
  call_outcome: CallOutcome | null;
  call_direction: "outgoing" | "incoming" | null;
  call_seconds: number | null;
  occurred_at: Date;
  body: string | null;
  synced_to_twenty_at: Date | null;
};

const COLUMNS = `id, org_id, enquiry_id, kind, actor_user_id, call_outcome,
                 call_direction, call_seconds, occurred_at, body, synced_to_twenty_at`;

const INSERT = `INSERT INTO adsagent.enquiry_activities
  (org_id, enquiry_id, kind, actor_user_id, call_outcome, call_direction,
   call_seconds, occurred_at, body)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING ${COLUMNS}`;

function rowToActivity(row: ActivityRow): EnquiryActivity {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    kind: row.kind,
    actorUserId: row.actor_user_id,
    callOutcome: row.call_outcome,
    callDirection: row.call_direction,
    callSeconds: row.call_seconds,
    occurredAt: row.occurred_at.toISOString(),
    body: row.body,
    syncedToTwentyAt: row.synced_to_twenty_at?.toISOString() ?? null,
  };
}

/**
 * Writes the call and advances the enquiry's activity clock in one
 * transaction. A logged call that does not move the enquiry up the Today list
 * is a call the broker will make twice.
 */
export async function logCall(scope: Scope, input: LogCallInput): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  if (!Number.isInteger(input.seconds) || input.seconds < 0) {
    throw new Error("logCall: seconds must be zero or greater and a whole number");
  }
  if (!CALL_OUTCOMES.includes(input.outcome)) {
    throw new Error(`logCall: unknown outcome ${input.outcome}`);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "call",
      input.actorUserId,
      input.outcome,
      input.direction,
      input.seconds,
      input.occurredAt,
      input.body ?? null,
    ]);
    await c.query(
      `UPDATE adsagent.enquiries
          SET last_activity_at = now(), updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, input.enquiryId],
    );
    return rowToActivity(rows[0]);
  });
}

export async function addNote(
  scope: Scope,
  input: { enquiryId: string; actorUserId: string; body: string; occurredAt?: string },
): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "note",
      input.actorUserId,
      null,
      null,
      null,
      input.occurredAt ?? new Date().toISOString(),
      input.body,
    ]);
    await c.query(
      `UPDATE adsagent.enquiries
          SET last_activity_at = now(), updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, input.enquiryId],
    );
    return rowToActivity(rows[0]);
  });
}

/** A state change is history, so it is logged rather than only mutated. */
export async function logStateChange(
  scope: Scope,
  input: { enquiryId: string; actorUserId: string; body: string },
): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "state_change",
      input.actorUserId,
      null,
      null,
      null,
      new Date().toISOString(),
      input.body,
    ]);
    return rowToActivity(rows[0]);
  });
}

export async function logReminderSet(
  scope: Scope,
  input: { enquiryId: string; actorUserId: string; body: string },
): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "reminder_set",
      input.actorUserId,
      null,
      null,
      null,
      new Date().toISOString(),
      input.body,
    ]);
    return rowToActivity(rows[0]);
  });
}

export async function listActivities(
  scope: Scope,
  enquiryId: string,
  limit = 200,
): Promise<EnquiryActivity[]> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiry_activities
        WHERE ${clause.sql} AND enquiry_id = $${n + 1}
        ORDER BY occurred_at DESC
        LIMIT $${n + 2}`,
      [...clause.params, enquiryId, limit],
    );
    return rows.map(rowToActivity);
  });
}

export type UnsyncedActivity = {
  id: string;
  orgId: string;
  enquiryId: string;
  twentyOpportunityId: string;
  kind: ActivityKind;
  body: string | null;
  callOutcome: CallOutcome | null;
  callSeconds: number | null;
  occurredAt: string;
};

/**
 * Cross-tenant claim for the projection worker. Only activities whose enquiry
 * already has an opportunity are claimed: a note has nowhere to land until the
 * enquiry itself has been projected, and claiming it early would burn attempts.
 */
export async function claimUnsyncedActivities(
  client: PoolClient,
  limit: number,
): Promise<UnsyncedActivity[]> {
  const { rows } = await client.query<{
    id: string;
    org_id: string;
    enquiry_id: string;
    twenty_opportunity_id: string;
    kind: ActivityKind;
    body: string | null;
    call_outcome: CallOutcome | null;
    call_seconds: number | null;
    occurred_at: Date;
  }>(
    `SELECT a.id, a.org_id, a.enquiry_id, e.twenty_opportunity_id,
            a.kind, a.body, a.call_outcome, a.call_seconds, a.occurred_at
       FROM adsagent.enquiry_activities a
       JOIN adsagent.enquiries e ON e.id = a.enquiry_id AND e.org_id = a.org_id
      WHERE a.synced_to_twenty_at IS NULL
        AND a.kind IN ('call','note')
        AND e.twenty_opportunity_id IS NOT NULL
        AND e.lifecycle = 'active'
      ORDER BY a.created_at
      LIMIT $1
        FOR UPDATE OF a SKIP LOCKED`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    enquiryId: r.enquiry_id,
    twentyOpportunityId: r.twenty_opportunity_id,
    kind: r.kind,
    body: r.body,
    callOutcome: r.call_outcome,
    callSeconds: r.call_seconds,
    occurredAt: r.occurred_at.toISOString(),
  }));
}

export async function markActivitySynced(scope: Scope, id: string): Promise<void> {
  const clause = scopeClause(scope);
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.enquiry_activities
          SET synced_to_twenty_at = now()
        WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
      [...clause.params, id],
    );
  });
}
```

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate && npx vitest run lib/db/enquiry-activities.test.ts lib/db/no-crm-imports.test.ts`
Expected: `migrations: 023_enquiry_activities`; PASS, 7 + 2 tests.

- [ ] **Step 6: Prove the call-shape constraint bites**

Run:

```bash
psql "$DATABASE_URL" -c "SELECT public.set_tenant((SELECT id FROM public.orgs LIMIT 1))" \
  -c "INSERT INTO adsagent.enquiry_activities (org_id, enquiry_id, kind, occurred_at)
      SELECT id, gen_random_uuid(), 'call', now() FROM public.orgs LIMIT 1"
```

Expected: `ERROR: new row for relation "enquiry_activities" violates check constraint "enquiry_activities_call_shape"` (or a foreign-key error on `enquiry_id` first — either proves the write is refused).

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migrations/023_enquiry_activities.up.sql \
        ads-agent/lib/db/migrations/023_enquiry_activities.down.sql \
        ads-agent/lib/db/enquiry-activities.ts ads-agent/lib/db/enquiry-activities.test.ts
git commit -m "feat(db): adsagent.enquiry_activities, append-only call log

Call logging is exactly what Twenty's API cannot hold (twentyhq/twenty#8948)
and it is the core loop, so it lives here. The outcome vocabulary is a fixed
list so it can drive reporting."
```

## Task 9: `adsagent.enquiry_requirements` and revisions

**Wave:** S4-C · **Skills:** `postgres-pro`, `database-designer` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/db/migrations/024_enquiry_requirements.up.sql`
- Create: `ads-agent/lib/db/migrations/024_enquiry_requirements.down.sql`
- Create: `ads-agent/lib/db/enquiry-requirements.ts`
- Create: `ads-agent/lib/db/enquiry-requirements.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite`, `withTenantTransaction` (Task 2).
- Produces:
  - `type Requirement = { enquiryId, orgId, desksMin, desksMax, budgetPerDeskInr, moveInBy, mustHaves, updatedAt }`
  - `type RequirementPatch = { desksMin?: number | null; desksMax?: number | null; budgetPerDeskInr?: number | null; moveInBy?: string | null; mustHaves?: string[] }`
  - `type RevisionSource = "web_form" | "call_notes" | "manual" | "agent"`
  - `type RequirementRevision = { id, orgId, enquiryId, source, proposed, applied, confirmedBy, confirmedAt, createdAt }`
  - `getRequirement(scope, enquiryId): Promise<Requirement | null>`
  - `upsertRequirement(scope, enquiryId, patch: RequirementPatch, client?): Promise<Requirement>`
  - `createRevision(scope, input: { enquiryId; source: RevisionSource; proposed: RequirementPatch }, client?): Promise<RequirementRevision>`
  - `listPendingRevisions(scope, enquiryId): Promise<RequirementRevision[]>`
  - `applyRevision(scope, revisionId, confirmedBy): Promise<Requirement | null>`

**Context:** Data model §3 lines 272–301; backend spec A4 and C3. A4 is load-bearing for the log-call screen's extraction panel: "Desks 35–40 → 38" needs somewhere to write to and a revision trail so the change is reversible. C3 requires extraction to *propose*, never apply: the screen shows chips and an explicit "Update the requirement" button, and the backend contract mirrors that with a pending-diff record. `applyRevision` is the only function that writes the current requirement from a revision, and it requires a `confirmedBy` user id — so an unattended process cannot apply one.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/enquiry-requirements.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  applyRevision,
  createRevision,
  getRequirement,
  listPendingRevisions,
  upsertRequirement,
} from "./enquiry-requirements";

const scope = { kind: "org", orgId: "org-1" } as const;

const requirementRow = {
  enquiry_id: "enq-1",
  org_id: "org-1",
  desks_min: 35,
  desks_max: 40,
  budget_per_desk_inr: "9500.00",
  move_in_by: new Date("2026-09-01T00:00:00.000Z"),
  must_haves: ["metro walkable"],
  updated_at: new Date("2026-08-12T06:00:00.000Z"),
};

const revisionRow = {
  id: "rev-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  source: "call_notes",
  proposed: { desksMin: 38, desksMax: 38 },
  applied: false,
  confirmed_by: null,
  confirmed_at: null,
  created_at: new Date("2026-08-12T06:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("getRequirement", () => {
  it("maps numerics to numbers and the date to an ISO day", async () => {
    query.mockResolvedValue({ rows: [requirementRow] });
    await expect(getRequirement(scope, "enq-1")).resolves.toEqual({
      enquiryId: "enq-1",
      orgId: "org-1",
      desksMin: 35,
      desksMax: 40,
      budgetPerDeskInr: 9500,
      moveInBy: "2026-09-01",
      mustHaves: ["metro walkable"],
      updatedAt: "2026-08-12T06:00:00.000Z",
    });
  });

  it("returns null when the enquiry has no requirement yet", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getRequirement(scope, "enq-2")).resolves.toBeNull();
  });
});

describe("upsertRequirement", () => {
  it("upserts on enquiry_id and leaves omitted fields alone", async () => {
    query.mockResolvedValue({ rows: [requirementRow] });
    await upsertRequirement(scope, "enq-1", { desksMin: 38 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (enquiry_id) DO UPDATE");
    expect(sql).toContain("COALESCE");
    expect(params).toEqual(["org-1", "enq-1", 38, null, null, null, null]);
  });
});

describe("createRevision", () => {
  it("records a proposal that is not applied", async () => {
    query.mockResolvedValue({ rows: [revisionRow] });
    const revision = await createRevision(scope, {
      enquiryId: "enq-1",
      source: "call_notes",
      proposed: { desksMin: 38, desksMax: 38 },
    });
    expect(revision.applied).toBe(false);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.enquiry_requirement_revisions");
    expect(sql).not.toContain("applied = true");
    expect(params).toEqual([
      "org-1",
      "enq-1",
      "call_notes",
      JSON.stringify({ desksMin: 38, desksMax: 38 }),
    ]);
  });
});

describe("listPendingRevisions", () => {
  it("returns only unapplied proposals", async () => {
    query.mockResolvedValue({ rows: [revisionRow] });
    await listPendingRevisions(scope, "enq-1");
    expect(String(query.mock.calls[0][0])).toContain("applied = false");
  });
});

describe("applyRevision", () => {
  it("requires a confirming user, so nothing auto-applies (C3)", async () => {
    await expect(applyRevision(scope, "rev-1", "")).rejects.toThrow(/confirmedBy is required/i);
  });

  it("marks the revision applied and writes the requirement in one transaction", async () => {
    query
      .mockResolvedValueOnce({ rows: [revisionRow] })
      .mockResolvedValueOnce({ rows: [requirementRow] })
      .mockResolvedValueOnce({ rows: [] });
    const applied = await applyRevision(scope, "rev-1", "user-7");
    expect(applied?.desksMin).toBe(35);
    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("SELECT");
    expect(statements[1]).toContain("INSERT INTO adsagent.enquiry_requirements");
    expect(statements[2]).toContain("applied = true");
    expect(query.mock.calls[2][1]).toEqual(["org-1", "rev-1", "user-7"]);
  });

  it("returns null for an already-applied revision rather than applying it twice", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(applyRevision(scope, "rev-1", "user-7")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/enquiry-requirements.test.ts`
Expected: FAIL — `Failed to resolve import "./enquiry-requirements"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/024_enquiry_requirements.up.sql
BEGIN;

-- Current requirement. Revisions carry the audit trail.
CREATE TABLE adsagent.enquiry_requirements (
  enquiry_id          UUID PRIMARY KEY REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  org_id              public.org_ref NOT NULL REFERENCES public.orgs(id),

  desks_min           INTEGER CHECK (desks_min > 0),
  desks_max           INTEGER CHECK (desks_max >= desks_min),
  budget_per_desk_inr NUMERIC(12,2) CHECK (budget_per_desk_inr >= 0),
  move_in_by          DATE,
  must_haves          TEXT[] NOT NULL DEFAULT '{}',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX enquiry_requirements_org_idx ON adsagent.enquiry_requirements (org_id);

-- Extraction proposes; a human confirms. Never auto-applied (C3).
CREATE TABLE adsagent.enquiry_requirement_revisions (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id    UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  source        TEXT NOT NULL CHECK (source IN ('web_form','call_notes','manual','agent')),
  proposed      JSONB NOT NULL,
  applied       BOOLEAN NOT NULL DEFAULT false,
  confirmed_by  UUID REFERENCES public.users(id),
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An applied revision with no confirming human would defeat the whole point.
  CONSTRAINT requirement_revision_confirmed CHECK (
    applied = false OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

CREATE INDEX req_revision_pending_idx
  ON adsagent.enquiry_requirement_revisions (org_id, enquiry_id)
  WHERE applied = false;

ALTER TABLE adsagent.enquiry_requirements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_requirements          FORCE  ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_requirement_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_requirement_revisions FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_requirements
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY tenant_isolation ON adsagent.enquiry_requirement_revisions
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/024_enquiry_requirements.down.sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_requirement_revisions;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_requirements;
DROP TABLE IF EXISTS adsagent.enquiry_requirement_revisions;
DROP TABLE IF EXISTS adsagent.enquiry_requirements;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/enquiry-requirements.ts
import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type Requirement = {
  enquiryId: string;
  orgId: string;
  desksMin: number | null;
  desksMax: number | null;
  budgetPerDeskInr: number | null;
  moveInBy: string | null;
  mustHaves: string[];
  updatedAt: string;
};

export type RequirementPatch = {
  desksMin?: number | null;
  desksMax?: number | null;
  budgetPerDeskInr?: number | null;
  moveInBy?: string | null;
  mustHaves?: string[];
};

export type RevisionSource = "web_form" | "call_notes" | "manual" | "agent";

export type RequirementRevision = {
  id: string;
  orgId: string;
  enquiryId: string;
  source: RevisionSource;
  proposed: RequirementPatch;
  applied: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

type RequirementRow = {
  enquiry_id: string;
  org_id: string;
  desks_min: number | null;
  desks_max: number | null;
  budget_per_desk_inr: string | null;
  move_in_by: Date | null;
  must_haves: string[];
  updated_at: Date;
};

type RevisionRow = {
  id: string;
  org_id: string;
  enquiry_id: string;
  source: RevisionSource;
  proposed: RequirementPatch;
  applied: boolean;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  created_at: Date;
};

const REQ_COLUMNS = `enquiry_id, org_id, desks_min, desks_max,
                     budget_per_desk_inr, move_in_by, must_haves, updated_at`;
const REV_COLUMNS = `id, org_id, enquiry_id, source, proposed, applied,
                     confirmed_by, confirmed_at, created_at`;

function rowToRequirement(row: RequirementRow): Requirement {
  return {
    enquiryId: row.enquiry_id,
    orgId: row.org_id,
    desksMin: row.desks_min,
    desksMax: row.desks_max,
    budgetPerDeskInr: row.budget_per_desk_inr === null ? null : Number(row.budget_per_desk_inr),
    moveInBy: row.move_in_by ? row.move_in_by.toISOString().slice(0, 10) : null,
    mustHaves: row.must_haves,
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToRevision(row: RevisionRow): RequirementRevision {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    source: row.source,
    proposed: row.proposed,
    applied: row.applied,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

const UPSERT = `INSERT INTO adsagent.enquiry_requirements
  (org_id, enquiry_id, desks_min, desks_max, budget_per_desk_inr, move_in_by, must_haves)
  VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::text[], '{}'))
  ON CONFLICT (enquiry_id) DO UPDATE
    SET desks_min           = COALESCE(EXCLUDED.desks_min,
                                       adsagent.enquiry_requirements.desks_min),
        desks_max           = COALESCE(EXCLUDED.desks_max,
                                       adsagent.enquiry_requirements.desks_max),
        budget_per_desk_inr = COALESCE(EXCLUDED.budget_per_desk_inr,
                                       adsagent.enquiry_requirements.budget_per_desk_inr),
        move_in_by          = COALESCE(EXCLUDED.move_in_by,
                                       adsagent.enquiry_requirements.move_in_by),
        must_haves          = CASE WHEN cardinality(EXCLUDED.must_haves) > 0
                                   THEN EXCLUDED.must_haves
                                   ELSE adsagent.enquiry_requirements.must_haves END,
        updated_at          = now()
  RETURNING ${REQ_COLUMNS}`;

function upsertParams(orgId: string, enquiryId: string, patch: RequirementPatch): unknown[] {
  return [
    orgId,
    enquiryId,
    patch.desksMin ?? null,
    patch.desksMax ?? null,
    patch.budgetPerDeskInr ?? null,
    patch.moveInBy ?? null,
    patch.mustHaves ?? null,
  ];
}

export async function getRequirement(
  scope: Scope,
  enquiryId: string,
): Promise<Requirement | null> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RequirementRow>(
      `SELECT ${REQ_COLUMNS} FROM adsagent.enquiry_requirements
        WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1}`,
      [...clause.params, enquiryId],
    );
    return rows[0] ? rowToRequirement(rows[0]) : null;
  });
}

export async function upsertRequirement(
  scope: Scope,
  enquiryId: string,
  patch: RequirementPatch,
  client?: PoolClient,
): Promise<Requirement> {
  const orgId = orgIdForWrite(scope);
  const params = upsertParams(orgId, enquiryId, patch);
  if (client) {
    const { rows } = await client.query<RequirementRow>(UPSERT, params);
    return rowToRequirement(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RequirementRow>(UPSERT, params);
    return rowToRequirement(rows[0]);
  });
}

export async function createRevision(
  scope: Scope,
  input: { enquiryId: string; source: RevisionSource; proposed: RequirementPatch },
  client?: PoolClient,
): Promise<RequirementRevision> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.enquiry_requirement_revisions
                 (org_id, enquiry_id, source, proposed)
               VALUES ($1, $2, $3, $4::jsonb)
               RETURNING ${REV_COLUMNS}`;
  const params = [orgId, input.enquiryId, input.source, JSON.stringify(input.proposed)];
  if (client) {
    const { rows } = await client.query<RevisionRow>(sql, params);
    return rowToRevision(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RevisionRow>(sql, params);
    return rowToRevision(rows[0]);
  });
}

export async function listPendingRevisions(
  scope: Scope,
  enquiryId: string,
): Promise<RequirementRevision[]> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RevisionRow>(
      `SELECT ${REV_COLUMNS} FROM adsagent.enquiry_requirement_revisions
        WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1} AND applied = false
        ORDER BY created_at DESC`,
      [...clause.params, enquiryId],
    );
    return rows.map(rowToRevision);
  });
}

/**
 * The only path from a proposal to the live requirement, and it demands a
 * confirming user id. Extraction cannot reach the requirement without a human
 * pressing the button (C3).
 */
export async function applyRevision(
  scope: Scope,
  revisionId: string,
  confirmedBy: string,
): Promise<Requirement | null> {
  const orgId = orgIdForWrite(scope);
  if (!confirmedBy) throw new Error("applyRevision: confirmedBy is required");
  return withTenantTransaction(scope, async (c) => {
    const found = await c.query<RevisionRow>(
      `SELECT ${REV_COLUMNS} FROM adsagent.enquiry_requirement_revisions
        WHERE org_id = $1 AND id = $2 AND applied = false
          FOR UPDATE`,
      [orgId, revisionId],
    );
    const revision = found.rows[0];
    if (!revision) return null;

    const upserted = await c.query<RequirementRow>(
      UPSERT,
      upsertParams(orgId, revision.enquiry_id, revision.proposed),
    );
    await c.query(
      `UPDATE adsagent.enquiry_requirement_revisions
          SET applied = true, confirmed_by = $3, confirmed_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, revisionId, confirmedBy],
    );
    return rowToRequirement(upserted.rows[0]);
  });
}
```

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate && npx vitest run lib/db/enquiry-requirements.test.ts lib/db/no-crm-imports.test.ts`
Expected: `migrations: 024_enquiry_requirements`; PASS, 8 + 2 tests.

- [ ] **Step 6: Prove a revision cannot be applied without a human**

Run:

```bash
psql "$DATABASE_URL" -c "SELECT public.set_tenant((SELECT id FROM public.orgs LIMIT 1))" \
  -c "UPDATE adsagent.enquiry_requirement_revisions SET applied = true WHERE applied = false"
```

Expected: `ERROR: new row for relation "enquiry_requirement_revisions" violates check constraint "requirement_revision_confirmed"` when any pending revision exists, or `UPDATE 0` on an empty table. Seed one pending revision first if the table is empty.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migrations/024_enquiry_requirements.up.sql \
        ads-agent/lib/db/migrations/024_enquiry_requirements.down.sql \
        ads-agent/lib/db/enquiry-requirements.ts ads-agent/lib/db/enquiry-requirements.test.ts
git commit -m "feat(db): enquiry requirements with a revision trail

The log-call screen's 'Desks 35-40 -> 38' needs somewhere to write and a
reversible trail. Extraction proposes and a human confirms: an applied
revision without a confirming user violates a check constraint."
```

## Task 10: Twenty client consolidation — both code paths

**Wave:** S4-D · **Skills:** `refactoring-specialist`, `typescript-pro`, `security-auditor` · **Model:** `inherit`

**This is the largest task in the plan. Dispatch it first in its wave so its worktree has the longest runway.** It is the only task anywhere in this plan that modifies `ads-agent/lib/decision-engine/cycle.ts`.

**Files:**
- Create: `ads-agent/lib/crm/twenty-client.ts`
- Create: `ads-agent/lib/crm/twenty-client.test.ts`
- Create: `ads-agent/lib/crm/twenty-secrets.ts`
- Create: `ads-agent/lib/auth/scope.ts`
- Modify: `ads-agent/lib/crm/twenty-pipeline.ts:1-4, 54-56, 164-214`
- Modify: `ads-agent/lib/crm/twenty-pipeline.test.ts`
- Delete: `ads-agent/lib/connectors/twenty.ts`
- Modify: `ads-agent/app/(admin)/page.tsx:1-23`
- Modify: `ads-agent/app/(admin)/crm/page.tsx:26-30`
- Modify: `ads-agent/app/api/crm/opportunities/[id]/stage/route.ts:8-23`
- Modify: `ads-agent/lib/decision-engine/cycle.ts:7, 24-31`
- Modify: `ads-agent/lib/openui/crm-tools.ts:40-65`
- Modify: `ads-agent/lib/openui/crm-tools.test.ts`
- Modify: `ads-agent/lib/openui/platform-tools.ts:36`
- Modify: `ads-agent/app/api/openui/tools/route.ts:3`
- Modify: `ads-agent/mcp/app-data-mcp-server/index.ts:5`

**Interfaces:**
- Consumes: `getTwentyConnection`, `setTwentyConnectionState` (Task 4); `type Scope` (S3); `getSession` from `ads-agent/lib/auth/dal.ts:50`.
- Produces:
  - `getTwentyClient(orgId: string): Promise<TwentyClient>` — throws when the connection is absent, not `active`, or blocked by the interim guard
  - `type TwentyClient = { orgId; version; upsertPerson; createOpportunity; updateOpportunityStage; createNote; listOpportunities; getOpportunity }`
  - `resolveTwentyApiKey(apiKeyRef: string): Promise<string>`
  - `scopeFromSession(): Promise<Scope>` in `lib/auth/scope.ts`
  - `fetchLeadSignal(scope: Scope)`, `listOpportunities(scope)`, `getOpportunity(scope, id)`, `updateOpportunityStage(scope, id, stage)`, `getPipelineValue(scope)` — all in `twenty-pipeline.ts`
  - `createCrmToolProvider(scope: Scope): ToolProviderMap`, `createPlatformToolProvider(scope: Scope): ToolProviderMap`

**Context:** Twenty tenancy spec §6. Today there are **three** ways to reach Twenty, all process-wide singletons: `lib/crm/twenty.ts` and `ads-agent/lib/connectors/twenty.ts` each carry a duplicate `baseUrl()` reading `TWENTY_BASE_URL`, and `ads-agent/lib/bifrost/twenty-mcp-tools.ts` points at a sidecar on `TWENTY_MCP_URL`. None can become tenant-aware as written.

This task collapses the ads-agent side onto one resolver. `connectors/twenty.ts` is **deleted** — its single function `fetchLeadSignal` moves into `twenty-pipeline.ts` on the resolving client, which is the smallest possible diff that removes a duplicate `baseUrl()`. The root app's `lib/crm/twenty.ts` is deleted by Task 14, where the inversion makes it dead code rather than something to port.

`twenty-pipeline.ts` currently reaches Twenty through the MCP sidecar (`callTwentyTool`). After this task it uses Twenty's REST API through the resolver. `ads-agent/lib/bifrost/twenty-mcp-tools.ts` and `mcp-client.ts` are **not** deleted: `lib/openui/resolve-tools-then-generate.ts` still imports `TWENTY_MCP_READ_TOOL_NAMES`, `callTwentyTool` and `listTwentyTools` to build the model's tool schemas, and the sidecar's removal is S9 work per tenancy spec §12. `reshapeTwentyOpportunityToolResult` keeps its current signature and its `TWENTY_MCP_TOOLS` switch, so `resolve-tools-then-generate.ts` needs no change at all.

`createCrmToolProvider` / `createPlatformToolProvider` may already exist as factories if S3's `ai-action-log` conversion (unit U7) forced them; if so, this task only threads the Twenty calls through the scope the factory already has, and the factory rename below is a no-op the implementer skips.

**The interim platform-only guard moves into the new client.** It is not deleted here. Task 24 removes it, gated on the coverage check.

- [ ] **Step 1: Write the failing test for the resolver**

```ts
// ads-agent/lib/crm/twenty-client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getTwentyConnection = vi.fn();
vi.mock("../db/twenty-connections", () => ({ getTwentyConnection }));
vi.mock("./twenty-secrets", () => ({ resolveTwentyApiKey: async () => "test-key" }));

import { getTwentyClient } from "./twenty-client";

const active = {
  orgId: "org-1",
  baseUrl: "https://crm-org-1.gentlespace.in",
  apiKeyRef: "secret://twenty/org-1",
  coolifyServiceUuid: "svc-abc",
  twentyVersion: "1.9.0",
  state: "active" as const,
  provisionedAt: "2026-08-12T00:00:00.000Z",
  lastSyncAt: null,
  lastError: null,
};

beforeEach(() => {
  getTwentyConnection.mockReset();
  process.env.PLATFORM_ORG_ID = "org-platform";
  process.env.SHARED_TWENTY_BASE_URL = "https://crm.gentlespace.in";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTwentyClient", () => {
  it("throws when the org has no instance, rather than returning an empty client", async () => {
    getTwentyConnection.mockResolvedValue(null);
    await expect(getTwentyClient("org-2")).rejects.toThrow(/no Twenty connection/i);
  });

  it("throws when the instance is suspended", async () => {
    getTwentyConnection.mockResolvedValue({ ...active, state: "suspended" });
    await expect(getTwentyClient("org-1")).rejects.toThrow(/state suspended/i);
  });

  it("refuses a non-platform org pointed at the contaminated shared instance", async () => {
    getTwentyConnection.mockResolvedValue({ ...active, baseUrl: "https://crm.gentlespace.in" });
    await expect(getTwentyClient("org-1")).rejects.toThrow(/interim platform-only guard/i);
  });

  it("allows the platform org on the shared instance while the guard stands", async () => {
    getTwentyConnection.mockResolvedValue({
      ...active,
      orgId: "org-platform",
      baseUrl: "https://crm.gentlespace.in",
    });
    const client = await getTwentyClient("org-platform");
    expect(client.orgId).toBe("org-platform");
  });

  it("binds requests to that org's base url and key", async () => {
    getTwentyConnection.mockResolvedValue(active);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "person-9" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = await getTwentyClient("org-1");
    const person = await client.upsertPerson({ firstName: "Asha", lastName: "Rao", phone: "+919800000000" });

    expect(person.id).toBe("person-9");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://crm-org-1.gentlespace.in/rest/people");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("surfaces a Twenty error as a throw, so a caller cannot mistake it for empty data", async () => {
    getTwentyConnection.mockResolvedValue(active);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream boom", { status: 502 })),
    );
    const client = await getTwentyClient("org-1");
    await expect(client.getOpportunity("opp-1")).rejects.toThrow(/502/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-client.test.ts`
Expected: FAIL — `Failed to resolve import "./twenty-client"`.

- [ ] **Step 3: Write the secret seam and the resolver**

```ts
// ads-agent/lib/crm/twenty-secrets.ts
/**
 * One seam for open question B4 (which secret store backs api_key_ref). The
 * registry stores a reference, never a key, so replacing this function is the
 * whole change when B4 is answered.
 *
 * Supported today: "env://VAR_NAME", read from the process environment.
 */
export async function resolveTwentyApiKey(apiKeyRef: string): Promise<string> {
  if (apiKeyRef.startsWith("env://")) {
    const name = apiKeyRef.slice("env://".length);
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`twenty: secret ${apiKeyRef} is not set`);
    return value;
  }
  throw new Error(
    `twenty: unsupported api_key_ref scheme "${apiKeyRef}" — see open question B4`,
  );
}
```

```ts
// ads-agent/lib/crm/twenty-client.ts
import { getTwentyConnection } from "../db/twenty-connections";
import { resolveTwentyApiKey } from "./twenty-secrets";

export type TwentyPersonInput = {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
};

export type TwentyPerson = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
};

export type TwentyOpportunityInput = {
  name: string;
  personId: string;
  stage: string;
  listingUrl?: string | null;
  listingName?: string | null;
};

export type TwentyClient = {
  orgId: string;
  version: string;
  upsertPerson(input: TwentyPersonInput): Promise<TwentyPerson>;
  createOpportunity(input: TwentyOpportunityInput): Promise<{ id: string }>;
  updateOpportunityStage(id: string, stage: string): Promise<void>;
  createNote(opportunityId: string, body: string): Promise<{ id: string }>;
  listOpportunities(limit?: number): Promise<unknown>;
  getOpportunity(id: string): Promise<unknown>;
};

function extractId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const rec = json as Record<string, unknown>;
  if (typeof rec.id === "string") return rec.id;
  const data = rec.data;
  if (!data || typeof data !== "object") return undefined;
  const dataRec = data as Record<string, unknown>;
  if (typeof dataRec.id === "string") return dataRec.id;
  // Twenty REST wraps creates as { data: { createPerson|createOpportunity: { id } } }
  for (const value of Object.values(dataRec)) {
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
      return (value as { id: string }).id;
    }
  }
  return undefined;
}

function splitIndianPhone(phone: string | null | undefined): Record<string, unknown> | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, "");
  return {
    primaryPhoneNumber: digits.replace(/^\+?91/, "").replace(/^\+/, "") || digits,
    primaryPhoneCountryCode: "IN",
    primaryPhoneCallingCode: "+91",
  };
}

/**
 * The interim containment from the tenancy spec's Q4 resolution. Twenty's
 * deduplication has already merged contacts across tenant lines in the shared
 * instance, so no org except the platform may touch it. Removed by Task 24
 * once every org has its own instance — not before.
 */
function assertNotSharedInstance(orgId: string, baseUrl: string): void {
  const shared = process.env.SHARED_TWENTY_BASE_URL?.replace(/\/$/, "");
  if (!shared) return;
  if (baseUrl.replace(/\/$/, "") !== shared) return;
  if (orgId === process.env.PLATFORM_ORG_ID) return;
  throw new Error(
    `twenty: interim platform-only guard — org ${orgId} would reach the shared instance, ` +
      `whose contacts are merged across tenants and cannot be separated`,
  );
}

/**
 * The only constructor. Constructing a Twenty client any other way is the
 * equivalent of a missing scopeClause. It throws rather than returning an
 * empty result, because an empty result is indistinguishable from a customer
 * with no contacts, which is how a leak hides (tenancy spec §6).
 */
export async function getTwentyClient(orgId: string): Promise<TwentyClient> {
  const connection = await getTwentyConnection(orgId);
  if (!connection) throw new Error(`twenty: no Twenty connection for org ${orgId}`);
  if (connection.state !== "active") {
    throw new Error(`twenty: connection for org ${orgId} is in state ${connection.state}`);
  }
  assertNotSharedInstance(orgId, connection.baseUrl);

  const base = connection.baseUrl.replace(/\/$/, "");
  const key = await resolveTwentyApiKey(connection.apiKeyRef);

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`twenty ${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`twenty ${method} ${path}: response was not JSON`);
    }
  }

  return {
    orgId,
    version: connection.twentyVersion,

    async upsertPerson(input) {
      const json = await request("POST", "/rest/people", {
        name: { firstName: input.firstName, lastName: input.lastName || "-" },
        ...(splitIndianPhone(input.phone) ? { phones: splitIndianPhone(input.phone) } : {}),
        ...(input.email ? { emails: { primaryEmail: input.email } } : {}),
      });
      const id = extractId(json);
      if (!id) throw new Error("twenty POST /rest/people: missing id in response");
      // Twenty's response is authoritative: its dedup may have merged this
      // person into an existing one, and the merged result is the truth (§3).
      const record = (json as { data?: Record<string, unknown> }).data ?? {};
      const name = (record.name ?? {}) as { firstName?: string; lastName?: string };
      const phones = (record.phones ?? {}) as { primaryPhoneNumber?: string };
      const emails = (record.emails ?? {}) as { primaryEmail?: string };
      return {
        id,
        firstName: name.firstName ?? input.firstName,
        lastName: name.lastName ?? input.lastName,
        phone: phones.primaryPhoneNumber ?? input.phone ?? null,
        email: emails.primaryEmail ?? input.email ?? null,
      };
    },

    async createOpportunity(input) {
      const json = await request("POST", "/rest/opportunities", {
        name: input.name.slice(0, 120),
        pointOfContactId: input.personId,
        stage: input.stage,
        ...(input.listingUrl ? { listingUrl: input.listingUrl } : {}),
        ...(input.listingName ? { listingName: input.listingName } : {}),
      });
      const id = extractId(json);
      if (!id) throw new Error("twenty POST /rest/opportunities: missing id in response");
      return { id };
    },

    async updateOpportunityStage(id, stage) {
      await request("PATCH", `/rest/opportunities/${encodeURIComponent(id)}`, { stage });
    },

    async createNote(opportunityId, body) {
      const json = await request("POST", "/rest/notes", {
        title: body.split("\n")[0]?.slice(0, 80) || "Activity",
        bodyV2: { markdown: body },
        noteTargets: [{ opportunityId }],
      });
      const id = extractId(json);
      if (!id) throw new Error("twenty POST /rest/notes: missing id in response");
      return { id };
    },

    async listOpportunities(limit = 200) {
      return request("GET", `/rest/opportunities?limit=${limit}`);
    },

    async getOpportunity(id) {
      return request("GET", `/rest/opportunities/${encodeURIComponent(id)}`);
    },
  };
}
```

- [ ] **Step 4: Add the session-to-scope helper**

```ts
// ads-agent/lib/auth/scope.ts
import type { Scope } from "@/lib/db/scope-sql";
import { getSession } from "./dal";

/**
 * The one place a request turns into a Scope. A session without an orgId is
 * platform staff, which reads across orgs and writes none of them.
 */
export async function scopeFromSession(): Promise<Scope> {
  const session = await getSession();
  if (!session) throw new Error("scopeFromSession: no session");
  return session.orgId ? { kind: "org", orgId: session.orgId } : { kind: "platform" };
}
```

- [ ] **Step 5: Re-point `twenty-pipeline.ts` and absorb `fetchLeadSignal`**

Replace lines 1–4 with:

```ts
// ads-agent/lib/crm/twenty-pipeline.ts
import { orgIdForWrite } from "../db/scope-write";
import type { Scope } from "../db/scope-sql";
import { TWENTY_MCP_TOOLS } from "../bifrost/twenty-mcp-tools";
import { getTwentyClient } from "./twenty-client";
```

Delete `isConfigured()` (lines 54–56) — the resolver decides whether Twenty is reachable, and an env-var check would be a second answer to the same question. Then replace lines 164–214 (`listOpportunities` through `getPipelineValue`) with:

```ts
export type LeadSignal = {
  hotCount: number;
  warmCount: number;
  coldCount: number;
  unscoredCount: number;
};

const EMPTY_SIGNAL: LeadSignal = {
  hotCount: 0,
  warmCount: 0,
  coldCount: 0,
  unscoredCount: 0,
};

/**
 * Every read fails soft to an empty board rather than a crashed page, which is
 * the convention these surfaces already had. The difference after
 * consolidation: the failure is logged with the org, so an unprovisioned
 * tenant is visible instead of looking like a tenant with no leads.
 */
async function readOpportunities(scope: Scope): Promise<RawOpportunity[]> {
  const orgId = orgIdForWrite(scope);
  const client = await getTwentyClient(orgId);
  return extractRawOpportunities(await client.listOpportunities(200));
}

export async function listOpportunities(scope: Scope): Promise<Opportunity[]> {
  try {
    return (await readOpportunities(scope)).map(toOpportunity);
  } catch (err) {
    console.error("twenty-pipeline: listOpportunities failed", { scope, err });
    return [];
  }
}

export async function getOpportunity(scope: Scope, id: string): Promise<Opportunity | null> {
  try {
    const client = await getTwentyClient(orgIdForWrite(scope));
    const [record] = extractRawOpportunities(await client.getOpportunity(id));
    return record ? toOpportunity(record) : null;
  } catch (err) {
    console.error("twenty-pipeline: getOpportunity failed", { scope, id, err });
    return null;
  }
}

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

export async function updateOpportunityStage(
  scope: Scope,
  id: string,
  stage: PipelineStageValue,
): Promise<UpdateStageResult> {
  try {
    const client = await getTwentyClient(orgIdForWrite(scope));
    await client.updateOpportunityStage(id, stage);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getPipelineValue(scope: Scope): Promise<number> {
  const opportunities = await listOpportunities(scope);
  return opportunities.reduce((sum, o) => sum + (o.amountInr ?? 0), 0);
}

/**
 * Absorbed from the deleted lib/connectors/twenty.ts, which carried a second
 * copy of baseUrl() reading TWENTY_BASE_URL and therefore could not be made
 * tenant-aware (tenancy spec §6).
 */
export async function fetchLeadSignal(scope: Scope): Promise<LeadSignal> {
  const signal = { ...EMPTY_SIGNAL };
  try {
    for (const opp of await readOpportunities(scope)) {
      switch (opp.tier) {
        case "HOT":
          signal.hotCount++;
          break;
        case "WARM":
          signal.warmCount++;
          break;
        case "COLD":
          signal.coldCount++;
          break;
        default:
          signal.unscoredCount++;
          break;
      }
    }
    return signal;
  } catch (err) {
    console.error("twenty-pipeline: fetchLeadSignal failed", { scope, err });
    return EMPTY_SIGNAL;
  }
}
```

- [ ] **Step 6: Delete the duplicate connector**

```bash
git rm ads-agent/lib/connectors/twenty.ts
```

- [ ] **Step 7: Update every consumer**

`ads-agent/app/(admin)/page.tsx` — replace lines 1–23:

```tsx
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getOverviewStats } from "@/lib/db/dashboard";
import { countAiActionsToday, listRecentAiActions } from "@/lib/db/ai-action-log";
import { fetchLeadSignal, getPipelineValue } from "@/lib/crm/twenty-pipeline";
import { StatCardView } from "@/lib/openui/shared-metric-cards";

function formatInr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function HomePage() {
  const access = await requireRole("viewer");
  if (!access.ok) return <ForbiddenNotice />;
  const scope = await scopeFromSession();

  const [overview, leadSignal, pipelineValueInr, aiActionsToday, recentActions] = await Promise.all([
    getOverviewStats(scope),
    fetchLeadSignal(scope),
    getPipelineValue(scope),
    countAiActionsToday(scope),
    listRecentAiActions(scope, 5),
  ]);
```

`getOverviewStats`, `countAiActionsToday` and `listRecentAiActions` already take `scope` first after S3; if the S3 branch named the parameter differently, keep S3's signature and change only the two Twenty calls.

`ads-agent/app/(admin)/crm/page.tsx` — replace lines 26–30:

```tsx
export default async function CrmPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;
  const scope = await scopeFromSession();

  const opportunities = await listOpportunities(scope);
```

and add `import { scopeFromSession } from "@/lib/auth/scope";` after line 2.

`ads-agent/app/api/crm/opportunities/[id]/stage/route.ts` — replace line 22:

```ts
  const scope = access.session.orgId
    ? ({ kind: "org", orgId: access.session.orgId } as const)
    : ({ kind: "platform" } as const);
  const result = await updateOpportunityStage(scope, id, toStage as PipelineStageValue);
```

`ads-agent/lib/decision-engine/cycle.ts` — replace the import on line 7 and the `fetchLeadSignal` call inside the `Promise.all` at lines 30–31:

```ts
import { fetchLeadSignal } from "../crm/twenty-pipeline";
```

```ts
    softFail("twenty lead signal", () => fetchLeadSignal(scope), {
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      unscoredCount: 0,
    }),
```

`runDecisionCycle` already receives `scope` as its first parameter after S3 (it calls `db/proposals`, `db/campaigns`, `db/snapshots` and `db/ai-action-log`, all converted in wave S3-B). Use that same `scope` identifier; do not add a second one.

`ads-agent/lib/openui/crm-tools.ts` — replace lines 40–65:

```ts
export function createCrmToolProvider(scope: Scope): ToolProviderMap {
  return {
    list_opportunities: async () => toOpenUiListResult(await listOpportunities(scope)),
    search_opportunities: async (args: Record<string, unknown>) => {
      const query = String(args.query ?? "").toLowerCase();
      const all = await listOpportunities(scope);
      const filtered = !query ? all : all.filter((o) => o.name.toLowerCase().includes(query));
      return toOpenUiListResult(filtered);
    },
    get_opportunity: async (args: Record<string, unknown>) => {
      const row = await getOpportunity(scope, String(args.id ?? ""));
      return row ? toOpenUiOpportunityCard(row) : null;
    },
    advance_opportunity_stage: async (args: Record<string, unknown>) => {
      const id = String(args.id ?? "");
      const opportunityName = String(args.opportunityName ?? "");
      const toStage = String(args.toStage ?? "");
      const label = STAGE_LABELS.get(toStage as (typeof PIPELINE_STAGES)[number]["value"]);
      if (!label) return { ok: false, error: `unknown stage "${toStage}"` };

      const result = await updateOpportunityStage(
        scope,
        id,
        toStage as (typeof PIPELINE_STAGES)[number]["value"],
      );
      if (result.ok) {
        await logAiAction(scope, { domain: "crm", summary: `Advanced ${opportunityName} to ${label}` });
      }
      return result;
    },
  };
}
```

and add `import type { Scope } from "../db/scope-sql";` to its imports. `crmToolSpecs` and `crmReadToolSpecs` are unchanged, so `lib/decision-engine/crm-chat.ts` needs no edit.

`ads-agent/lib/openui/platform-tools.ts` — line 36 becomes a factory:

```ts
export function createPlatformToolProvider(scope: Scope): ToolProviderMap {
  return composeToolProviders(createCrmToolProvider(scope) /* , other providers unchanged */);
}
```

Keep whatever other providers `platformToolProvider` already composed; only the CRM one becomes a call. Add `import type { Scope } from "../db/scope-sql";`.

`ads-agent/app/api/openui/tools/route.ts` — replace the `platformToolProvider` import and its use:

```ts
import { createPlatformToolProvider } from "@/lib/openui/platform-tools";
import { scopeFromSession } from "@/lib/auth/scope";
// ... inside the handler, after the existing requireApiRole check:
const provider = createPlatformToolProvider(await scopeFromSession());
```

`ads-agent/mcp/app-data-mcp-server/index.ts` — the MCP server has no session. Replace its `crmToolProvider` import with:

```ts
import { createCrmToolProvider } from "../../lib/openui/crm-tools";

// The app-data MCP server runs as a local developer tool with no session, so
// its tenant comes from the environment and is explicit rather than implied.
const orgId = process.env.MCP_ORG_ID;
if (!orgId) throw new Error("app-data-mcp-server: MCP_ORG_ID is required");
const crmToolProvider = createCrmToolProvider({ kind: "org", orgId });
```

- [ ] **Step 8: Update the two affected test files**

In `ads-agent/lib/crm/twenty-pipeline.test.ts`, replace the `callTwentyTool` mock with a `getTwentyClient` mock and pass a scope to every call:

```ts
const listOpportunitiesMock = vi.fn();
const getOpportunityMock = vi.fn();
const updateOpportunityStageMock = vi.fn();
vi.mock("./twenty-client", () => ({
  getTwentyClient: async () => ({
    orgId: "org-1",
    version: "1.9.0",
    listOpportunities: listOpportunitiesMock,
    getOpportunity: getOpportunityMock,
    updateOpportunityStage: updateOpportunityStageMock,
  }),
}));

const scope = { kind: "org", orgId: "org-1" } as const;
```

Keep every existing assertion about `maskPhone`, `toOpenUiOpportunityCard`, `formatAmountLabelInr` and `reshapeTwentyOpportunityToolResult` exactly as it is — those are pure functions and this task does not change them. Add one new test:

```ts
it("returns an empty board and logs the org when the client throws", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  listOpportunitiesMock.mockRejectedValue(new Error("no Twenty connection for org org-1"));
  await expect(listOpportunities(scope)).resolves.toEqual([]);
  expect(error).toHaveBeenCalled();
  error.mockRestore();
});
```

In `ads-agent/lib/openui/crm-tools.test.ts`, replace the `crmToolProvider` import with `createCrmToolProvider` and build it once per test: `const provider = createCrmToolProvider({ kind: "org", orgId: "org-1" });`. Every existing assertion about the returned envelope shape stays.

- [ ] **Step 9: Run the whole ads-agent suite**

Run: `cd ads-agent && npx vitest run`
Expected: PASS. In particular `lib/crm/twenty-client.test.ts` (6 tests), `lib/crm/twenty-pipeline.test.ts`, `lib/openui/crm-tools.test.ts`, and `lib/db/no-crm-imports.test.ts` all green.

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no errors. A missed call site is a compile error here, which is the point of putting `Scope` first.

Run: `grep -rn "TWENTY_BASE_URL" ads-agent/ --include=*.ts | grep -v node_modules`
Expected: no output. The duplicate `baseUrl()` is gone.

- [ ] **Step 10: Commit**

```bash
git add -A ads-agent/lib/crm ads-agent/lib/auth/scope.ts ads-agent/lib/openui \
           ads-agent/app ads-agent/lib/decision-engine/cycle.ts ads-agent/mcp
git commit -m "refactor(crm): one tenant-resolving Twenty client

Three process-wide singletons reached Twenty, two of them with duplicate
baseUrl() readers of TWENTY_BASE_URL, and none could become tenant-aware.
getTwentyClient(orgId) is now the only constructor and it throws rather
than returning empty, because empty is indistinguishable from a customer
with no contacts. The interim platform-only guard moves inside it and is
removed in the last task of this plan, not here."
```

## Task 11: Per-org Twenty provisioning and the coverage check

**Wave:** S4-D · **Skills:** `senior-devops`, `deployment-engineer` · **Model:** `inherit`

**Files:**
- Create: `infra/twenty/docker-compose.tenant.yml`
- Create: `ads-agent/lib/crm/twenty-provisioning.ts`
- Create: `ads-agent/lib/crm/twenty-provisioning.test.ts`
- Create: `ads-agent/scripts/provision-twenty-instance.ts`
- Create: `ads-agent/scripts/check-twenty-coverage.ts`

**Interfaces:**
- Consumes: `upsertTwentyConnection`, `setTwentyConnectionState`, `orgsWithoutOwnInstance` (Task 4).
- Produces:
  - `type CoolifyApi = { createService; setEnvVars; setFqdn; deploy; health }`
  - `createCoolifyApi(baseUrl: string, token: string): CoolifyApi`
  - `buildTwentyServicePlan(input: PlanInput): TwentyServicePlan`
  - `provisionTwentyInstance(api: CoolifyApi, input: PlanInput): Promise<{ serviceUuid: string; state: "provisioning" }>`
  - `activateTwentyConnection(orgId: string, apiKeyRef: string, twentyVersion: string): Promise<void>`

**Context:** Twenty tenancy spec §9. Provisioning runs through Coolify because it already deploys this stack; Twenty exposes no provisioning API of its own (TW6). Twenty's documented minimum is **2GB RAM per instance**, and pointing each instance at a database on the shared Postgres server keeps the marginal cost to the server and worker containers — the total still scales linearly with customers and is the dominant infrastructure cost in this architecture.

**Step 5 of §9 is manual and stays manual:** Twenty exposes no endpoint for generating an API key. `provisionTwentyInstance` therefore stops at `state = 'provisioning'` and prints the manual step; `activateTwentyConnection` is a separate call the operator makes after pasting the key. Automating it is open question §14.1 and does not block.

Tests cover the plan builder and the ordering of the state machine, with an injected `CoolifyApi`. They do not call Coolify: a test that needs a live control plane is a test nobody runs.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/crm/twenty-provisioning.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertTwentyConnection = vi.fn();
const setTwentyConnectionState = vi.fn();
vi.mock("../db/twenty-connections", () => ({
  upsertTwentyConnection,
  setTwentyConnectionState,
}));

import {
  activateTwentyConnection,
  buildTwentyServicePlan,
  provisionTwentyInstance,
  type CoolifyApi,
} from "./twenty-provisioning";

const input = {
  orgId: "11111111-1111-1111-1111-111111111111",
  orgSlug: "acme-realty",
  projectUuid: "proj-1",
  serverUuid: "srv-1",
  environmentName: "production",
  domainSuffix: "crm.gentlespace.in",
  postgresHost: "postgres.internal",
  postgresPassword: "unit-test-only",
  appSecret: "unit-test-only",
  encryptionKey: "unit-test-only",
  twentyTag: "v1.9.0",
};

function fakeApi(): CoolifyApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    createService: vi.fn(async () => {
      calls.push("createService");
      return { uuid: "svc-abc" };
    }),
    setEnvVars: vi.fn(async () => {
      calls.push("setEnvVars");
    }),
    setFqdn: vi.fn(async () => {
      calls.push("setFqdn");
    }),
    deploy: vi.fn(async () => {
      calls.push("deploy");
    }),
    health: vi.fn(async () => {
      calls.push("health");
      return "healthy" as const;
    }),
  };
}

beforeEach(() => {
  upsertTwentyConnection.mockReset().mockResolvedValue(undefined);
  setTwentyConnectionState.mockReset().mockResolvedValue(undefined);
});

describe("buildTwentyServicePlan", () => {
  it("gives the org its own database name, fqdn and single-workspace mode", () => {
    const plan = buildTwentyServicePlan(input);
    expect(plan.name).toBe("twenty-acme-realty");
    expect(plan.fqdn).toBe("https://acme-realty.crm.gentlespace.in");
    const env = Object.fromEntries(plan.envVars.map((v) => [v.key, v.value]));
    expect(env.IS_MULTIWORKSPACE_ENABLED).toBe("false");
    expect(env.PG_DATABASE_NAME).toBe("twenty_acme_realty");
    expect(env.SERVER_URL).toBe("https://acme-realty.crm.gentlespace.in");
    expect(plan.dockerComposeRaw).toContain("twentycrm/twenty:v1.9.0");
  });

  it("never publishes a host port, because N instances would collide on 3020", () => {
    expect(buildTwentyServicePlan(input).dockerComposeRaw).not.toContain("3020:");
  });

  it("refuses a slug that would not be a safe database name or hostname", () => {
    expect(() => buildTwentyServicePlan({ ...input, orgSlug: "Acme Realty!" })).toThrow(
      /slug must be lowercase/i,
    );
  });
});

describe("provisionTwentyInstance", () => {
  it("registers the connection before deploying, so a crash leaves a traceable row", async () => {
    const api = fakeApi();
    const result = await provisionTwentyInstance(api, input);
    expect(result).toEqual({ serviceUuid: "svc-abc", state: "provisioning" });
    expect(api.calls).toEqual(["createService", "setEnvVars", "setFqdn", "deploy", "health"]);
    expect(upsertTwentyConnection).toHaveBeenCalledWith({
      orgId: input.orgId,
      baseUrl: "https://acme-realty.crm.gentlespace.in",
      apiKeyRef: "env://TWENTY_API_KEY_ACME_REALTY",
      coolifyServiceUuid: "svc-abc",
      twentyVersion: "v1.9.0",
      state: "provisioning",
    });
    // Activation is a separate, later call: Twenty has no API-key endpoint.
    expect(setTwentyConnectionState).not.toHaveBeenCalledWith(input.orgId, "active");
  });

  it("marks the connection failed when the instance never becomes healthy", async () => {
    const api = fakeApi();
    api.health = vi.fn(async () => "unhealthy" as const);
    await expect(provisionTwentyInstance(api, input)).rejects.toThrow(/never became healthy/i);
    expect(setTwentyConnectionState).toHaveBeenCalledWith(
      input.orgId,
      "failed",
      expect.stringContaining("healthy"),
    );
  });
});

describe("activateTwentyConnection", () => {
  it("is the only thing that flips the state to active", async () => {
    await activateTwentyConnection(input.orgId, "env://TWENTY_API_KEY_ACME_REALTY", "v1.9.0");
    expect(setTwentyConnectionState).toHaveBeenCalledWith(input.orgId, "active", null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-provisioning.test.ts`
Expected: FAIL — `Failed to resolve import "./twenty-provisioning"`.

- [ ] **Step 3: Write the per-tenant compose template**

```yaml
# infra/twenty/docker-compose.tenant.yml
# Per-tenant Twenty instance (tenancy spec §9). Differences from
# infra/twenty/docker-compose.yml, which is the single local dev instance:
#   - no published host port: N instances would collide on 3020
#   - no db service: the database lives on the shared Postgres server, so the
#     marginal cost of a tenant is the server and worker containers only
#   - IS_MULTIWORKSPACE_ENABLED=false, Twenty's best-tested configuration (TW1)
name: twenty-${ORG_SLUG}

services:
  server:
    image: twentycrm/twenty:${TAG}
    volumes:
      - server-local-data:/app/packages/twenty-server/.local-storage
    environment:
      NODE_PORT: 3000
      IS_MULTIWORKSPACE_ENABLED: "false"
      PG_DATABASE_URL: postgres://${PG_DATABASE_USER}:${PG_DATABASE_PASSWORD}@${PG_DATABASE_HOST}:${PG_DATABASE_PORT}/${PG_DATABASE_NAME}
      SERVER_URL: ${SERVER_URL}
      REDIS_URL: redis://redis:6379
      APP_SECRET: ${APP_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: curl --fail http://localhost:3000/healthz
      interval: 5s
      timeout: 5s
      retries: 20
    restart: always

  worker:
    image: twentycrm/twenty:${TAG}
    volumes:
      - server-local-data:/app/packages/twenty-server/.local-storage
    command: ["yarn", "worker:prod"]
    environment:
      IS_MULTIWORKSPACE_ENABLED: "false"
      PG_DATABASE_URL: postgres://${PG_DATABASE_USER}:${PG_DATABASE_PASSWORD}@${PG_DATABASE_HOST}:${PG_DATABASE_PORT}/${PG_DATABASE_NAME}
      SERVER_URL: ${SERVER_URL}
      REDIS_URL: redis://redis:6379
      APP_SECRET: ${APP_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      DISABLE_DB_MIGRATIONS: "true"
      DISABLE_CRON_JOBS_REGISTRATION: "true"
    depends_on:
      server:
        condition: service_healthy
    restart: always

  redis:
    image: redis
    restart: always
    command: ["--maxmemory-policy", "noeviction"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  server-local-data:
```

- [ ] **Step 4: Write the provisioning module**

```ts
// ads-agent/lib/crm/twenty-provisioning.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTwentyConnectionState, upsertTwentyConnection } from "../db/twenty-connections";

export type PlanInput = {
  orgId: string;
  orgSlug: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  domainSuffix: string;
  postgresHost: string;
  postgresPassword: string;
  appSecret: string;
  encryptionKey: string;
  twentyTag: string;
};

export type TwentyServicePlan = {
  name: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  dockerComposeRaw: string;
  envVars: { key: string; value: string }[];
  fqdn: string;
  apiKeyRef: string;
};

export type CoolifyApi = {
  createService(plan: TwentyServicePlan): Promise<{ uuid: string }>;
  setEnvVars(serviceUuid: string, vars: { key: string; value: string }[]): Promise<void>;
  setFqdn(serviceUuid: string, fqdn: string): Promise<void>;
  deploy(serviceUuid: string): Promise<void>;
  health(serviceUuid: string): Promise<"healthy" | "unhealthy">;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function buildTwentyServicePlan(input: PlanInput): TwentyServicePlan {
  if (!SLUG.test(input.orgSlug)) {
    throw new Error(
      `twenty provisioning: slug must be lowercase alphanumeric with single hyphens, got "${input.orgSlug}"`,
    );
  }
  const underscored = input.orgSlug.replace(/-/g, "_");
  const fqdn = `https://${input.orgSlug}.${input.domainSuffix}`;
  const compose = readFileSync(
    path.join(process.cwd(), "..", "infra/twenty/docker-compose.tenant.yml"),
    "utf-8",
  ).replace(/\$\{TAG\}/g, input.twentyTag);

  return {
    name: `twenty-${input.orgSlug}`,
    projectUuid: input.projectUuid,
    serverUuid: input.serverUuid,
    environmentName: input.environmentName,
    dockerComposeRaw: compose,
    fqdn,
    // A reference, never the key. The operator writes the key into this
    // variable after the manual step in §9.5.
    apiKeyRef: `env://TWENTY_API_KEY_${underscored.toUpperCase()}`,
    envVars: [
      { key: "ORG_SLUG", value: input.orgSlug },
      { key: "TAG", value: input.twentyTag },
      { key: "IS_MULTIWORKSPACE_ENABLED", value: "false" },
      { key: "SERVER_URL", value: fqdn },
      { key: "PG_DATABASE_HOST", value: input.postgresHost },
      { key: "PG_DATABASE_PORT", value: "5432" },
      { key: "PG_DATABASE_USER", value: `twenty_${underscored}` },
      { key: "PG_DATABASE_PASSWORD", value: input.postgresPassword },
      { key: "PG_DATABASE_NAME", value: `twenty_${underscored}` },
      { key: "APP_SECRET", value: input.appSecret },
      { key: "ENCRYPTION_KEY", value: input.encryptionKey },
    ],
  };
}

/**
 * Registers the connection as 'provisioning' before deploying, so a crash
 * halfway leaves a row naming the Coolify service rather than an orphaned
 * container nobody can find. Stops short of 'active': Twenty exposes no
 * endpoint for generating an API key (§9.5), so activation is a separate,
 * deliberate call after the manual step.
 */
export async function provisionTwentyInstance(
  api: CoolifyApi,
  input: PlanInput,
): Promise<{ serviceUuid: string; state: "provisioning" }> {
  const plan = buildTwentyServicePlan(input);
  const { uuid } = await api.createService(plan);

  await upsertTwentyConnection({
    orgId: input.orgId,
    baseUrl: plan.fqdn,
    apiKeyRef: plan.apiKeyRef,
    coolifyServiceUuid: uuid,
    twentyVersion: input.twentyTag,
    state: "provisioning",
  });

  await api.setEnvVars(uuid, plan.envVars);
  await api.setFqdn(uuid, plan.fqdn);
  await api.deploy(uuid);

  const health = await api.health(uuid);
  if (health !== "healthy") {
    await setTwentyConnectionState(
      input.orgId,
      "failed",
      `service ${uuid} never became healthy after deploy`,
    );
    throw new Error(`twenty provisioning: service ${uuid} never became healthy after deploy`);
  }

  return { serviceUuid: uuid, state: "provisioning" };
}

export async function activateTwentyConnection(
  orgId: string,
  apiKeyRef: string,
  twentyVersion: string,
): Promise<void> {
  void apiKeyRef;
  void twentyVersion;
  await setTwentyConnectionState(orgId, "active", null);
}

export function createCoolifyApi(baseUrl: string, token: string): CoolifyApi {
  const base = baseUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`coolify ${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : undefined;
  }

  return {
    async createService(plan) {
      const json = (await call("POST", "/api/v1/services", {
        name: plan.name,
        project_uuid: plan.projectUuid,
        server_uuid: plan.serverUuid,
        environment_name: plan.environmentName,
        docker_compose_raw: plan.dockerComposeRaw,
        instant_deploy: false,
      })) as { uuid?: string };
      if (!json?.uuid) throw new Error("coolify: service create returned no uuid");
      return { uuid: json.uuid };
    },
    async setEnvVars(serviceUuid, vars) {
      for (const v of vars) {
        await call("POST", `/api/v1/services/${serviceUuid}/envs`, {
          key: v.key,
          value: v.value,
          is_preview: false,
        });
      }
    },
    async setFqdn(serviceUuid, fqdn) {
      await call("PATCH", `/api/v1/services/${serviceUuid}`, { domains: fqdn });
    },
    async deploy(serviceUuid) {
      await call("GET", `/api/v1/deploy?uuid=${serviceUuid}`);
    },
    async health(serviceUuid) {
      // Poll for up to five minutes: a cold image pull plus Twenty's own
      // migrations routinely take minutes on first boot.
      for (let attempt = 0; attempt < 60; attempt++) {
        const json = (await call("GET", `/api/v1/services/${serviceUuid}`)) as {
          status?: string;
        };
        if (json?.status?.includes("running:healthy")) return "healthy";
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      return "unhealthy";
    },
  };
}
```

`activateTwentyConnection` takes `apiKeyRef` and `twentyVersion` and currently uses neither, because `provisionTwentyInstance` already wrote both. They stay in the signature so the operator command reads as the complete act — and so that re-keying an instance later is a signature that already exists.

- [ ] **Step 5: Write the two operator scripts**

```ts
// ads-agent/scripts/provision-twenty-instance.ts
/**
 * Provisions one org's Twenty instance. Per tenancy spec §9 step 5, generating
 * the API key is manual — Twenty exposes no endpoint for it — so this script
 * stops at state 'provisioning' and prints what to do next.
 *
 *   npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \
 *     --org-id <uuid> --slug acme-realty
 */
import {
  activateTwentyConnection,
  createCoolifyApi,
  provisionTwentyInstance,
} from "../lib/crm/twenty-provisioning";

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`provision-twenty-instance: --${name} is required`);
  return value;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`provision-twenty-instance: ${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes("--activate")) {
    await activateTwentyConnection(arg("org-id"), arg("api-key-ref"), arg("tag"));
    console.log(`twenty: org ${arg("org-id")} is active`);
    return;
  }

  const orgSlug = arg("slug");
  const api = createCoolifyApi(env("COOLIFY_BASE_URL"), env("COOLIFY_API_TOKEN"));
  const result = await provisionTwentyInstance(api, {
    orgId: arg("org-id"),
    orgSlug,
    projectUuid: env("COOLIFY_PROJECT_UUID"),
    serverUuid: env("COOLIFY_SERVER_UUID"),
    environmentName: process.env.COOLIFY_ENVIRONMENT ?? "production",
    domainSuffix: env("TWENTY_DOMAIN_SUFFIX"),
    postgresHost: env("TWENTY_PG_HOST"),
    postgresPassword: env("TWENTY_PG_PASSWORD"),
    appSecret: env("TWENTY_APP_SECRET"),
    encryptionKey: env("TWENTY_ENCRYPTION_KEY"),
    twentyTag: process.env.TWENTY_TAG ?? "latest",
  });

  const variable = `TWENTY_API_KEY_${orgSlug.replace(/-/g, "_").toUpperCase()}`;
  console.log(`twenty: service ${result.serviceUuid} deployed and healthy, state=provisioning

Manual steps (tenancy spec §9, steps 4-6):
  1. Open https://${orgSlug}.${env("TWENTY_DOMAIN_SUFFIX")} and complete first-run setup.
  2. Settings -> API keys: create a key scoped to person and opportunity access
     ONLY. A workspace-admin key is not needed and must not be issued.
  3. Put it in ${variable} in the secret store, then run:
     npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \\
       --activate --org-id ${arg("org-id")} --api-key-ref env://${variable} --tag ${process.env.TWENTY_TAG ?? "latest"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("twenty provisioning failed", err);
    process.exit(1);
  });
```

```ts
// ads-agent/scripts/check-twenty-coverage.ts
/**
 * The gate for Task 24. Exits 0 only when every org has its own active Twenty
 * instance that is not the contaminated shared one. Until then the interim
 * platform-only guard stays in the client.
 *
 *   npx tsx --env-file=.env.local scripts/check-twenty-coverage.ts
 */
import { orgsWithoutOwnInstance } from "../lib/db/twenty-connections";

async function main(): Promise<void> {
  const shared = process.env.SHARED_TWENTY_BASE_URL?.trim();
  if (!shared) throw new Error("check-twenty-coverage: SHARED_TWENTY_BASE_URL is not set");

  const gaps = await orgsWithoutOwnInstance(shared);
  if (gaps.length === 0) {
    console.log("twenty coverage: every org has its own active instance");
    return;
  }
  console.error(`twenty coverage: ${gaps.length} org(s) not yet covered`);
  for (const gap of gaps) console.error(`  ${gap.orgId}: ${gap.reason}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("check-twenty-coverage failed", err);
  process.exit(1);
});
```

- [ ] **Step 6: Run the tests**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-provisioning.test.ts`
Expected: PASS, 6 tests.

Run: `cd ads-agent && npx tsx --env-file=.env.local scripts/check-twenty-coverage.ts`
Expected: exit 1 with `twenty coverage: 1 org(s) not yet covered` and `no connection` for the Gentle Space org — nothing is provisioned yet, and the check correctly says so.

- [ ] **Step 7: Provision Gentle Space as the first tenant**

Gentle Space is itself a tenant (TW7); the marketing site's leads go to its own instance, and there is no special platform path. Run:

```bash
cd ads-agent && npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \
  --org-id "$(psql -tA "$DATABASE_URL" -c "SELECT id FROM public.orgs WHERE slug = 'gentle-space'")" \
  --slug gentle-space
```

Expected: `service <uuid> deployed and healthy, state=provisioning`, followed by the three manual steps. Complete them, run the printed `--activate` command, then re-run the coverage check.

Expected after activation: `twenty coverage: every org has its own active instance`.

**If Coolify cannot create the service** — stop and escalate rather than provisioning by hand. A hand-built instance has no `coolify_service_uuid`, and deprovisioning is `service delete` with `delete_volumes`, so an unregistered instance is a customer CRM nobody can decommission.

- [ ] **Step 8: Commit**

```bash
git add infra/twenty/docker-compose.tenant.yml \
        ads-agent/lib/crm/twenty-provisioning.ts ads-agent/lib/crm/twenty-provisioning.test.ts \
        ads-agent/scripts/provision-twenty-instance.ts ads-agent/scripts/check-twenty-coverage.ts
git commit -m "feat(crm): per-org Twenty provisioning through Coolify

One instance per org (TW1), registered before deploy so a half-finished
provision leaves a traceable row. Generating the API key stays manual
because Twenty exposes no endpoint for it. The coverage check is the gate
for removing the interim platform-only guard.

No migration out of the shared instance exists or ever will: its dedup has
merged contacts across tenant lines and the merge is not reversible."
```

## Task 12: Twenty projection worker

**Wave:** S4-E · **Skills:** `senior-backend`, `senior-devops` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/crm/twenty-projection.ts`
- Create: `ads-agent/lib/crm/twenty-projection.test.ts`
- Create: `ads-agent/scripts/run-twenty-projection.ts`

**Interfaces:**
- Consumes: `getTwentyClient` (Task 10); `claimPendingContacts`, `markContactSynced`, `markContactSyncFailed`, `markContactMergedIntoPerson` (Task 3); `listEnquiriesAwaitingOpportunity`, `setTwentyOpportunityId` (Task 6); `claimUnsyncedActivities`, `markActivitySynced` (Task 8); `withCrossTenantRead` (Task 5); `touchTwentyLastSync` (Task 4); `PIPELINE_STAGES` (Task 10).
- Produces:
  - `REPLY_STATE_TO_STAGE: Record<ReplyState, PipelineStageValue | null>`
  - `type ProjectionResult = { attempted: number; succeeded: number; failed: number }`
  - `projectPendingContacts(limit?: number): Promise<ProjectionResult>`
  - `projectPendingActivities(limit?: number): Promise<ProjectionResult>`
  - `formatActivityNote(activity: UnsyncedActivity): string`
  - `projectReplyState(scope, enquiryId, replyState, opportunityId): Promise<void>`

**Context:** Twenty tenancy spec §7 and §8; backend spec C7. This is the interim mechanism for what §7 describes as running through the outbox — see "Sequencing decisions" at the top of this plan. **At S5a these two functions become outbox consumers with unchanged signatures**, so the swap is a change to `scripts/run-twenty-projection.ts` only.

Failure discipline, because getting this wrong is how a worker eats a queue:

- A single contact failing is **not** an instance failure. The error lands on the contact row (`last_sync_error`, `sync_attempts`), not on `twenty_connections.state`. Suspending an instance because one phone number was malformed would take a customer's CRM offline.
- `touchTwentyLastSync` runs after a **successful** org round, so a stale `last_sync_at` is the signal that an instance is unreachable.
- The unique constraint `(org_id, twenty_person_id)` is the dedup-merge detector: if writing Twenty's person id onto our row collides, another local row already holds that person, which means Twenty merged them. That is Postgres error code `23505`, and the handler tombstones the loser rather than retrying forever.
- Reply state maps to a stage only where the mapping is honest; `closed → null` means *do not project*.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/crm/twenty-projection.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const claimPendingContacts = vi.fn();
const markContactSynced = vi.fn();
const markContactSyncFailed = vi.fn();
const markContactMergedIntoPerson = vi.fn();
const listEnquiriesAwaitingOpportunity = vi.fn();
const setTwentyOpportunityId = vi.fn();
const claimUnsyncedActivities = vi.fn();
const markActivitySynced = vi.fn();
const touchTwentyLastSync = vi.fn();
const getTwentyClient = vi.fn();

vi.mock("../db/contacts", () => ({
  claimPendingContacts,
  markContactSynced,
  markContactSyncFailed,
  markContactMergedIntoPerson,
}));
vi.mock("../db/enquiries", () => ({
  listEnquiriesAwaitingOpportunity,
  setTwentyOpportunityId,
}));
vi.mock("../db/enquiry-activities", () => ({ claimUnsyncedActivities, markActivitySynced }));
vi.mock("../db/twenty-connections", () => ({ touchTwentyLastSync }));
vi.mock("../db/cross-tenant", () => ({
  withCrossTenantRead: async (_actor: string, fn: (c: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("./twenty-client", () => ({ getTwentyClient }));

import {
  REPLY_STATE_TO_STAGE,
  formatActivityNote,
  projectPendingActivities,
  projectPendingContacts,
} from "./twenty-projection";

const contact = {
  id: "contact-1",
  orgId: "org-1",
  twentyPersonId: null,
  name: "Asha Rao",
  phone: "+919800000000",
  email: null,
  syncState: "pending" as const,
  syncedAt: null,
  mergedInto: null,
  syncAttempts: 0,
};

function twentyClient(overrides: Record<string, unknown> = {}) {
  return {
    orgId: "org-1",
    version: "1.9.0",
    upsertPerson: vi.fn(async () => ({
      id: "person-9",
      firstName: "Asha",
      lastName: "Rao",
      phone: "+919800000001",
      email: null,
    })),
    createOpportunity: vi.fn(async () => ({ id: "opp-9" })),
    updateOpportunityStage: vi.fn(async () => undefined),
    createNote: vi.fn(async () => ({ id: "note-9" })),
    listOpportunities: vi.fn(async () => []),
    getOpportunity: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [
    claimPendingContacts,
    markContactSynced,
    markContactSyncFailed,
    markContactMergedIntoPerson,
    listEnquiriesAwaitingOpportunity,
    setTwentyOpportunityId,
    claimUnsyncedActivities,
    markActivitySynced,
    touchTwentyLastSync,
    getTwentyClient,
  ]) {
    fn.mockReset();
  }
  claimPendingContacts.mockResolvedValue([]);
  claimUnsyncedActivities.mockResolvedValue([]);
  listEnquiriesAwaitingOpportunity.mockResolvedValue([]);
});

describe("REPLY_STATE_TO_STAGE", () => {
  it("maps waiting and called, and deliberately refuses to guess for closed", () => {
    expect(REPLY_STATE_TO_STAGE).toEqual({
      waiting: "NEW_BRIEF",
      called: "SHORTLIST",
      closed: null,
    });
  });
});

describe("projectPendingContacts", () => {
  it("writes back Twenty's canonical values, because its dedup is the authority", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    const client = twentyClient();
    getTwentyClient.mockResolvedValue(client);

    const result = await projectPendingContacts();

    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(markContactSynced).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "contact-1",
      "person-9",
      { name: "Asha Rao", phone: "+919800000001", email: null },
    );
    expect(touchTwentyLastSync).toHaveBeenCalledWith("org-1");
  });

  it("creates the opportunity for every enquiry still missing one", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    listEnquiriesAwaitingOpportunity.mockResolvedValue([
      {
        id: "enq-1",
        contactName: "Asha Rao",
        listingUrl: "https://gentlespace.in/spaces/hsr-1",
        listingId: null,
        replyState: "waiting",
      },
    ]);
    const client = twentyClient();
    getTwentyClient.mockResolvedValue(client);

    await projectPendingContacts();

    expect(client.createOpportunity).toHaveBeenCalledWith({
      name: "Asha Rao",
      personId: "person-9",
      stage: "NEW_BRIEF",
      listingUrl: "https://gentlespace.in/spaces/hsr-1",
      listingName: null,
    });
    expect(setTwentyOpportunityId).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "enq-1",
      "opp-9",
    );
  });

  it("tombstones the loser when the unique person id collides, which is a dedup merge", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    getTwentyClient.mockResolvedValue(twentyClient());
    const collision = Object.assign(new Error("duplicate key"), { code: "23505" });
    markContactSynced.mockRejectedValue(collision);
    markContactMergedIntoPerson.mockResolvedValue("contact-2");

    const result = await projectPendingContacts();

    expect(markContactMergedIntoPerson).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "contact-1",
      "person-9",
    );
    expect(result.succeeded).toBe(1);
    expect(markContactSyncFailed).not.toHaveBeenCalled();
  });

  it("records the failure on the contact and never on the connection state", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    getTwentyClient.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const result = await projectPendingContacts();

    expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(markContactSyncFailed).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "contact-1",
      expect.stringContaining("ECONNREFUSED"),
    );
    expect(touchTwentyLastSync).not.toHaveBeenCalled();
  });
});

describe("formatActivityNote", () => {
  it("renders a call as something a human reading Twenty can use", () => {
    expect(
      formatActivityNote({
        id: "act-1",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "call",
        body: "Wants a tour on Friday",
        callOutcome: "spoke_interested",
        callSeconds: 240,
        occurredAt: "2026-08-12T05:00:00.000Z",
      }),
    ).toBe(
      "Call on 2026-08-12: spoke interested (4m 0s)\n\nWants a tour on Friday",
    );
  });

  it("renders a note without inventing call fields", () => {
    expect(
      formatActivityNote({
        id: "act-2",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "note",
        body: "Sent the shortlist",
        callOutcome: null,
        callSeconds: null,
        occurredAt: "2026-08-12T06:00:00.000Z",
      }),
    ).toBe("Note on 2026-08-12\n\nSent the shortlist");
  });
});

describe("projectPendingActivities", () => {
  it("writes the note and stamps the activity synced (C7)", async () => {
    claimUnsyncedActivities.mockResolvedValue([
      {
        id: "act-1",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "call",
        body: "Wants a tour on Friday",
        callOutcome: "spoke_interested",
        callSeconds: 240,
        occurredAt: "2026-08-12T05:00:00.000Z",
      },
    ]);
    const client = twentyClient();
    getTwentyClient.mockResolvedValue(client);

    const result = await projectPendingActivities();

    expect(client.createNote).toHaveBeenCalledWith("opp-9", expect.stringContaining("Call on"));
    expect(markActivitySynced).toHaveBeenCalledWith({ kind: "org", orgId: "org-1" }, "act-1");
    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
  });

  it("leaves the activity unsynced when Twenty is down, so the next tick retries", async () => {
    claimUnsyncedActivities.mockResolvedValue([
      {
        id: "act-1",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "note",
        body: "Sent the shortlist",
        callOutcome: null,
        callSeconds: null,
        occurredAt: "2026-08-12T06:00:00.000Z",
      },
    ]);
    getTwentyClient.mockRejectedValue(new Error("no Twenty connection for org org-1"));

    const result = await projectPendingActivities();

    expect(markActivitySynced).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-projection.test.ts`
Expected: FAIL — `Failed to resolve import "./twenty-projection"`.

- [ ] **Step 3: Write the projection module**

```ts
// ads-agent/lib/crm/twenty-projection.ts
import {
  claimPendingContacts,
  markContactMergedIntoPerson,
  markContactSyncFailed,
  markContactSynced,
} from "../db/contacts";
import { withCrossTenantRead } from "../db/cross-tenant";
import { listEnquiriesAwaitingOpportunity, setTwentyOpportunityId } from "../db/enquiries";
import {
  claimUnsyncedActivities,
  markActivitySynced,
  type UnsyncedActivity,
} from "../db/enquiry-activities";
import type { ReplyState } from "../db/enquiries";
import type { Scope } from "../db/scope-sql";
import { touchTwentyLastSync } from "../db/twenty-connections";
import { getTwentyClient } from "./twenty-client";
import type { PipelineStageValue } from "./twenty-pipeline";

/**
 * Reply state is mapped to a pipeline stage, not conflated with it (A2).
 * `closed` maps to null on purpose: closing an enquiry says nothing about
 * whether the deal was won, lost or parked, so projecting a stage would write
 * a false deal outcome into the CRM. Null means "do not project".
 */
export const REPLY_STATE_TO_STAGE: Record<ReplyState, PipelineStageValue | null> = {
  waiting: "NEW_BRIEF",
  called: "SHORTLIST",
  closed: null,
};

export type ProjectionResult = { attempted: number; succeeded: number; failed: number };

function scopeFor(orgId: string): Scope {
  return { kind: "org", orgId };
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "23505");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Interim mechanism for tenancy spec §7. The property the S4 gate needs is
 * that nothing on the request path touches Twenty, which a claim-based poller
 * satisfies as completely as a relay. At S5a this function becomes an outbox
 * consumer with the same signature.
 */
export async function projectPendingContacts(limit = 50): Promise<ProjectionResult> {
  const contacts = await withCrossTenantRead("twenty-projection.contacts", (client) =>
    claimPendingContacts(client, limit),
  );

  const result: ProjectionResult = { attempted: contacts.length, succeeded: 0, failed: 0 };

  for (const contact of contacts) {
    const scope = scopeFor(contact.orgId);
    try {
      const client = await getTwentyClient(contact.orgId);
      const [firstName, ...rest] = contact.name.trim().split(/\s+/);
      const person = await client.upsertPerson({
        firstName: firstName ?? "Unknown",
        lastName: rest.join(" ") || "-",
        phone: contact.phone,
        email: contact.email,
      });

      try {
        await markContactSynced(scope, contact.id, person.id, {
          name: `${person.firstName} ${person.lastName}`.trim(),
          phone: person.phone,
          email: person.email,
        });
      } catch (err) {
        // The unique (org_id, twenty_person_id) constraint is the dedup-merge
        // detector: another local row already holds this person, so Twenty
        // merged them and the surviving row is the truth (§8).
        if (!isUniqueViolation(err)) throw err;
        const survivorId = await markContactMergedIntoPerson(scope, contact.id, person.id);
        if (!survivorId) throw err;
      }

      const enquiries = await listEnquiriesAwaitingOpportunity(scope, contact.id);
      for (const enquiry of enquiries) {
        const opportunity = await client.createOpportunity({
          name: enquiry.contactName ?? contact.name,
          personId: person.id,
          stage: REPLY_STATE_TO_STAGE[enquiry.replyState] ?? "NEW_BRIEF",
          listingUrl: enquiry.listingUrl,
          listingName: null,
        });
        await setTwentyOpportunityId(scope, enquiry.id, opportunity.id);
      }

      await touchTwentyLastSync(contact.orgId);
      result.succeeded++;
    } catch (err) {
      // One bad contact is not an unhealthy instance. The error lands on the
      // contact row so backoff widens for it alone.
      await markContactSyncFailed(scope, contact.id, message(err));
      result.failed++;
    }
  }

  return result;
}

function humaniseOutcome(outcome: string): string {
  return outcome.replace(/_/g, " ");
}

function humaniseDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatActivityNote(activity: UnsyncedActivity): string {
  const day = activity.occurredAt.slice(0, 10);
  const header =
    activity.kind === "call"
      ? `Call on ${day}: ${humaniseOutcome(activity.callOutcome ?? "unknown")}` +
        (activity.callSeconds === null ? "" : ` (${humaniseDuration(activity.callSeconds)})`)
      : `Note on ${day}`;
  return `${header}\n\n${activity.body ?? ""}`.trimEnd();
}

/** Note write-back (C7). Twenty cannot hold the call itself, only a note about it. */
export async function projectPendingActivities(limit = 50): Promise<ProjectionResult> {
  const activities = await withCrossTenantRead("twenty-projection.activities", (client) =>
    claimUnsyncedActivities(client, limit),
  );

  const result: ProjectionResult = { attempted: activities.length, succeeded: 0, failed: 0 };

  for (const activity of activities) {
    try {
      const client = await getTwentyClient(activity.orgId);
      await client.createNote(activity.twentyOpportunityId, formatActivityNote(activity));
      await markActivitySynced(scopeFor(activity.orgId), activity.id);
      result.succeeded++;
    } catch (err) {
      // Deliberately not stamped: synced_to_twenty_at stays NULL so the next
      // tick claims it again. There is no attempt counter on activities, so a
      // permanently broken instance shows up as a growing unsynced backlog
      // rather than as silently dropped notes.
      console.error("twenty-projection: activity note failed", {
        activityId: activity.id,
        orgId: activity.orgId,
        error: message(err),
      });
      result.failed++;
    }
  }

  return result;
}

/** Projects a reply-state change outward. A null stage means do not project. */
export async function projectReplyState(
  scope: Scope,
  enquiryId: string,
  replyState: ReplyState,
  opportunityId: string | null,
): Promise<void> {
  const stage = REPLY_STATE_TO_STAGE[replyState];
  if (!stage || !opportunityId || scope.kind !== "org") return;
  try {
    const client = await getTwentyClient(scope.orgId);
    await client.updateOpportunityStage(opportunityId, stage);
  } catch (err) {
    // A failed projection is retried by the next activity tick and surfaces on
    // last_error; it never blocks the broker (§7).
    console.error("twenty-projection: reply state projection failed", {
      enquiryId,
      replyState,
      error: message(err),
    });
  }
}
```

- [ ] **Step 4: Write the worker script**

```ts
// ads-agent/scripts/run-twenty-projection.ts
/**
 * Drains the Twenty projection backlog on a schedule — `npm run worker:projection`.
 *
 * This is the interim mechanism for tenancy spec §7. At S5a it becomes an
 * outbox consumer: replace the two calls below with subscriptions on
 * `enquiry.received` and `enquiry.activity_logged`. Nothing else changes,
 * because projectPendingContacts and projectPendingActivities keep their
 * signatures.
 */
import cron from "node-cron";
import { projectPendingActivities, projectPendingContacts } from "../lib/crm/twenty-projection";

const SCHEDULE = process.env.TWENTY_PROJECTION_SCHEDULE ?? "*/2 * * * *";

async function tick(): Promise<void> {
  const contacts = await projectPendingContacts(50);
  const activities = await projectPendingActivities(50);
  if (contacts.attempted + activities.attempted === 0) return;
  console.log(
    `twenty projection: contacts ${contacts.succeeded}/${contacts.attempted}, ` +
      `activities ${activities.succeeded}/${activities.attempted}`,
  );
}

cron.schedule(SCHEDULE, () => {
  tick().catch((err) => console.error("twenty projection: tick failed", err));
});

console.log(`twenty projection worker started, schedule="${SCHEDULE}" (Ctrl+C to stop)`);
```

- [ ] **Step 5: Run the tests**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-projection.test.ts`
Expected: PASS, 8 tests.

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/crm/twenty-projection.ts ads-agent/lib/crm/twenty-projection.test.ts \
        ads-agent/scripts/run-twenty-projection.ts
git commit -m "feat(crm): Twenty projection worker

Postgres commits first and Twenty is reached from a worker, so an outage
delays enrichment and never loses an enquiry (TW4). A unique-key collision
on twenty_person_id is the dedup-merge detector. One failing contact never
changes the instance's state -- the error lands on the contact row.

Interim until S5a, when these two functions become outbox consumers with
unchanged signatures."
```

## Task 13: Enquiry API routes

**Wave:** S4-E · **Skills:** `api-designer`, `senior-backend`, `security-auditor` · **Model:** `composer-2.5-fast`

**Files:**
- Create: `ads-agent/app/api/enquiries/route.ts`
- Create: `ads-agent/app/api/enquiries/[id]/route.ts`
- Create: `ads-agent/app/api/enquiries/[id]/state/route.ts`
- Create: `ads-agent/app/api/enquiries/[id]/calls/route.ts`
- Create: `ads-agent/app/api/enquiries/[id]/requirements/route.ts`
- Create: `ads-agent/app/api/enquiries/routes.test.ts`

**Interfaces:**
- Consumes: `requireApiRole` from `ads-agent/lib/auth/dal.ts:98`; `scopeFromSession` (Task 10); `createContact` (Task 3); `createEnquiry`, `listEnquiries`, `getEnquiryById`, `setReplyState`, `countEnquiriesByState` (Task 6); `addMessage`, `listMessages` (Task 7); `logCall`, `logStateChange`, `listActivities`, `CALL_OUTCOMES` (Task 8); `getRequirement`, `upsertRequirement`, `createRevision` (Task 9).
- Produces: the five HTTP endpoints below. Nothing else consumes them inside this plan; the screens are UX work.

| Method and path | Role | Behaviour |
|---|---|---|
| `GET /api/enquiries` | `viewer` | list, optional `?state=waiting\|called\|closed`, plus `counts` |
| `POST /api/enquiries` | `operator` | create contact + enquiry + first message in one transaction |
| `GET /api/enquiries/[id]` | `viewer` | enquiry, messages, activities, requirement — **404** when not this tenant's |
| `PATCH /api/enquiries/[id]/state` | `operator` | set reply state, log the change |
| `POST /api/enquiries/[id]/calls` | `operator` | log a call (C1, C2) |
| `PATCH /api/enquiries/[id]/requirements` | `operator` | manual requirement edit with a `manual` revision (A4) |

**Context:** `middleware.ts:26` excludes `/api` from its matcher, so every one of these routes carries its own `requireApiRole` — following the pattern the eleven already-guarded routes use. **Wrong tenant returns 404, never 403**: a 403 confirms the row exists. Since `getEnquiryById` is scoped, "another tenant's id" and "no such id" produce the same null, and the route cannot accidentally distinguish them.

None of these routes touches Twenty. That is not an omission — it is the gate.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/app/api/enquiries/routes.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiRole = vi.fn();
const scopeFromSession = vi.fn();
const createContact = vi.fn();
const createEnquiry = vi.fn();
const listEnquiries = vi.fn();
const countEnquiriesByState = vi.fn();
const getEnquiryById = vi.fn();
const setReplyState = vi.fn();
const addMessage = vi.fn();
const listMessages = vi.fn();
const logCall = vi.fn();
const logStateChange = vi.fn();
const listActivities = vi.fn();
const getRequirement = vi.fn();
const upsertRequirement = vi.fn();
const createRevision = vi.fn();
const withTenantTransaction = vi.fn(
  async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) => fn({}),
);

vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/auth/scope", () => ({ scopeFromSession }));
vi.mock("@/lib/db/contacts", () => ({ createContact }));
vi.mock("@/lib/db/enquiries", () => ({
  createEnquiry,
  listEnquiries,
  countEnquiriesByState,
  getEnquiryById,
  setReplyState,
}));
vi.mock("@/lib/db/enquiry-messages", () => ({ addMessage, listMessages }));
vi.mock("@/lib/db/enquiry-activities", () => ({
  logCall,
  logStateChange,
  listActivities,
  CALL_OUTCOMES: [
    "spoke_interested",
    "spoke_not_interested",
    "no_answer",
    "voicemail",
    "wrong_number",
    "callback_requested",
  ],
}));
vi.mock("@/lib/db/enquiry-requirements", () => ({
  getRequirement,
  upsertRequirement,
  createRevision,
}));
vi.mock("@/lib/db/tx", () => ({ withTenantTransaction }));

const scope = { kind: "org", orgId: "org-1" } as const;
const session = { userId: "user-7", email: "a@b.c", orgId: "org-1", role: "operator" as const };

beforeEach(() => {
  for (const fn of [
    requireApiRole,
    scopeFromSession,
    createContact,
    createEnquiry,
    listEnquiries,
    countEnquiriesByState,
    getEnquiryById,
    setReplyState,
    addMessage,
    listMessages,
    logCall,
    logStateChange,
    listActivities,
    getRequirement,
    upsertRequirement,
    createRevision,
  ]) {
    fn.mockReset();
  }
  requireApiRole.mockResolvedValue({ ok: true, session });
  scopeFromSession.mockResolvedValue(scope);
});

describe("GET /api/enquiries", () => {
  it("returns the list and the badge counts", async () => {
    listEnquiries.mockResolvedValue([{ id: "enq-1" }]);
    countEnquiriesByState.mockResolvedValue({ waiting: 1, called: 0, closed: 0 });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/enquiries?state=waiting"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      enquiries: [{ id: "enq-1" }],
      counts: { waiting: 1, called: 0, closed: 0 },
    });
    expect(listEnquiries).toHaveBeenCalledWith(scope, { replyState: "waiting" });
  });

  it("rejects an unknown state rather than silently listing everything", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/enquiries?state=nonsense"));
    expect(res.status).toBe(400);
  });

  it("passes the auth failure response straight through", async () => {
    requireApiRole.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    const { GET } = await import("./route");
    expect((await GET(new Request("http://x/api/enquiries"))).status).toBe(401);
  });
});

describe("POST /api/enquiries", () => {
  it("creates contact, enquiry and first message in one transaction and touches no CRM", async () => {
    createContact.mockResolvedValue({ id: "contact-1" });
    createEnquiry.mockResolvedValue({ id: "enq-1" });
    addMessage.mockResolvedValue({ id: "msg-1" });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/enquiries", {
        method: "POST",
        body: JSON.stringify({
          name: "Asha Rao",
          phone: "+919800000000",
          brief: "38 desks in HSR",
        }),
      }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ enquiryId: "enq-1", contactId: "contact-1" });
    expect(withTenantTransaction).toHaveBeenCalledOnce();
    expect(addMessage.mock.calls[0][1]).toMatchObject({ channel: "web_form" });
  });

  it("rejects a body with no name or phone", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/enquiries", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
    expect(createEnquiry).not.toHaveBeenCalled();
  });
});

describe("GET /api/enquiries/[id]", () => {
  it("returns 404, not 403, for another tenant's enquiry", async () => {
    getEnquiryById.mockResolvedValue(null);
    const { GET } = await import("./[id]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "enq-other" }) });
    expect(res.status).toBe(404);
  });

  it("returns the enquiry with its thread, log and requirement", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    listMessages.mockResolvedValue([{ id: "msg-1" }]);
    listActivities.mockResolvedValue([{ id: "act-1" }]);
    getRequirement.mockResolvedValue({ enquiryId: "enq-1", desksMin: 38 });
    const { GET } = await import("./[id]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "enq-1" }) });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      enquiry: { id: "enq-1" },
      messages: [{ id: "msg-1" }],
      activities: [{ id: "act-1" }],
      requirement: { enquiryId: "enq-1", desksMin: 38 },
    });
  });
});

describe("PATCH /api/enquiries/[id]/state", () => {
  it("sets the state and logs the change", async () => {
    setReplyState.mockResolvedValue({ id: "enq-1", replyState: "called" });
    logStateChange.mockResolvedValue({ id: "act-1" });
    const { PATCH } = await import("./[id]/state/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ replyState: "called" }) }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(200);
    expect(logStateChange).toHaveBeenCalledWith(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      body: "Reply state set to called",
    });
  });

  it("404s when the update matched nothing", async () => {
    setReplyState.mockResolvedValue(null);
    const { PATCH } = await import("./[id]/state/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ replyState: "closed" }) }),
      { params: Promise.resolve({ id: "enq-other" }) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects an unknown reply state", async () => {
    const { PATCH } = await import("./[id]/state/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ replyState: "maybe" }) }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(400);
    expect(setReplyState).not.toHaveBeenCalled();
  });
});

describe("POST /api/enquiries/[id]/calls", () => {
  it("logs the call against the session user", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    logCall.mockResolvedValue({ id: "act-1" });
    const { POST } = await import("./[id]/calls/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          outcome: "spoke_interested",
          direction: "outgoing",
          seconds: 240,
          occurredAt: "2026-08-12T05:00:00.000Z",
          notes: "Wants a tour",
        }),
      }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(201);
    expect(logCall).toHaveBeenCalledWith(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      outcome: "spoke_interested",
      direction: "outgoing",
      seconds: 240,
      occurredAt: "2026-08-12T05:00:00.000Z",
      body: "Wants a tour",
    });
  });

  it("rejects an outcome outside the vocabulary (C2)", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    const { POST } = await import("./[id]/calls/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          outcome: "had a nice chat",
          direction: "outgoing",
          seconds: 1,
          occurredAt: "2026-08-12T05:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(400);
    expect(logCall).not.toHaveBeenCalled();
  });

  it("404s before logging when the enquiry is not this tenant's", async () => {
    getEnquiryById.mockResolvedValue(null);
    const { POST } = await import("./[id]/calls/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          outcome: "no_answer",
          direction: "outgoing",
          seconds: 0,
          occurredAt: "2026-08-12T05:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: "enq-other" }) },
    );
    expect(res.status).toBe(404);
    expect(logCall).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/enquiries/[id]/requirements", () => {
  it("writes the requirement and records a manual revision (A4)", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    upsertRequirement.mockResolvedValue({ enquiryId: "enq-1", desksMin: 38 });
    createRevision.mockResolvedValue({ id: "rev-1" });
    const { PATCH } = await import("./[id]/requirements/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ desksMin: 38, desksMax: 38 }),
      }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(200);
    expect(createRevision.mock.calls[0][1]).toMatchObject({ source: "manual" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run app/api/enquiries/routes.test.ts`
Expected: FAIL — five unresolved route imports.

- [ ] **Step 3: Write the list and create route**

```ts
// ads-agent/app/api/enquiries/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { createContact } from "@/lib/db/contacts";
import { countEnquiriesByState, createEnquiry, listEnquiries, REPLY_STATES } from "@/lib/db/enquiries";
import { addMessage } from "@/lib/db/enquiry-messages";
import { createRevision } from "@/lib/db/enquiry-requirements";
import { withTenantTransaction } from "@/lib/db/tx";
import type { ReplyState } from "@/lib/db/enquiries";

export async function GET(req: Request) {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();

  const stateParam = new URL(req.url).searchParams.get("state");
  if (stateParam && !REPLY_STATES.includes(stateParam as ReplyState)) {
    return NextResponse.json(
      { error: `state must be one of ${REPLY_STATES.join(", ")}` },
      { status: 400 },
    );
  }

  const [enquiries, counts] = await Promise.all([
    listEnquiries(scope, stateParam ? { replyState: stateParam as ReplyState } : {}),
    countEnquiriesByState(scope),
  ]);
  return NextResponse.json({ enquiries, counts });
}

type CreateBody = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  brief?: unknown;
  listingUrl?: unknown;
};

export async function POST(req: Request) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!name || !phone) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400 });
  }
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const listingUrl =
    typeof body.listingUrl === "string" && body.listingUrl.trim() ? body.listingUrl.trim() : null;

  // One transaction: the contact, the enquiry and the first message either all
  // exist or none do. Twenty is not involved on this path at all.
  const created = await withTenantTransaction(scope, async (client) => {
    const contact = await createContact(scope, { name, phone, email }, client);
    const enquiry = await createEnquiry(
      scope,
      { contactId: contact.id, contactName: name, contactPhone: phone, contactEmail: email, listingUrl },
      client,
    );
    if (brief) {
      await addMessage(
        scope,
        { enquiryId: enquiry.id, channel: "web_form", body: brief },
        client,
      );
      await createRevision(
        scope,
        { enquiryId: enquiry.id, source: "web_form", proposed: {} },
        client,
      );
    }
    return { enquiryId: enquiry.id, contactId: contact.id };
  });

  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 4: Write the detail route**

```ts
// ads-agent/app/api/enquiries/[id]/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getEnquiryById } from "@/lib/db/enquiries";
import { listActivities } from "@/lib/db/enquiry-activities";
import { listMessages } from "@/lib/db/enquiry-messages";
import { getRequirement } from "@/lib/db/enquiry-requirements";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  // Scoped read, so another tenant's id and a nonexistent id are the same
  // null. 404 either way: a 403 would confirm the row exists.
  const enquiry = await getEnquiryById(scope, id);
  if (!enquiry) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [messages, activities, requirement] = await Promise.all([
    listMessages(scope, id),
    listActivities(scope, id),
    getRequirement(scope, id),
  ]);
  return NextResponse.json({ enquiry, messages, activities, requirement });
}
```

- [ ] **Step 5: Write the state, calls and requirements routes**

```ts
// ads-agent/app/api/enquiries/[id]/state/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { REPLY_STATES, setReplyState, type ReplyState } from "@/lib/db/enquiries";
import { logStateChange } from "@/lib/db/enquiry-activities";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  let replyState: unknown;
  try {
    ({ replyState } = (await req.json()) as { replyState?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof replyState !== "string" || !REPLY_STATES.includes(replyState as ReplyState)) {
    return NextResponse.json(
      { error: `replyState must be one of ${REPLY_STATES.join(", ")}` },
      { status: 400 },
    );
  }

  const enquiry = await setReplyState(scope, id, replyState as ReplyState);
  if (!enquiry) return NextResponse.json({ error: "not found" }, { status: 404 });

  await logStateChange(scope, {
    enquiryId: id,
    actorUserId: access.session.userId,
    body: `Reply state set to ${replyState}`,
  });
  return NextResponse.json({ enquiry });
}
```

```ts
// ads-agent/app/api/enquiries/[id]/calls/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getEnquiryById } from "@/lib/db/enquiries";
import { CALL_OUTCOMES, logCall, type CallOutcome } from "@/lib/db/enquiry-activities";

type CallBody = {
  outcome?: unknown;
  direction?: unknown;
  seconds?: unknown;
  occurredAt?: unknown;
  notes?: unknown;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  let body: CallBody;
  try {
    body = (await req.json()) as CallBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof body.outcome !== "string" || !CALL_OUTCOMES.includes(body.outcome as CallOutcome)) {
    return NextResponse.json(
      { error: `outcome must be one of ${CALL_OUTCOMES.join(", ")}` },
      { status: 400 },
    );
  }
  if (body.direction !== "outgoing" && body.direction !== "incoming") {
    return NextResponse.json({ error: "direction must be outgoing or incoming" }, { status: 400 });
  }
  const seconds = Number(body.seconds);
  if (!Number.isInteger(seconds) || seconds < 0) {
    return NextResponse.json({ error: "seconds must be a whole number, zero or more" }, { status: 400 });
  }
  if (typeof body.occurredAt !== "string" || Number.isNaN(Date.parse(body.occurredAt))) {
    return NextResponse.json({ error: "occurredAt must be an ISO timestamp" }, { status: 400 });
  }

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const activity = await logCall(scope, {
    enquiryId: id,
    actorUserId: access.session.userId,
    outcome: body.outcome as CallOutcome,
    direction: body.direction,
    seconds,
    occurredAt: body.occurredAt,
    body: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
  });
  return NextResponse.json({ activity }, { status: 201 });
}
```

```ts
// ads-agent/app/api/enquiries/[id]/requirements/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getEnquiryById } from "@/lib/db/enquiries";
import {
  createRevision,
  upsertRequirement,
  type RequirementPatch,
} from "@/lib/db/enquiry-requirements";

function parsePatch(body: Record<string, unknown>): RequirementPatch | { error: string } {
  const patch: RequirementPatch = {};
  if (body.desksMin !== undefined) {
    const n = Number(body.desksMin);
    if (!Number.isInteger(n) || n <= 0) return { error: "desksMin must be a positive integer" };
    patch.desksMin = n;
  }
  if (body.desksMax !== undefined) {
    const n = Number(body.desksMax);
    if (!Number.isInteger(n) || n <= 0) return { error: "desksMax must be a positive integer" };
    patch.desksMax = n;
  }
  if (patch.desksMin && patch.desksMax && patch.desksMax < patch.desksMin) {
    return { error: "desksMax must be at least desksMin" };
  }
  if (body.budgetPerDeskInr !== undefined) {
    const n = Number(body.budgetPerDeskInr);
    if (!Number.isFinite(n) || n < 0) return { error: "budgetPerDeskInr must be zero or more" };
    patch.budgetPerDeskInr = n;
  }
  if (body.moveInBy !== undefined) {
    if (typeof body.moveInBy !== "string" || Number.isNaN(Date.parse(body.moveInBy))) {
      return { error: "moveInBy must be an ISO date" };
    }
    patch.moveInBy = body.moveInBy.slice(0, 10);
  }
  if (body.mustHaves !== undefined) {
    if (!Array.isArray(body.mustHaves) || body.mustHaves.some((v) => typeof v !== "string")) {
      return { error: "mustHaves must be an array of strings" };
    }
    patch.mustHaves = body.mustHaves as string[];
  }
  return patch;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parsePatch(raw);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (Object.keys(parsed).length === 0) {
    return NextResponse.json({ error: "no requirement fields supplied" }, { status: 400 });
  }

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // A manual edit is still a revision: the trail is what makes it reversible (A4).
  const [requirement] = await Promise.all([
    upsertRequirement(scope, id, parsed),
    createRevision(scope, { enquiryId: id, source: "manual", proposed: parsed }),
  ]);
  return NextResponse.json({ requirement });
}
```

- [ ] **Step 6: Run the tests**

Run: `cd ads-agent && npx vitest run app/api/enquiries/routes.test.ts`
Expected: PASS, 12 tests.

Run: `cd ads-agent && npx vitest run app/api/route-auth.test.ts`
Expected: PASS — the S1 static guard still holds for the pre-existing routes.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/app/api/enquiries/
git commit -m "feat(api): enquiry list, detail, state, calls and requirements

Every route guards itself, because middleware.ts excludes /api from its
matcher. A wrong-tenant id returns 404 and not 403: the read is scoped, so
'someone else's' and 'nonexistent' are the same null and the route cannot
distinguish them even by accident. No route touches Twenty."
```

## Task 14: Invert the marketing site's capture path (B1, B4)

**Wave:** S4-E · **Skills:** `senior-fullstack`, `refactoring-specialist` · **Model:** `inherit`

**Files (all in the root listings app):**
- Create: `lib/db/tenant-tx.ts`
- Create: `lib/enquiries/capture.ts`
- Create: `lib/enquiries/capture.test.ts`
- Create: `lib/enquiries/capture-contract.test.ts`
- Modify: `app/api/leads/route.ts:1-76`
- Modify: `app/api/leads/route.test.ts`
- Delete: `lib/crm/twenty.ts`
- Delete: `lib/crm/twenty.test.ts`

**Interfaces:**
- Consumes: `getPool()` from `lib/db/client.ts:5`; `qualifyLead` from `lib/ai/client`; `foldStep2Answers` from `lib/leads/step2-fields`; `LeadPayload` from `lib/whatsapp`.
- Produces:
  - `withTenantTransaction<T>(orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T>` in `lib/db/tenant-tx.ts`
  - `captureEnquiry(input: CaptureEnquiryInput): Promise<CapturedEnquiry>` in `lib/enquiries/capture.ts`
  - `CaptureEnquiryInput = { orgId: string; name: string; phone: string; email?: string | null; need: string; brief: string; listingUrl?: string | null; listingName?: string | null; tier: string }`
  - `CapturedEnquiry = { enquiryId: string; contactId: string; messageId: string }`

**Context:** Backend spec B1 and BD6, reversed 2026-08-12. `app/api/leads/route.ts` today runs an AI qualification and then calls `createLeadInTwenty()`, which means **a Twenty outage loses the enquiry** — there is no local row to retry from. Inverting it makes the enquiry the record and Twenty the projection: this route commits to Postgres and the ads-agent projection worker (Task 12) creates the person and opportunity later.

Gentle Space is itself a tenant (TW7): the marketing site's leads go to the Gentle Space org's own instance, and there is no special platform path. The org id comes from `GENTLE_SPACE_ORG_ID`.

**Why the SQL is duplicated rather than shared.** The root app and `ads-agent` are two Next apps with separate `package.json`, `tsconfig` and module graphs; importing across them means reaching outside a Next root directory, which is fragile in a way that a single `INSERT` is not. After S2 they share one Postgres instance, so the root app writes `adsagent.*` directly through its own pool. `capture-contract.test.ts` reads both files from disk and asserts the two capture paths insert the same column set, so the duplication cannot silently drift.

`lib/crm/twenty.ts` is **deleted** rather than ported. After the inversion the marketing site never calls Twenty, so there is nothing to make tenant-aware — which is the smallest possible resolution of the "three ways to reach Twenty" problem for this side of the repo.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/enquiries/capture.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../db/tenant-tx", () => ({
  withTenantTransaction: async (_orgId: string, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { captureEnquiry } from "./capture";

beforeEach(() => {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
    .mockResolvedValueOnce({ rows: [{ id: "enq-1" }] })
    .mockResolvedValueOnce({ rows: [{ id: "msg-1" }] })
    .mockResolvedValueOnce({ rows: [{ id: "rev-1" }] });
});

const input = {
  orgId: "org-gentle-space",
  name: "Asha Rao",
  phone: "+919800000000",
  need: "office",
  brief: "38 desks in HSR, move in by September",
  listingUrl: "https://gentlespace.in/spaces/hsr-1",
  listingName: "HSR Workspace One",
  tier: "hot",
};

describe("captureEnquiry", () => {
  it("commits the contact, enquiry, message and revision in one transaction", async () => {
    await expect(captureEnquiry(input)).resolves.toEqual({
      enquiryId: "enq-1",
      contactId: "contact-1",
      messageId: "msg-1",
    });

    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("INSERT INTO adsagent.contacts");
    expect(statements[1]).toContain("INSERT INTO adsagent.enquiries");
    expect(statements[2]).toContain("INSERT INTO adsagent.enquiry_messages");
    expect(statements[3]).toContain("INSERT INTO adsagent.enquiry_requirement_revisions");
  });

  it("starts the contact pending so the projection worker enriches it later", async () => {
    await captureEnquiry(input);
    expect(String(query.mock.calls[0][0])).not.toContain("twenty_person_id");
  });

  it("labels the first message as coming via the website form (B4)", async () => {
    await captureEnquiry(input);
    expect(query.mock.calls[2][1]).toContain("web_form");
  });

  it("records the form's own answers as a web_form revision, not as the requirement", async () => {
    await captureEnquiry(input);
    expect(query.mock.calls[3][1]).toContain("web_form");
    expect(query.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(
      "INSERT INTO adsagent.enquiry_requirements",
    );
  });
});
```

```ts
// lib/enquiries/capture-contract.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two Next apps with separate module graphs each own a capture path. They are
 * allowed to be separate files; they are not allowed to drift. This asserts
 * both insert into the same four tables.
 */
const TABLES = [
  "adsagent.contacts",
  "adsagent.enquiries",
  "adsagent.enquiry_messages",
  "adsagent.enquiry_requirement_revisions",
];

describe("both capture paths write the same tables", () => {
  const site = readFileSync(join(__dirname, "capture.ts"), "utf8");
  const admin = readFileSync(
    join(__dirname, "..", "..", "ads-agent", "app", "api", "enquiries", "route.ts"),
    "utf8",
  );
  const adminDataLayer = ["contacts", "enquiries", "enquiry-messages", "enquiry-requirements"]
    .map((m) => readFileSync(join(__dirname, "..", "..", "ads-agent", "lib", "db", `${m}.ts`), "utf8"))
    .join("\n");

  it.each(TABLES)("the marketing site inserts into %s", (table) => {
    expect(site).toContain(`INSERT INTO ${table}`);
  });

  it.each(TABLES)("the admin path reaches %s through its data layer", (table) => {
    expect(adminDataLayer).toContain(`INSERT INTO ${table}`);
  });

  it("neither capture path imports a CRM client", () => {
    expect(site).not.toMatch(/from\s+["'][^"']*crm\//);
    expect(admin).not.toMatch(/from\s+["'][^"']*crm\//);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run lib/enquiries/`
Expected: FAIL — `Failed to resolve import "./capture"`.

- [ ] **Step 3: Write the tenant transaction helper and the capture function**

```ts
// lib/db/tenant-tx.ts
import type { PoolClient } from "pg";
import { getPool } from "./client";

/**
 * The listings app's equivalent of ads-agent/lib/db/tx.ts. Separate file
 * because the two apps have separate module graphs; identical semantics,
 * because FORCE ROW LEVEL SECURITY does not care which app is connecting.
 * set_tenant is transaction-scoped, so a pooled connection cannot carry the
 * tenant into the next request.
 */
export async function withTenantTransaction<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!orgId) throw new Error("withTenantTransaction: orgId is required");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
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
```

```ts
// lib/enquiries/capture.ts
import { withTenantTransaction } from "../db/tenant-tx";

export type CaptureEnquiryInput = {
  orgId: string;
  name: string;
  phone: string;
  email?: string | null;
  need: string;
  brief: string;
  listingUrl?: string | null;
  listingName?: string | null;
  tier: string;
};

export type CapturedEnquiry = {
  enquiryId: string;
  contactId: string;
  messageId: string;
};

/**
 * The marketing site's capture path. Postgres is the system of record and
 * Twenty is a projection (BD6, reversed 2026-08-12): this function does not
 * call Twenty, and the ads-agent projection worker creates the person and
 * opportunity afterwards. A Twenty outage therefore delays enrichment instead
 * of losing the enquiry, which is what the old synchronous
 * createLeadInTwenty() could not promise.
 *
 * Gentle Space is itself a tenant (TW7), so orgId is a real tenant id and not
 * a special platform path.
 */
export async function captureEnquiry(input: CaptureEnquiryInput): Promise<CapturedEnquiry> {
  return withTenantTransaction(input.orgId, async (client) => {
    const contact = await client.query<{ id: string }>(
      `INSERT INTO adsagent.contacts (org_id, name, phone, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.orgId, input.name, input.phone, input.email ?? null],
    );
    const contactId = contact.rows[0].id;

    const enquiry = await client.query<{ id: string }>(
      `INSERT INTO adsagent.enquiries
         (org_id, contact_id, listing_url, contact_name, contact_phone, contact_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.orgId,
        contactId,
        input.listingUrl ?? null,
        input.name,
        input.phone,
        input.email ?? null,
      ],
    );
    const enquiryId = enquiry.rows[0].id;

    const message = await client.query<{ id: string }>(
      `INSERT INTO adsagent.enquiry_messages
         (org_id, enquiry_id, channel, body, received_at)
       VALUES ($1, $2, 'web_form', $3, now())
       RETURNING id`,
      [input.orgId, enquiryId, input.brief],
    );

    // The form's structured answers are a *proposal* about the requirement,
    // not the requirement: a human confirms them like any other extraction
    // (C3). listingName and tier travel here so nothing captured is lost
    // before the projection worker reads it.
    await client.query(
      `INSERT INTO adsagent.enquiry_requirement_revisions
         (org_id, enquiry_id, source, proposed)
       VALUES ($1, $2, 'web_form', $3::jsonb)`,
      [
        input.orgId,
        enquiryId,
        JSON.stringify({
          need: input.need,
          tier: input.tier,
          listingName: input.listingName ?? null,
        }),
      ],
    );

    return { enquiryId, contactId, messageId: message.rows[0].id };
  });
}
```

- [ ] **Step 4: Invert the route**

Replace `app/api/leads/route.ts` lines 1–10 and 52–76 (leave `parseLead`, `parseStep2Answers` and `isPlainRecord` exactly as they are):

```ts
import { NextResponse } from "next/server";
import { qualifyLead } from "@/lib/ai/client";
import { captureEnquiry } from "@/lib/enquiries/capture";
import { foldStep2Answers } from "@/lib/leads/step2-fields";
import type { LeadPayload, NeedType } from "@/lib/whatsapp";

// Node runtime (not edge) so this handler keeps running the AI call and the
// database write to completion even if the client that sent the request gives
// up waiting -- see the design spec's client-abort architecture. Do not forward
// `request`'s own cancellation into qualifyLead or captureEnquiry.
export const runtime = "nodejs";
```

```ts
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payload = parseLead(raw);
  if (!payload) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const orgId = process.env.GENTLE_SPACE_ORG_ID?.trim();
  if (!orgId) {
    console.error("[leads] GENTLE_SPACE_ORG_ID is not set");
    return NextResponse.json({ error: "capture unavailable" }, { status: 503 });
  }

  const qualification = await qualifyLead({
    need: payload.need,
    step2Answers: payload.step2Answers ?? {},
    notes: payload.brief,
  });

  // Postgres first, always. Twenty is reached later by the ads-agent
  // projection worker, so an outage there cannot lose this enquiry (TW4).
  const captured = await captureEnquiry({
    orgId,
    name: payload.name,
    phone: payload.phone,
    need: payload.need,
    brief: foldStep2Answers(payload.need, payload.step2Answers, payload.brief),
    listingUrl: payload.propertyUrl ?? null,
    listingName: payload.propertyName ?? null,
    tier: qualification.tier,
  });

  // `crm: "pending"` keeps the existing response shape the form already reads,
  // and is now honest: the CRM write has not happened yet and will be done by
  // the projection worker.
  return NextResponse.json({
    ok: true,
    crm: "pending",
    tier: qualification.tier,
    enquiryId: captured.enquiryId,
  });
}
```

- [ ] **Step 5: Delete the dead Twenty client and update the route test**

```bash
git rm lib/crm/twenty.ts lib/crm/twenty.test.ts
```

In `app/api/leads/route.test.ts`, replace the `@/lib/crm/twenty` mock with:

```ts
const captureEnquiry = vi.fn();
vi.mock("@/lib/enquiries/capture", () => ({ captureEnquiry }));
```

and set `process.env.GENTLE_SPACE_ORG_ID = "org-gentle-space"` in `beforeEach`. Replace every assertion about `createLeadInTwenty` with the equivalent on `captureEnquiry`, keep every assertion about `parseLead` validation and about `qualifyLead` unchanged, and add:

```ts
it("still returns 200 and an enquiry id when the CRM is unreachable", async () => {
  // The point of the inversion: this route no longer knows Twenty exists.
  captureEnquiry.mockResolvedValue({
    enquiryId: "enq-1",
    contactId: "contact-1",
    messageId: "msg-1",
  });
  const res = await POST(
    new Request("http://x/api/leads", {
      method: "POST",
      body: JSON.stringify({ name: "Asha", phone: "+919800000000", brief: "hi", need: "office" }),
    }),
  );
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ crm: "pending", enquiryId: "enq-1" });
});

it("refuses to capture without a configured org rather than dropping the lead silently", async () => {
  delete process.env.GENTLE_SPACE_ORG_ID;
  const res = await POST(
    new Request("http://x/api/leads", {
      method: "POST",
      body: JSON.stringify({ name: "Asha", phone: "+919800000000", brief: "hi", need: "office" }),
    }),
  );
  expect(res.status).toBe(503);
  expect(captureEnquiry).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run the root app suite**

Run: `npx vitest run`
Expected: PASS, including `lib/enquiries/capture.test.ts` (4), `lib/enquiries/capture-contract.test.ts` (9) and `app/api/leads/route.test.ts`.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `grep -rn "createLeadInTwenty\|TWENTY_BASE_URL" app/ lib/ --include=*.ts --include=*.tsx`
Expected: no output. The marketing site no longer knows Twenty exists.

- [ ] **Step 7: Commit**

```bash
git add -A app/api/leads lib/enquiries lib/db/tenant-tx.ts lib/crm
git commit -m "feat(leads): commit the enquiry to Postgres, not to Twenty

app/api/leads/route.ts ran an AI qualification then posted straight to
Twenty, so a Twenty outage lost the enquiry outright -- there was no local
row to retry from. The enquiry is now the record and Twenty is the
projection (BD6, reversed). lib/crm/twenty.ts is deleted rather than made
tenant-aware, because after the inversion this app never calls Twenty."
```

## Task 15: Suppression, ledger propagation, and the scheduled erasure sweep

**Wave:** S4-E · **Skills:** `gdpr-dsgvo-expert`, `senior-backend` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/db/erasure.ts`
- Create: `ads-agent/lib/db/erasure.test.ts`
- Create: `ads-agent/app/api/enquiries/[id]/suppress/route.ts`
- Create: `ads-agent/scripts/run-erasure-sweep.ts`

**Interfaces:**
- Consumes: `createDeletionRequest`, `setPropagation`, `listDueErasures`, `markErased`, `RETENTION_FLOOR_DAYS` (Task 5); `withCrossTenantRead` (Task 5); `recordAccess` (Task 5); `withTenantTransaction`, `orgIdForWrite` (Task 2); `getEnquiryById` (Task 6); `getTwentyClient` — **no**, see below.
- Produces:
  - `suppressEnquiry(scope, enquiryId, actorUserId): Promise<{ requestId: string } | null>`
  - `hardEraseEnquiry(scope, enquiryId): Promise<void>`
  - `runErasureSweep(limit?: number): Promise<{ erased: number }>`

**Context:** Data model §6.1; datastore §11.1. Erasure is three steps and the first two are one transaction: **suppress immediately** (tombstone, block every access path, so from the user's perspective the data is gone), **retain physically** for the statutory floor, then **hard-erase on a schedule**. Building delete-on-request would be non-compliant in the opposite direction from the usual mistake.

Suppression works by flipping `lifecycle` to `'suppressed'` and setting `erase_after`. Every read in this plan already carries `lifecycle = 'active'`, so suppression blocks reads without a single change to the read paths — which is precisely why this had to be designed in at S4 rather than retrofitted.

**This module does not import the Twenty client**, even though per-subject erasure has to delete the person in that org's Twenty. `lib/db/no-crm-imports.test.ts` forbids it, and the reason holds here too: the request path must not depend on Twenty being up. So suppression writes `context.deletion_propagations` with `store = 'twenty'` in state `'pending'`, and the projection worker's next tick is what closes it. Task 16 verifies the row exists; the Twenty-side deletion consumer is S5a work, and the ledger row is what makes that debt visible to a regulator rather than invisible.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/erasure.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const createDeletionRequest = vi.fn();
const setPropagation = vi.fn();
const listDueErasures = vi.fn();
const markErased = vi.fn();
const recordAccess = vi.fn();

vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./cross-tenant", () => ({
  withCrossTenantRead: async (_actor: string, fn: (c: unknown) => Promise<unknown>) => fn({ query }),
}));
vi.mock("./deletion-requests", () => ({
  createDeletionRequest,
  setPropagation,
  listDueErasures,
  markErased,
  RETENTION_FLOOR_DAYS: 365,
}));
vi.mock("./access-log", () => ({ recordAccess }));

import { hardEraseEnquiry, runErasureSweep, suppressEnquiry } from "./erasure";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  createDeletionRequest.mockReset().mockResolvedValue({
    id: "req-1",
    eraseAfter: "2027-08-12",
  });
  setPropagation.mockReset().mockResolvedValue(undefined);
  listDueErasures.mockReset().mockResolvedValue([]);
  markErased.mockReset().mockResolvedValue(undefined);
  recordAccess.mockReset().mockResolvedValue(undefined);
});

describe("suppressEnquiry", () => {
  it("suppresses rather than deletes, and sets the retention floor", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "enq-1", contact_id: "contact-1" }] });
    await expect(suppressEnquiry(scope, "enq-1", "user-7")).resolves.toEqual({
      requestId: "req-1",
    });

    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements.join("\n")).not.toContain("DELETE FROM");
    expect(statements.some((s) => s.includes("lifecycle = 'suppressed'"))).toBe(true);
    expect(statements.some((s) => s.includes("erase_after"))).toBe(true);
  });

  it("opens a ledger row per store, with Twenty pending rather than skipped", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "enq-1", contact_id: "contact-1" }] });
    await suppressEnquiry(scope, "enq-1", "user-7");
    expect(setPropagation).toHaveBeenCalledWith(scope, "req-1", "postgres", "suppressed", null);
    expect(setPropagation).toHaveBeenCalledWith(
      scope,
      "req-1",
      "twenty",
      "pending",
      expect.stringContaining("projection"),
    );
  });

  it("audits who suppressed what", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "enq-1", contact_id: "contact-1" }] });
    await suppressEnquiry(scope, "enq-1", "user-7");
    expect(recordAccess).toHaveBeenCalledWith(
      scope,
      {
        actorKind: "user",
        actorRef: "user-7",
        action: "enquiry.suppress",
        subjectKind: "enquirer",
        subjectRef: "enq-1",
      },
      expect.anything(),
    );
  });

  it("returns null for an enquiry that is not this tenant's active one", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(suppressEnquiry(scope, "enq-other", "user-7")).resolves.toBeNull();
    expect(createDeletionRequest).not.toHaveBeenCalled();
  });
});

describe("hardEraseEnquiry", () => {
  it("clears the personal columns and marks the row erased, keeping the shell", async () => {
    await hardEraseEnquiry(scope, "enq-1");
    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("lifecycle = 'erased'");
    expect(statements[0]).toContain("contact_phone = NULL");
    expect(statements[0]).toContain("contact_email = NULL");
    expect(statements.some((s) => s.includes("adsagent.enquiry_messages"))).toBe(true);
    expect(statements.join("\n")).not.toContain("DELETE FROM adsagent.enquiries");
  });
});

describe("runErasureSweep", () => {
  it("erases only requests whose retention floor has passed", async () => {
    listDueErasures.mockResolvedValue([
      { id: "req-1", orgId: "org-1", subjectKind: "enquirer", subjectRef: "enq-1" },
    ]);
    await expect(runErasureSweep()).resolves.toEqual({ erased: 1 });
    expect(markErased).toHaveBeenCalledWith({ kind: "org", orgId: "org-1" }, "req-1");
    expect(setPropagation).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "req-1",
      "postgres",
      "erased",
      null,
    );
  });

  it("skips a subject kind it cannot erase rather than guessing", async () => {
    listDueErasures.mockResolvedValue([
      { id: "req-2", orgId: "org-1", subjectKind: "tenant", subjectRef: "org-1" },
    ]);
    await expect(runErasureSweep()).resolves.toEqual({ erased: 0 });
    expect(markErased).not.toHaveBeenCalled();
    expect(setPropagation).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "req-2",
      "postgres",
      "failed",
      expect.stringContaining("tenant"),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/erasure.test.ts`
Expected: FAIL — `Failed to resolve import "./erasure"`.

- [ ] **Step 3: Write the erasure module**

```ts
// ads-agent/lib/db/erasure.ts
import { recordAccess } from "./access-log";
import { withCrossTenantRead } from "./cross-tenant";
import {
  createDeletionRequest,
  listDueErasures,
  markErased,
  setPropagation,
} from "./deletion-requests";
import type { Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

/**
 * Step 1 and 2 of the three-step erasure in datastore §11.1: suppress
 * immediately, retain physically for the statutory floor. The hard delete is
 * runErasureSweep, on a schedule.
 *
 * Suppression works because every read in the enquiry spine carries
 * `lifecycle = 'active'`. That is why this had to be designed in at S4:
 * retrofitting it would mean auditing every read instead of adding one column.
 */
export async function suppressEnquiry(
  scope: Scope,
  enquiryId: string,
  actorUserId: string,
): Promise<{ requestId: string } | null> {
  const orgId = orgIdForWrite(scope);

  const request = await withTenantTransaction(scope, async (client) => {
    const found = await client.query<{ id: string; contact_id: string | null }>(
      `SELECT id, contact_id FROM adsagent.enquiries
        WHERE org_id = $1 AND id = $2 AND lifecycle = 'active'
          FOR UPDATE`,
      [orgId, enquiryId],
    );
    if (!found.rows[0]) return null;
    const contactId = found.rows[0].contact_id;

    const ledger = await createDeletionRequest(scope, {
      subjectKind: "enquirer",
      subjectRef: enquiryId,
    });

    await client.query(
      `UPDATE adsagent.enquiries
          SET lifecycle = 'suppressed', suppressed_at = now(),
              erase_after = $3::date, updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, enquiryId, ledger.eraseAfter],
    );

    if (contactId) {
      // Only if this was the contact's last active enquiry: a person with a
      // live enquiry elsewhere has not asked to be forgotten.
      await client.query(
        `UPDATE adsagent.contacts c
            SET lifecycle = 'suppressed', suppressed_at = now(),
                erase_after = $3::date, updated_at = now()
          WHERE c.org_id = $1 AND c.id = $2
            AND NOT EXISTS (
              SELECT 1 FROM adsagent.enquiries e
               WHERE e.org_id = c.org_id AND e.contact_id = c.id AND e.lifecycle = 'active'
            )`,
        [orgId, contactId, ledger.eraseAfter],
      );
    }

    await recordAccess(
      scope,
      {
        actorKind: "user",
        actorRef: actorUserId,
        action: "enquiry.suppress",
        subjectKind: "enquirer",
        subjectRef: enquiryId,
      },
      client,
    );

    return ledger;
  });

  if (!request) return null;

  await setPropagation(scope, request.id, "postgres", "suppressed", null);
  // Deliberately pending, not skipped. This module must not import the Twenty
  // client -- the request path cannot depend on Twenty being up -- so the
  // person deletion is owed, and the ledger row is what makes the debt visible
  // to a regulator instead of invisible.
  await setPropagation(
    scope,
    request.id,
    "twenty",
    "pending",
    "awaiting the projection worker's deletion consumer (S5a)",
  );

  return { requestId: request.id };
}

/**
 * Step 3: the hard delete, once the floor has passed. The enquiry shell
 * survives with `lifecycle = 'erased'` and its personal columns nulled, so a
 * dangling reference renders "content erased" instead of an unexplained 404 —
 * and so the row count stays auditable.
 */
export async function hardEraseEnquiry(scope: Scope, enquiryId: string): Promise<void> {
  const orgId = orgIdForWrite(scope);
  await withTenantTransaction(scope, async (client) => {
    await client.query(
      `UPDATE adsagent.enquiries
          SET lifecycle = 'erased',
              contact_name = NULL,
              contact_phone = NULL,
              contact_email = NULL,
              updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, enquiryId],
    );
    await client.query(
      `UPDATE adsagent.enquiry_messages SET body = '[erased]'
        WHERE org_id = $1 AND enquiry_id = $2`,
      [orgId, enquiryId],
    );
    await client.query(
      `UPDATE adsagent.enquiry_activities SET body = NULL
        WHERE org_id = $1 AND enquiry_id = $2 AND body IS NOT NULL`,
      [orgId, enquiryId],
    );
    await client.query(
      `UPDATE adsagent.contacts c
          SET lifecycle = 'erased', name = '[erased]', phone = NULL, email = NULL,
              updated_at = now()
        WHERE c.org_id = $1
          AND c.id = (SELECT contact_id FROM adsagent.enquiries
                       WHERE org_id = $1 AND id = $2)
          AND NOT EXISTS (
            SELECT 1 FROM adsagent.enquiries e
             WHERE e.org_id = c.org_id AND e.contact_id = c.id AND e.lifecycle <> 'erased'
          )`,
      [orgId, enquiryId],
    );
  });
}

export async function runErasureSweep(limit = 100): Promise<{ erased: number }> {
  const due = await withCrossTenantRead("erasure-sweep", (client) =>
    listDueErasures(client, limit),
  );

  let erased = 0;
  for (const request of due) {
    const scope: Scope = { kind: "org", orgId: request.orgId };
    if (request.subjectKind !== "enquirer") {
      // 'user' and 'tenant' erasure are not this plan's scope, and guessing at
      // them would be worse than recording that they are outstanding.
      await setPropagation(
        scope,
        request.id,
        "postgres",
        "failed",
        `subject_kind ${request.subjectKind} has no erasure path yet`,
      );
      continue;
    }
    await hardEraseEnquiry(scope, request.subjectRef);
    await setPropagation(scope, request.id, "postgres", "erased", null);
    await markErased(scope, request.id);
    erased++;
  }
  return { erased };
}
```

- [ ] **Step 4: Write the suppress route and the sweep script**

```ts
// ads-agent/app/api/enquiries/[id]/suppress/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { suppressEnquiry } from "@/lib/db/erasure";

/**
 * "Delete" from the user's point of view. Suppression, not DELETE: DPDP Rule
 * 8(3) requires a one-year retention floor even after the subject deletes
 * their account, so a real delete here would be non-compliant.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  const result = await suppressEnquiry(scope, id, access.session.userId);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ suppressed: true, deletionRequestId: result.requestId });
}
```

```ts
// ads-agent/scripts/run-erasure-sweep.ts
/**
 * Hard-erases every deletion request whose retention floor has passed.
 * Deliberately not registered as an npm script: it is run from cron or by hand,
 * and keeping it out of package.json meant no second agent in its wave had to
 * touch that file.
 *
 *   npx tsx --env-file=.env.local scripts/run-erasure-sweep.ts
 */
import { runErasureSweep } from "../lib/db/erasure";

runErasureSweep()
  .then((result) => {
    console.log(`erasure sweep: ${result.erased} request(s) erased`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("erasure sweep failed", err);
    process.exit(1);
  });
```

- [ ] **Step 5: Run the tests**

Run: `cd ads-agent && npx vitest run lib/db/erasure.test.ts lib/db/no-crm-imports.test.ts`
Expected: PASS, 7 + 2 tests. The second file is what proves `erasure.ts` did not reach for the Twenty client.

Run: `grep -rn "DELETE FROM adsagent" ads-agent/lib/ --include=*.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/erasure.ts ads-agent/lib/db/erasure.test.ts \
        ads-agent/app/api/enquiries/[id]/suppress/route.ts \
        ads-agent/scripts/run-erasure-sweep.ts
git commit -m "feat(compliance): suppression, ledger, scheduled erasure

DPDP Rule 8(3) requires a one-year retention floor even after the subject
deletes their account, so erasure is suppress-then-erase and there is no
DELETE anywhere in the data layer. Suppression works without touching a
single read path because every read already filters lifecycle = 'active' --
which is the whole reason this landed at S4 rather than later."
```

## Task 16 (fan-in): the S4 gate

**Wave:** S4-F · **Skills:** `senior-qa`, `tdd-guide`, `adversarial-reviewer` · **Model:** `inherit`

**Files:**
- Modify: `ads-agent/lib/db/twenty-connections.ts` (dynamic import of `./cross-tenant` becomes static)
- Create: `ads-agent/lib/enquiries/enquiry-spine.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–15.
- Produces: the gate. Nothing consumes it.

**Context:** This task merges the four wave-S4-E branches and proves the two things the S4 gate actually claims: **a broker can work an enquiry end to end**, and **an enquiry survives Twenty being down**. It is a database-backed test, not a mocked one — the mocked-pool tests in every earlier task prove the SQL a module emits, and this one proves the SQL works and that RLS lets the right rows through.

- [ ] **Step 1: Merge the wave and resolve the one known conflict**

```bash
git checkout main
git merge --no-ff s4e-projection s4e-routes s4e-leads-inversion s4e-erasure
```

Expected: one conflict at most, in `ads-agent/app/api/enquiries/` if two branches created a directory-level file. Resolve by keeping both files.

Then make the dynamic import in `orgsWithoutOwnInstance` static, now that `./cross-tenant` exists on the merged branch:

```ts
// ads-agent/lib/db/twenty-connections.ts — top of file
import { withCrossTenantRead } from "./cross-tenant";
```

and delete the `const { withCrossTenantRead } = await import("./cross-tenant");` line from the body of `orgsWithoutOwnInstance`.

- [ ] **Step 2: Write the gate test**

```ts
// ads-agent/lib/enquiries/enquiry-spine.integration.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPool } from "../db/client";
import { createContact, getContactById } from "../db/contacts";
import {
  countEnquiriesByState,
  createEnquiry,
  getEnquiryById,
  listEnquiries,
  setReplyState,
} from "../db/enquiries";
import { listActivities, logCall } from "../db/enquiry-activities";
import { addMessage, listMessages } from "../db/enquiry-messages";
import { applyRevision, createRevision, getRequirement } from "../db/enquiry-requirements";
import { suppressEnquiry } from "../db/erasure";
import type { Scope } from "../db/scope-sql";

/**
 * Database-backed on purpose. Every other test in this plan mocks the pool and
 * proves what SQL a module emits; this one proves the SQL runs, that RLS
 * admits the right rows, and that the whole loop works with Twenty absent.
 */
if (!process.env.DATABASE_URL) {
  throw new Error("enquiry-spine.integration.test.ts requires DATABASE_URL");
}

let orgA: string;
let orgB: string;
let userA: string;
let scopeA: Scope;
let scopeB: Scope;

beforeAll(async () => {
  const pool = getPool();
  const org = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, slug) VALUES ('Spine Test A', 'spine-test-a'),
                                                 ('Spine Test B', 'spine-test-b')
     RETURNING id`,
  );
  orgA = org.rows[0].id;
  orgB = org.rows[1].id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO public.users (org_id, email, role) VALUES ($1, 'spine-a@test.local', 'operator')
     RETURNING id`,
    [orgA],
  );
  userA = user.rows[0].id;
  scopeA = { kind: "org", orgId: orgA };
  scopeB = { kind: "org", orgId: orgB };
});

afterAll(async () => {
  const pool = getPool();
  // Test fixtures, not customer data: a real DELETE is correct here and is the
  // only DELETE in this repo's enquiry-spine code.
  await pool.query(`DELETE FROM public.orgs WHERE slug IN ('spine-test-a','spine-test-b')`);
  await pool.end();
});

describe("a broker can work an enquiry end to end", () => {
  it("captures, threads, calls, extracts, states and counts", async () => {
    const contact = await createContact(scopeA, {
      name: "Asha Rao",
      phone: "+919800000000",
    });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Asha Rao",
      contactPhone: "+919800000000",
      listingUrl: "https://gentlespace.in/spaces/hsr-1",
    });

    await addMessage(scopeA, {
      enquiryId: enquiry.id,
      channel: "web_form",
      body: "38 desks in HSR",
    });
    expect(await listMessages(scopeA, enquiry.id)).toHaveLength(1);

    await logCall(scopeA, {
      enquiryId: enquiry.id,
      actorUserId: userA,
      outcome: "spoke_interested",
      direction: "outgoing",
      seconds: 240,
      occurredAt: new Date().toISOString(),
      body: "Wants a tour on Friday",
    });
    const activities = await listActivities(scopeA, enquiry.id);
    expect(activities.map((a) => a.kind)).toContain("call");

    const revision = await createRevision(scopeA, {
      enquiryId: enquiry.id,
      source: "call_notes",
      proposed: { desksMin: 38, desksMax: 38 },
    });
    expect(await getRequirement(scopeA, enquiry.id)).toBeNull(); // proposals do not apply
    await applyRevision(scopeA, revision.id, userA);
    expect(await getRequirement(scopeA, enquiry.id)).toMatchObject({ desksMin: 38, desksMax: 38 });

    await setReplyState(scopeA, enquiry.id, "called");
    expect((await getEnquiryById(scopeA, enquiry.id))?.replyState).toBe("called");
    expect(await countEnquiriesByState(scopeA)).toMatchObject({ called: 1 });

    // The whole loop ran with no Twenty identifier anywhere.
    expect((await getEnquiryById(scopeA, enquiry.id))?.twentyOpportunityId).toBeNull();
    expect((await getContactById(scopeA, contact.id))?.syncState).toBe("pending");
  });
});

describe("an enquiry survives Twenty being down", () => {
  it("captures and is workable while every Twenty call throws", async () => {
    vi.doMock("../crm/twenty-client", () => ({
      getTwentyClient: async () => {
        throw new Error("no Twenty connection for org " + orgA);
      },
    }));
    const { projectPendingActivities, projectPendingContacts } = await import(
      "../crm/twenty-projection"
    );

    const contact = await createContact(scopeA, { name: "Down Test", phone: "+919800000009" });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Down Test",
      contactPhone: "+919800000009",
    });
    await logCall(scopeA, {
      enquiryId: enquiry.id,
      actorUserId: userA,
      outcome: "no_answer",
      direction: "outgoing",
      seconds: 0,
      occurredAt: new Date().toISOString(),
    });

    // The projection worker runs and fails, and nothing is lost.
    const contactResult = await projectPendingContacts(50);
    const activityResult = await projectPendingActivities(50);
    expect(contactResult.failed).toBeGreaterThan(0);
    expect(activityResult.succeeded).toBe(0);

    expect(await getEnquiryById(scopeA, enquiry.id)).not.toBeNull();
    expect(await listEnquiries(scopeA)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: enquiry.id })]),
    );
    expect(await setReplyState(scopeA, enquiry.id, "called")).not.toBeNull();
    expect(await listActivities(scopeA, enquiry.id)).toHaveLength(1);

    const after = await getContactById(scopeA, contact.id);
    expect(after?.syncState).toBe("failed");
    expect(after?.syncAttempts).toBe(1);

    vi.doUnmock("../crm/twenty-client");
  });
});

describe("tenant isolation across the new tables", () => {
  it("hides org A's enquiry from org B by primary key", async () => {
    const contact = await createContact(scopeA, { name: "Isolated", phone: "+919800000001" });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Isolated",
    });
    expect(await getEnquiryById(scopeB, enquiry.id)).toBeNull();
    expect(await listMessages(scopeB, enquiry.id)).toEqual([]);
    expect(await listActivities(scopeB, enquiry.id)).toEqual([]);
    expect(await getContactById(scopeB, contact.id)).toBeNull();
  });

  it("refuses a write carrying another tenant's org_id, because of WITH CHECK", async () => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT public.set_tenant($1)", [orgB]);
      await expect(
        client.query(
          `INSERT INTO adsagent.contacts (org_id, name) VALUES ($1, 'Cross tenant')`,
          [orgA],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("suppression blocks every read without touching a read path", () => {
  it("hides the enquiry and opens a ledger row per store", async () => {
    const contact = await createContact(scopeA, { name: "Forget Me", phone: "+919800000002" });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Forget Me",
    });

    const result = await suppressEnquiry(scopeA, enquiry.id, userA);
    expect(result).not.toBeNull();

    expect(await getEnquiryById(scopeA, enquiry.id)).toBeNull();
    expect(await listEnquiries(scopeA)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: enquiry.id })]),
    );

    const pool = getPool();
    const row = await pool.query<{ lifecycle: string; erase_after: string }>(
      `SELECT lifecycle, erase_after::text FROM adsagent.enquiries WHERE id = $1`,
      [enquiry.id],
    );
    // Still physically present: the retention floor is a year, not zero.
    expect(row.rows[0].lifecycle).toBe("suppressed");
    expect(Date.parse(row.rows[0].erase_after) - Date.now()).toBeGreaterThan(
      300 * 24 * 60 * 60 * 1000,
    );

    const stores = await pool.query<{ store: string; state: string }>(
      `SELECT p.store, p.state
         FROM context.deletion_propagations p
         JOIN context.deletion_requests r ON r.id = p.request_id
        WHERE r.subject_ref = $1 ORDER BY p.store`,
      [enquiry.id],
    );
    expect(stores.rows).toEqual([
      { store: "postgres", state: "suppressed" },
      { store: "twenty", state: "pending" },
    ]);
  });
});
```

The two `getPool().query` calls in `beforeAll`/`afterAll` and the raw assertions run without `set_tenant`, so they require the connecting role to own these tables. If `FORCE ROW LEVEL SECURITY` blocks them, wrap each in `SELECT public.set_tenant($1)` inside an explicit transaction — that is the correct fix, not loosening a policy.

- [ ] **Step 3: Run the gate**

Run:

```bash
docker compose -f docker-compose.listings.yml up -d
cd ads-agent && npm run migrate && npx vitest run lib/enquiries/enquiry-spine.integration.test.ts
```

Expected: PASS, 6 tests. In particular `an enquiry survives Twenty being down` green, with `syncState` `failed` and the enquiry still listable and still writable.

- [ ] **Step 4: Run every suite and the RLS catalogue check**

Run: `cd ads-agent && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

Run: `npx vitest run && npx tsc --noEmit` (from the repo root, for the listings app)
Expected: PASS, no type errors.

Run:

```bash
psql "$DATABASE_URL" -c "
SELECT n.nspname || '.' || c.relname AS unprotected
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('adsagent','context')
   AND c.relkind = 'r'
   AND c.relname <> 'schema_migrations'
   AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)"
```

Expected: zero rows. Any table listed is unprotected. `context.deletion_propagations` will appear — it carries no `org_id` and is reachable only through an RLS-protected request row; add it to the exclusion list with that reason recorded, or give it RLS through a join policy. Decide and record which; do not leave it ambiguous.

Run:

```bash
psql "$DATABASE_URL" -c "
SELECT polrelid::regclass AS tbl, polname, polcmd FROM pg_policy
 WHERE polname LIKE 'cross_tenant%' ORDER BY 1"
```

Expected: every `cross_tenant_read` row has `polcmd = 'r'` and the single `cross_tenant_audit` row has `polcmd = 'a'`. A `*` on any of them means a cross-tenant session can write, which is the isolation boundary being crossed.

- [ ] **Step 5: Adversarial review**

Dispatch one `adversarial-reviewer` on the most capable model over `git diff main@{1}..HEAD`, with this plan's Global Constraints as its attention lens. Point its Security Auditor persona specifically at:

1. Any query in `ads-agent/lib/db/` that reaches a table without going through `withTenantTransaction`.
2. Any `INSERT` or `UPDATE` on an enquiry-spine table whose `org_id` does not come from `orgIdForWrite`.
3. Whether the `cross_tenant_read` policies can be reached by a request-path session — i.e. whether anything other than `withCrossTenantRead` sets `app.cross_tenant`.
4. Whether any code path on the request side can reach `lib/crm/`.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/enquiries/enquiry-spine.integration.test.ts ads-agent/lib/db/twenty-connections.ts
git commit -m "test(s4): the enquiry spine gate

Proves the two things S4 claims: a broker can work an enquiry end to end,
and an enquiry is created and workable while every Twenty call throws.
Database-backed, so it also proves RLS admits the right rows and refuses a
write carrying another tenant's org_id."
```

**S4 gate — stop and confirm before S5.** All four conditions:

1. `enquiry-spine.integration.test.ts` green, including the Twenty-down case.
2. Zero rows from the `FORCE ROW LEVEL SECURITY` catalogue check (with `deletion_propagations` explicitly decided).
3. Every `cross_tenant` policy `polcmd` is `r` or `a`, never `*`.
4. Both apps' suites and both `tsc --noEmit` runs clean.

---

# S5 — Close the enquiry loop

**Gate:** reminders and extraction working.

## Task 17: `adsagent.reminders`

**Wave:** S5-A · **Skills:** `postgres-pro`, `senior-backend` · **Model:** `composer-2.5-fast`

**Files:**
- Create: `ads-agent/lib/db/migrations/027_reminders.up.sql`
- Create: `ads-agent/lib/db/migrations/027_reminders.down.sql`
- Create: `ads-agent/lib/db/reminders.ts`
- Create: `ads-agent/lib/db/reminders.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite`, `withTenantTransaction` (Task 2); `logReminderSet` (Task 8).
- Produces:
  - `type ReminderState = "pending" | "fired" | "done" | "cancelled"`
  - `type Reminder = { id, orgId, enquiryId, userId, dueAt, note, state, createdAt }`
  - `createReminder(scope, input: { enquiryId: string | null; userId: string; dueAt: string; note?: string | null }): Promise<Reminder>`
  - `listPendingReminders(scope, opts?: { userId?: string; dueBefore?: string }): Promise<Reminder[]>`
  - `setReminderState(scope, id, state): Promise<Reminder | null>`
  - `claimDueReminders(client: PoolClient, now: string, limit: number): Promise<Reminder[]>` — cross-tenant, for Task 20

**Context:** Data model §3 lines 304–319; backend spec C4. The partial index on `(org_id, due_at) WHERE state = 'pending'` is what keeps the Today query small as history grows — every fired reminder leaves the index. `enquiry_id` is nullable because a broker can set a reminder that is not about a specific enquiry.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/reminders.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const logReminderSet = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./enquiry-activities", () => ({ logReminderSet }));

import { createReminder, listPendingReminders, setReminderState } from "./reminders";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "rem-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  user_id: "user-7",
  due_at: new Date("2026-08-14T04:30:00.000Z"),
  note: "Call back about the tour",
  state: "pending",
  created_at: new Date("2026-08-12T04:30:00.000Z"),
};

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [row] });
  logReminderSet.mockReset().mockResolvedValue(undefined);
});

describe("createReminder", () => {
  it("stores the reminder and logs it on the enquiry's timeline", async () => {
    const reminder = await createReminder(scope, {
      enquiryId: "enq-1",
      userId: "user-7",
      dueAt: "2026-08-14T04:30:00.000Z",
      note: "Call back about the tour",
    });
    expect(reminder.state).toBe("pending");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.reminders");
    expect(params).toEqual([
      "org-1",
      "enq-1",
      "user-7",
      "2026-08-14T04:30:00.000Z",
      "Call back about the tour",
    ]);
    expect(logReminderSet).toHaveBeenCalledWith(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      body: "Reminder set for 2026-08-14T04:30:00.000Z",
    });
  });

  it("does not log a timeline entry for a reminder with no enquiry", async () => {
    await createReminder(scope, {
      enquiryId: null,
      userId: "user-7",
      dueAt: "2026-08-14T04:30:00.000Z",
    });
    expect(logReminderSet).not.toHaveBeenCalled();
  });

  it("rejects a due date in the past, which would fire immediately and look broken", async () => {
    await expect(
      createReminder(scope, {
        enquiryId: null,
        userId: "user-7",
        dueAt: "2020-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/dueAt must be in the future/i);
  });
});

describe("listPendingReminders", () => {
  it("uses the partial-index predicate and orders by due date", async () => {
    await listPendingReminders(scope, { userId: "user-7" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("state = 'pending'");
    expect(sql).toContain("ORDER BY due_at");
    expect(params).toEqual(["org-1", "user-7"]);
  });
});

describe("setReminderState", () => {
  it("returns null when nothing matched, which the route turns into a 404", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(setReminderState(scope, "rem-other", "done")).resolves.toBeNull();
  });

  it("rejects a state outside the vocabulary", async () => {
    await expect(
      setReminderState(scope, "rem-1", "snoozed" as never),
    ).rejects.toThrow(/state must be one of/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/reminders.test.ts`
Expected: FAIL — `Failed to resolve import "./reminders"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/027_reminders.up.sql
BEGIN;

CREATE TABLE adsagent.reminders (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id       public.org_ref NOT NULL REFERENCES public.orgs(id),
  -- Nullable: a broker can set a reminder that is not about one enquiry.
  enquiry_id   UUID REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id),

  due_at       TIMESTAMPTZ NOT NULL,
  note         TEXT,
  state        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending','fired','done','cancelled')),
  fired_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drives the Today feed. Partial, so every fired reminder leaves the index and
-- the query stays small no matter how much history accumulates.
CREATE INDEX reminders_due_idx ON adsagent.reminders (org_id, due_at)
  WHERE state = 'pending';
CREATE INDEX reminders_org_user_idx ON adsagent.reminders (org_id, user_id, due_at)
  WHERE state = 'pending';

ALTER TABLE adsagent.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.reminders FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.reminders
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The reminder scheduler fires for every org.
CREATE POLICY cross_tenant_read ON adsagent.reminders
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/027_reminders.down.sql
BEGIN;
DROP POLICY IF EXISTS cross_tenant_read ON adsagent.reminders;
DROP POLICY IF EXISTS tenant_isolation  ON adsagent.reminders;
DROP TABLE IF EXISTS adsagent.reminders;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/reminders.ts
import type { PoolClient } from "pg";
import { logReminderSet } from "./enquiry-activities";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const REMINDER_STATES = ["pending", "fired", "done", "cancelled"] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];

export type Reminder = {
  id: string;
  orgId: string;
  enquiryId: string | null;
  userId: string;
  dueAt: string;
  note: string | null;
  state: ReminderState;
  createdAt: string;
};

type ReminderRow = {
  id: string;
  org_id: string;
  enquiry_id: string | null;
  user_id: string;
  due_at: Date;
  note: string | null;
  state: ReminderState;
  created_at: Date;
};

const COLUMNS = `id, org_id, enquiry_id, user_id, due_at, note, state, created_at`;

function rowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    userId: row.user_id,
    dueAt: row.due_at.toISOString(),
    note: row.note,
    state: row.state,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createReminder(
  scope: Scope,
  input: { enquiryId: string | null; userId: string; dueAt: string; note?: string | null },
): Promise<Reminder> {
  const orgId = orgIdForWrite(scope);
  const due = Date.parse(input.dueAt);
  if (Number.isNaN(due)) throw new Error("createReminder: dueAt must be an ISO timestamp");
  if (due <= Date.now()) throw new Error("createReminder: dueAt must be in the future");

  const reminder = await withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ReminderRow>(
      `INSERT INTO adsagent.reminders (org_id, enquiry_id, user_id, due_at, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [orgId, input.enquiryId, input.userId, input.dueAt, input.note ?? null],
    );
    return rowToReminder(rows[0]);
  });

  // A reminder about an enquiry is part of that enquiry's history, so the
  // timeline shows it. A standalone reminder has no timeline to join.
  if (input.enquiryId) {
    await logReminderSet(scope, {
      enquiryId: input.enquiryId,
      actorUserId: input.userId,
      body: `Reminder set for ${input.dueAt}`,
    });
  }
  return reminder;
}

export async function listPendingReminders(
  scope: Scope,
  opts: { userId?: string; dueBefore?: string } = {},
): Promise<Reminder[]> {
  const clause = scopeClause(scope);
  const params: unknown[] = [...clause.params];
  let where = `${clause.sql} AND state = 'pending'`;
  if (opts.userId) {
    params.push(opts.userId);
    where += ` AND user_id = $${params.length}`;
  }
  if (opts.dueBefore) {
    params.push(opts.dueBefore);
    where += ` AND due_at <= $${params.length}`;
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ReminderRow>(
      `SELECT ${COLUMNS} FROM adsagent.reminders WHERE ${where} ORDER BY due_at`,
      params,
    );
    return rows.map(rowToReminder);
  });
}

export async function setReminderState(
  scope: Scope,
  id: string,
  state: ReminderState,
): Promise<Reminder | null> {
  if (!REMINDER_STATES.includes(state)) {
    throw new Error(`setReminderState: state must be one of ${REMINDER_STATES.join(", ")}`);
  }
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ReminderRow>(
      `UPDATE adsagent.reminders
          SET state = $${n + 1},
              fired_at = CASE WHEN $${n + 1} = 'fired' THEN now() ELSE fired_at END
        WHERE ${clause.sql} AND id = $${n + 2}
        RETURNING ${COLUMNS}`,
      [...clause.params, state, id],
    );
    return rows[0] ? rowToReminder(rows[0]) : null;
  });
}

/** Cross-tenant claim for the scheduler. Called inside withCrossTenantRead. */
export async function claimDueReminders(
  client: PoolClient,
  now: string,
  limit: number,
): Promise<Reminder[]> {
  const { rows } = await client.query<ReminderRow>(
    `SELECT ${COLUMNS} FROM adsagent.reminders
      WHERE state = 'pending' AND due_at <= $1
      ORDER BY due_at
      LIMIT $2
        FOR UPDATE SKIP LOCKED`,
    [now, limit],
  );
  return rows.map(rowToReminder);
}
```

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate && npx vitest run lib/db/reminders.test.ts lib/db/no-crm-imports.test.ts`
Expected: `migrations: 027_reminders`; PASS, 6 + 2 tests.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/migrations/027_reminders.up.sql \
        ads-agent/lib/db/migrations/027_reminders.down.sql \
        ads-agent/lib/db/reminders.ts ads-agent/lib/db/reminders.test.ts
git commit -m "feat(db): adsagent.reminders (C4)

The partial index on pending reminders is what keeps the Today query small:
every fired reminder leaves the index rather than growing it."
```

## Task 18: `adsagent.notifications` and its endpoints (G1)

**Wave:** S5-A · **Skills:** `postgres-pro`, `api-designer` · **Model:** `composer-2.5-fast`

**Files:**
- Create: `ads-agent/lib/db/migrations/028_notifications.up.sql`
- Create: `ads-agent/lib/db/migrations/028_notifications.down.sql`
- Create: `ads-agent/lib/db/notifications.ts`
- Create: `ads-agent/lib/db/notifications.test.ts`
- Create: `ads-agent/app/api/notifications/route.ts`
- Create: `ads-agent/app/api/notifications/[id]/read/route.ts`
- Create: `ads-agent/app/api/notifications/routes.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite`, `withTenantTransaction` (Task 2); `requireApiRole`, `scopeFromSession`.
- Produces:
  - `type NotificationKind = "reminder_due" | "enquiry_received" | "no_contact" | "requirement_extracted"`
  - `type Notification = { id, orgId, userId, kind, enquiryId, title, body, readAt, createdAt }`
  - `createNotification(scope, input: { userId; kind; enquiryId?; title; body? }, client?): Promise<Notification>`
  - `listNotifications(scope, userId, opts?: { unreadOnly?: boolean; limit?: number }): Promise<Notification[]>`
  - `markNotificationRead(scope, id, userId): Promise<Notification | null>`
  - `countUnread(scope, userId): Promise<number>`
  - `GET /api/notifications`, `POST /api/notifications/[id]/read`

**Context:** Backend spec G1 — "table + endpoints". The spec gives no DDL, so the table below is designed here rather than lifted from the data model; it follows the same conventions as every other table in §3. G2 (daily digest email) is **deferred and not decided**, so nothing here sends anything: notifications are in-app only, which keeps BD2 ("no sending library") intact. G3 (delivery preferences) is out of scope for the same reason — there is nothing yet to have a preference about.

`markNotificationRead` takes the user id as well as the notification id: within one org, one broker marking another's notification read would be wrong even though RLS permits it.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/notifications.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  countUnread,
  createNotification,
  listNotifications,
  markNotificationRead,
} from "./notifications";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "note-1",
  org_id: "org-1",
  user_id: "user-7",
  kind: "reminder_due",
  enquiry_id: "enq-1",
  title: "Reminder due: call Asha Rao",
  body: null,
  read_at: null,
  created_at: new Date("2026-08-14T04:30:00.000Z"),
};

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [row] }));

describe("createNotification", () => {
  it("stores an unread notification for one user", async () => {
    const notification = await createNotification(scope, {
      userId: "user-7",
      kind: "reminder_due",
      enquiryId: "enq-1",
      title: "Reminder due: call Asha Rao",
    });
    expect(notification.readAt).toBeNull();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.notifications");
    expect(params).toEqual([
      "org-1",
      "user-7",
      "reminder_due",
      "enq-1",
      "Reminder due: call Asha Rao",
      null,
    ]);
  });

  it("accepts a caller-supplied client so it can commit with what caused it", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [row] });
    await createNotification(
      scope,
      { userId: "user-7", kind: "no_contact", title: "No contact for 7 days" },
      { query: clientQuery } as never,
    );
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("listNotifications", () => {
  it("filters to unread when asked and always scopes to one user", async () => {
    await listNotifications(scope, "user-7", { unreadOnly: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("read_at IS NULL");
    expect(sql).toContain("user_id = $2");
    expect(params).toEqual(["org-1", "user-7", 50]);
  });
});

describe("markNotificationRead", () => {
  it("requires the notification to belong to that user, not just that org", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(markNotificationRead(scope, "note-1", "user-9")).resolves.toBeNull();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("user_id = $3");
    expect(params).toEqual(["org-1", "note-1", "user-9"]);
  });

  it("is idempotent: a second read does not move the timestamp", async () => {
    await markNotificationRead(scope, "note-1", "user-7");
    expect(String(query.mock.calls[0][0])).toContain("read_at = COALESCE(read_at, now())");
  });
});

describe("countUnread", () => {
  it("returns a number, not a string", async () => {
    query.mockResolvedValue({ rows: [{ n: "3" }] });
    await expect(countUnread(scope, "user-7")).resolves.toBe(3);
  });
});
```

```ts
// ads-agent/app/api/notifications/routes.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiRole = vi.fn();
const scopeFromSession = vi.fn();
const listNotifications = vi.fn();
const countUnread = vi.fn();
const markNotificationRead = vi.fn();

vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/auth/scope", () => ({ scopeFromSession }));
vi.mock("@/lib/db/notifications", () => ({
  listNotifications,
  countUnread,
  markNotificationRead,
}));

const scope = { kind: "org", orgId: "org-1" } as const;
const session = { userId: "user-7", email: "a@b.c", orgId: "org-1", role: "viewer" as const };

beforeEach(() => {
  requireApiRole.mockReset().mockResolvedValue({ ok: true, session });
  scopeFromSession.mockReset().mockResolvedValue(scope);
  listNotifications.mockReset().mockResolvedValue([{ id: "note-1" }]);
  countUnread.mockReset().mockResolvedValue(1);
  markNotificationRead.mockReset().mockResolvedValue({ id: "note-1", readAt: "now" });
});

describe("GET /api/notifications", () => {
  it("returns this user's notifications and the unread count", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/notifications?unread=1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      notifications: [{ id: "note-1" }],
      unread: 1,
    });
    expect(listNotifications).toHaveBeenCalledWith(scope, "user-7", { unreadOnly: true });
  });
});

describe("POST /api/notifications/[id]/read", () => {
  it("404s when the notification is not this user's", async () => {
    markNotificationRead.mockResolvedValue(null);
    const { POST } = await import("./[id]/read/route");
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: "note-other" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/db/notifications.test.ts app/api/notifications/routes.test.ts`
Expected: FAIL — unresolved imports for `./notifications` and the two routes.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/028_notifications.up.sql
BEGIN;

-- Designed here rather than in the data model: backend spec G1 says "table +
-- endpoints" and gives no DDL. In-app only -- G2 (digest email) is deferred and
-- undecided, so nothing here sends anything and BD2 holds.
CREATE TABLE adsagent.notifications (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id      public.org_ref NOT NULL REFERENCES public.orgs(id),
  user_id     UUID NOT NULL REFERENCES public.users(id),

  kind        TEXT NOT NULL CHECK (kind IN
                ('reminder_due','enquiry_received','no_contact','requirement_extracted')),
  enquiry_id  UUID REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,

  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_unread_idx
  ON adsagent.notifications (org_id, user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX notifications_org_user_idx
  ON adsagent.notifications (org_id, user_id, created_at DESC);

ALTER TABLE adsagent.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.notifications FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.notifications
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/028_notifications.down.sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.notifications;
DROP TABLE IF EXISTS adsagent.notifications;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/notifications.ts
import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const NOTIFICATION_KINDS = [
  "reminder_due",
  "enquiry_received",
  "no_contact",
  "requirement_extracted",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type Notification = {
  id: string;
  orgId: string;
  userId: string;
  kind: NotificationKind;
  enquiryId: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  org_id: string;
  user_id: string;
  kind: NotificationKind;
  enquiry_id: string | null;
  title: string;
  body: string | null;
  read_at: Date | null;
  created_at: Date;
};

const COLUMNS = `id, org_id, user_id, kind, enquiry_id, title, body, read_at, created_at`;

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    kind: row.kind,
    enquiryId: row.enquiry_id,
    title: row.title,
    body: row.body,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createNotification(
  scope: Scope,
  input: {
    userId: string;
    kind: NotificationKind;
    enquiryId?: string | null;
    title: string;
    body?: string | null;
  },
  client?: PoolClient,
): Promise<Notification> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.notifications
                 (org_id, user_id, kind, enquiry_id, title, body)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING ${COLUMNS}`;
  const params = [
    orgId,
    input.userId,
    input.kind,
    input.enquiryId ?? null,
    input.title,
    input.body ?? null,
  ];
  if (client) {
    const { rows } = await client.query<NotificationRow>(sql, params);
    return rowToNotification(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<NotificationRow>(sql, params);
    return rowToNotification(rows[0]);
  });
}

export async function listNotifications(
  scope: Scope,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const clause = scopeClause(scope);
  const params: unknown[] = [...clause.params, userId];
  let where = `${clause.sql} AND user_id = $${params.length}`;
  if (opts.unreadOnly) where += ` AND read_at IS NULL`;
  params.push(opts.limit ?? 50);
  const limitPlaceholder = `$${params.length}`;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<NotificationRow>(
      `SELECT ${COLUMNS} FROM adsagent.notifications
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ${limitPlaceholder}`,
      params,
    );
    return rows.map(rowToNotification);
  });
}

/**
 * Scoped to the user as well as the org: inside one broker's office, one
 * person marking another's notification read would be wrong even though RLS
 * permits it.
 */
export async function markNotificationRead(
  scope: Scope,
  id: string,
  userId: string,
): Promise<Notification | null> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<NotificationRow>(
      `UPDATE adsagent.notifications
          SET read_at = COALESCE(read_at, now())
        WHERE ${clause.sql} AND id = $${n + 1} AND user_id = $${n + 2}
        RETURNING ${COLUMNS}`,
      [...clause.params, id, userId],
    );
    return rows[0] ? rowToNotification(rows[0]) : null;
  });
}

export async function countUnread(scope: Scope, userId: string): Promise<number> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM adsagent.notifications
        WHERE ${clause.sql} AND user_id = $${clause.params.length + 1} AND read_at IS NULL`,
      [...clause.params, userId],
    );
    return Number(rows[0]?.n ?? 0);
  });
}
```

- [ ] **Step 5: Write the two routes**

```ts
// ads-agent/app/api/notifications/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { countUnread, listNotifications } from "@/lib/db/notifications";

export async function GET(req: Request) {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();

  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  const [notifications, unread] = await Promise.all([
    listNotifications(scope, access.session.userId, { unreadOnly }),
    countUnread(scope, access.session.userId),
  ]);
  return NextResponse.json({ notifications, unread });
}
```

```ts
// ads-agent/app/api/notifications/[id]/read/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { markNotificationRead } from "@/lib/db/notifications";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  const notification = await markNotificationRead(scope, id, access.session.userId);
  if (!notification) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ notification });
}
```

- [ ] **Step 6: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate && npx vitest run lib/db/notifications.test.ts app/api/notifications/routes.test.ts lib/db/no-crm-imports.test.ts`
Expected: `migrations: 028_notifications`; PASS, 6 + 2 + 2 tests.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/migrations/028_notifications.up.sql \
        ads-agent/lib/db/migrations/028_notifications.down.sql \
        ads-agent/lib/db/notifications.ts ads-agent/lib/db/notifications.test.ts \
        ads-agent/app/api/notifications/
git commit -m "feat(notifications): in-app notification model and endpoints (G1)

In-app only. G2's digest email is deferred and undecided, so nothing here
sends anything and BD2's 'no sending library' still holds. Read state is
scoped to the user, not just the org."
```

## Task 19: `adsagent.enquiry_signals` — derived signals (A6)

**Wave:** S5-A · **Skills:** `postgres-pro`, `senior-backend` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/db/migrations/029_enquiry_signals.up.sql`
- Create: `ads-agent/lib/db/migrations/029_enquiry_signals.down.sql`
- Create: `ads-agent/lib/db/enquiry-signals.ts`
- Create: `ads-agent/lib/db/enquiry-signals.test.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `orgIdForWrite`, `withTenantTransaction` (Task 2); `listMessages`, `type EnquiryMessage` (Task 7).
- Produces:
  - `SIGNAL_KINDS` and `type SignalKind = "asked_about_pricing" | "asked_about_availability" | "mentioned_timeline" | "mentioned_competitor"`
  - `type EnquirySignal = { orgId, enquiryId, kind, occurrences, lastSeenAt }`
  - `deriveSignals(messages: EnquiryMessage[]): { kind: SignalKind; occurrences: number; lastSeenAt: string }[]` — pure
  - `refreshEnquirySignals(scope, enquiryId): Promise<EnquirySignal[]>`
  - `listSignals(scope, enquiryId): Promise<EnquirySignal[]>`

**Context:** Backend spec A6 — "asked about pricing twice" — and §6, which says plainly that signals need inbound message text, which needs B2 (inbound email). **That constraint is real and this task does not pretend otherwise:** until S15 the only inbound channel is the website form, so most enquiries will yield one message and therefore at most single-occurrence signals. The derivation is deliberately channel-agnostic and reads whatever `enquiry_messages` holds, so B2 and B3 add data without touching this code.

Derivation is **lexical and deterministic, not an LLM call**. A signal that says "asked about pricing twice" has to be countable and reproducible; a model that sometimes says three would make the number worse than absent. It is also free, which matters for something recomputed on every inbound message.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/enquiry-signals.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const listMessages = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./enquiry-messages", () => ({ listMessages }));

import { deriveSignals, listSignals, refreshEnquirySignals } from "./enquiry-signals";

const scope = { kind: "org", orgId: "org-1" } as const;

function message(body: string, receivedAt: string) {
  return {
    id: `msg-${receivedAt}`,
    orgId: "org-1",
    enquiryId: "enq-1",
    channel: "web_form" as const,
    body,
    externalId: null,
    replyToken: null,
    isUntrusted: true,
    receivedAt,
  };
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  listMessages.mockReset().mockResolvedValue([]);
});

describe("deriveSignals", () => {
  it("counts pricing questions across messages and keeps the latest timestamp", () => {
    const signals = deriveSignals([
      message("What is the price per desk?", "2026-08-12T04:00:00.000Z"),
      message("Any discount on that pricing?", "2026-08-13T04:00:00.000Z"),
    ]);
    expect(signals).toEqual([
      {
        kind: "asked_about_pricing",
        occurrences: 2,
        lastSeenAt: "2026-08-13T04:00:00.000Z",
      },
    ]);
  });

  it("is case-insensitive and does not double-count one message", () => {
    const signals = deriveSignals([
      message("PRICE and price and pricing", "2026-08-12T04:00:00.000Z"),
    ]);
    expect(signals).toEqual([
      { kind: "asked_about_pricing", occurrences: 1, lastSeenAt: "2026-08-12T04:00:00.000Z" },
    ]);
  });

  it("finds availability, timeline and competitor signals", () => {
    const signals = deriveSignals([
      message("Is it available from next month? We are also looking at WeWork.", "2026-08-12T04:00:00.000Z"),
    ]);
    expect(signals.map((s) => s.kind).sort()).toEqual([
      "asked_about_availability",
      "mentioned_competitor",
      "mentioned_timeline",
    ]);
  });

  it("returns nothing rather than guessing when the text says nothing", () => {
    expect(deriveSignals([message("Hi", "2026-08-12T04:00:00.000Z")])).toEqual([]);
  });
});

describe("refreshEnquirySignals", () => {
  it("upserts one row per kind and reports the current set", async () => {
    listMessages.mockResolvedValue([message("price?", "2026-08-12T04:00:00.000Z")]);
    query.mockResolvedValue({
      rows: [
        {
          org_id: "org-1",
          enquiry_id: "enq-1",
          kind: "asked_about_pricing",
          occurrences: 1,
          last_seen_at: new Date("2026-08-12T04:00:00.000Z"),
        },
      ],
    });
    const signals = await refreshEnquirySignals(scope, "enq-1");
    expect(signals).toEqual([
      {
        orgId: "org-1",
        enquiryId: "enq-1",
        kind: "asked_about_pricing",
        occurrences: 1,
        lastSeenAt: "2026-08-12T04:00:00.000Z",
      },
    ]);
    expect(String(query.mock.calls[0][0])).toContain(
      "ON CONFLICT (org_id, enquiry_id, kind) DO UPDATE",
    );
  });

  it("clears a signal that the current text no longer supports", async () => {
    listMessages.mockResolvedValue([message("Hi", "2026-08-12T04:00:00.000Z")]);
    await refreshEnquirySignals(scope, "enq-1");
    // Rebuildable and derived: the delete keeps the table honest rather than
    // accumulating signals the text stopped supporting.
    expect(String(query.mock.calls[0][0])).toContain("DELETE FROM adsagent.enquiry_signals");
  });
});

describe("listSignals", () => {
  it("orders by occurrences so the loudest signal renders first", async () => {
    await listSignals(scope, "enq-1");
    expect(String(query.mock.calls[0][0])).toContain("ORDER BY occurrences DESC");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/enquiry-signals.test.ts`
Expected: FAIL — `Failed to resolve import "./enquiry-signals"`.

- [ ] **Step 3: Write the migration**

```sql
-- ads-agent/lib/db/migrations/029_enquiry_signals.up.sql
BEGIN;

-- Derived and rebuildable from adsagent.enquiry_messages. It lives in
-- `adsagent` and not `derived` because its input is a business fact in
-- Postgres, not observational clickstream -- the `derived` quarantine is for
-- data projected back from ClickHouse.
CREATE TABLE adsagent.enquiry_signals (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id       public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id   UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  kind         TEXT NOT NULL CHECK (kind IN
                 ('asked_about_pricing','asked_about_availability',
                  'mentioned_timeline','mentioned_competitor')),
  occurrences  INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  last_seen_at TIMESTAMPTZ NOT NULL,
  derived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT enquiry_signals_unique UNIQUE (org_id, enquiry_id, kind)
);

CREATE INDEX enquiry_signals_org_enquiry_idx
  ON adsagent.enquiry_signals (org_id, enquiry_id, occurrences DESC);

ALTER TABLE adsagent.enquiry_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_signals FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_signals
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/029_enquiry_signals.down.sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.enquiry_signals;
DROP TABLE IF EXISTS adsagent.enquiry_signals;
COMMIT;
```

- [ ] **Step 4: Write the data layer**

```ts
// ads-agent/lib/db/enquiry-signals.ts
import { listMessages, type EnquiryMessage } from "./enquiry-messages";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const SIGNAL_KINDS = [
  "asked_about_pricing",
  "asked_about_availability",
  "mentioned_timeline",
  "mentioned_competitor",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type EnquirySignal = {
  orgId: string;
  enquiryId: string;
  kind: SignalKind;
  occurrences: number;
  lastSeenAt: string;
};

type SignalRow = {
  org_id: string;
  enquiry_id: string;
  kind: SignalKind;
  occurrences: number;
  last_seen_at: Date;
};

/**
 * Lexical and deterministic, not an LLM call. "Asked about pricing twice" has
 * to be countable and reproducible; a model that sometimes says three would
 * make the number worse than absent. It is also free, which matters for
 * something recomputed on every inbound message.
 *
 * Until S15 the only inbound channel is the website form, so most enquiries
 * yield one message and therefore single-occurrence signals. The patterns are
 * channel-agnostic, so inbound email and WhatsApp add data without code change.
 */
const PATTERNS: Record<SignalKind, RegExp> = {
  asked_about_pricing: /\b(pric(e|es|ing)|cost|rate|budget|per\s+desk|discount)\b/i,
  asked_about_availability: /\b(availab(le|ility)|vacan(t|cy)|free from|move[-\s]?in|ready)\b/i,
  mentioned_timeline: /\b(next\s+(week|month|quarter)|by\s+\w+|asap|urgent|immediat(e|ely))\b/i,
  mentioned_competitor: /\b(wework|awfis|smartworks|cowrks|91springboard|indiqube|table\s?space)\b/i,
};

function rowToSignal(row: SignalRow): EnquirySignal {
  return {
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    kind: row.kind,
    occurrences: row.occurrences,
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

export function deriveSignals(
  messages: EnquiryMessage[],
): { kind: SignalKind; occurrences: number; lastSeenAt: string }[] {
  const found = new Map<SignalKind, { occurrences: number; lastSeenAt: string }>();
  for (const message of messages) {
    for (const kind of SIGNAL_KINDS) {
      // One message counts once per kind, however many times the word appears:
      // "asked twice" means two messages, not two words.
      if (!PATTERNS[kind].test(message.body)) continue;
      const existing = found.get(kind);
      if (!existing) {
        found.set(kind, { occurrences: 1, lastSeenAt: message.receivedAt });
      } else {
        existing.occurrences++;
        if (message.receivedAt > existing.lastSeenAt) existing.lastSeenAt = message.receivedAt;
      }
    }
  }
  return [...found.entries()]
    .map(([kind, value]) => ({ kind, ...value }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

export async function refreshEnquirySignals(
  scope: Scope,
  enquiryId: string,
): Promise<EnquirySignal[]> {
  const orgId = orgIdForWrite(scope);
  const derived = deriveSignals(await listMessages(scope, enquiryId));
  const kinds = derived.map((d) => d.kind);

  return withTenantTransaction(scope, async (c) => {
    // Derived and rebuildable: a signal the current text no longer supports is
    // removed rather than left to accumulate.
    await c.query(
      `DELETE FROM adsagent.enquiry_signals
        WHERE org_id = $1 AND enquiry_id = $2
          AND ($3::text[] IS NULL OR NOT (kind = ANY($3::text[])))`,
      [orgId, enquiryId, kinds.length > 0 ? kinds : null],
    );
    if (derived.length === 0) return [];

    const { rows } = await c.query<SignalRow>(
      `INSERT INTO adsagent.enquiry_signals
         (org_id, enquiry_id, kind, occurrences, last_seen_at)
       SELECT $1, $2, d.kind, d.occurrences, d.last_seen_at
         FROM jsonb_to_recordset($3::jsonb)
              AS d(kind text, occurrences int, last_seen_at timestamptz)
       ON CONFLICT (org_id, enquiry_id, kind) DO UPDATE
         SET occurrences = EXCLUDED.occurrences,
             last_seen_at = EXCLUDED.last_seen_at,
             derived_at = now()
       RETURNING org_id, enquiry_id, kind, occurrences, last_seen_at`,
      [
        orgId,
        enquiryId,
        JSON.stringify(
          derived.map((d) => ({
            kind: d.kind,
            occurrences: d.occurrences,
            last_seen_at: d.lastSeenAt,
          })),
        ),
      ],
    );
    return rows.map(rowToSignal);
  });
}

export async function listSignals(scope: Scope, enquiryId: string): Promise<EnquirySignal[]> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<SignalRow>(
      `SELECT org_id, enquiry_id, kind, occurrences, last_seen_at
         FROM adsagent.enquiry_signals
        WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1}
        ORDER BY occurrences DESC, kind`,
      [...clause.params, enquiryId],
    );
    return rows.map(rowToSignal);
  });
}
```

The `DELETE` here is the one legitimate delete in the enquiry spine: `enquiry_signals` is derived and rebuildable, holds no statement the enquirer made (only a classification of it), and the underlying message text is untouched. The retention floor attaches to the message, not to a recomputable label about it.

- [ ] **Step 5: Run the migration and the tests**

Run: `cd ads-agent && npm run migrate && npx vitest run lib/db/enquiry-signals.test.ts lib/db/no-crm-imports.test.ts`
Expected: `migrations: 029_enquiry_signals`; PASS, 7 + 2 tests.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/migrations/029_enquiry_signals.up.sql \
        ads-agent/lib/db/migrations/029_enquiry_signals.down.sql \
        ads-agent/lib/db/enquiry-signals.ts ads-agent/lib/db/enquiry-signals.test.ts
git commit -m "feat(db): derived enquiry signals (A6)

Lexical and deterministic rather than an LLM call: 'asked about pricing
twice' has to be countable and reproducible. Until inbound email lands at
S15 the only channel is the website form, so most enquiries will show
single-occurrence signals -- the patterns are channel-agnostic so B2 adds
data without code change."
```

## Task 20: Reminder scheduler and the Today feed (C5, C6)

**Wave:** S5-B · **Skills:** `senior-backend`, `senior-devops` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/db/today-feed.ts`
- Create: `ads-agent/lib/db/today-feed.test.ts`
- Create: `ads-agent/lib/reminders/scheduler.ts`
- Create: `ads-agent/lib/reminders/scheduler.test.ts`
- Create: `ads-agent/scripts/run-reminder-scheduler.ts`
- Create: `ads-agent/app/api/today/route.ts`
- Create: `ads-agent/app/api/reminders/route.ts`
- Create: `ads-agent/app/api/reminders/[id]/route.ts`

**Interfaces:**
- Consumes: `claimDueReminders`, `createReminder`, `listPendingReminders`, `setReminderState` (Task 17); `createNotification` (Task 18); `withCrossTenantRead` (Task 5); `withTenantTransaction`, `scopeClause` (Tasks 2 and S3).
- Produces:
  - `type TodayFeed = { dueReminders: DueReminder[]; waitingEnquiries: WaitingEnquiry[]; noContactSince: StaleEnquiry[] }`
  - `getTodayFeed(scope, opts?: { userId?: string; noContactDays?: number; now?: Date }): Promise<TodayFeed>`
  - `fireDueReminders(now?: Date, limit?: number): Promise<{ fired: number }>`
  - `GET /api/today`, `GET /api/reminders`, `POST /api/reminders`, `PATCH /api/reminders/[id]`

**Context:** Backend spec C5 and C6. `node-cron` is already a dependency (`ads-agent/package.json:38`) and `scripts/run-decision-cycle.ts` is the pattern to follow: check the enabling condition on every tick so the toggle works without restarting the process.

C6 — "no contact since X" — is a **derived query, not a table**. There is nothing to store: the answer is `last_activity_at < now() - interval`, and materialising it would be a cache that goes stale the moment a broker makes a call. `noContactDays` defaults to 7 and is a parameter rather than a constant, because seven days is a guess and the first broker will have an opinion.

**Firing a reminder is idempotent by construction:** `claimDueReminders` takes `FOR UPDATE SKIP LOCKED` and `fireDueReminders` flips the state to `'fired'` in the same transaction as the notification insert, so two scheduler instances cannot both notify.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/today-feed.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { getTodayFeed } from "./today-feed";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }));

describe("getTodayFeed", () => {
  it("asks three questions and returns three lists", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "rem-1",
            due_at: new Date("2026-08-14T04:00:00.000Z"),
            note: "Call back",
            enquiry_id: "enq-1",
            contact_name: "Asha Rao",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "enq-2",
            contact_name: "Bala",
            listing_url: null,
            first_seen_at: new Date("2026-08-13T04:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "enq-3",
            contact_name: "Chitra",
            last_activity_at: new Date("2026-08-01T04:00:00.000Z"),
            days_since: "13",
          },
        ],
      });

    const feed = await getTodayFeed(scope, { now: new Date("2026-08-14T05:00:00.000Z") });

    expect(feed.dueReminders).toEqual([
      {
        id: "rem-1",
        dueAt: "2026-08-14T04:00:00.000Z",
        note: "Call back",
        enquiryId: "enq-1",
        contactName: "Asha Rao",
      },
    ]);
    expect(feed.waitingEnquiries).toEqual([
      {
        id: "enq-2",
        contactName: "Bala",
        listingUrl: null,
        firstSeenAt: "2026-08-13T04:00:00.000Z",
      },
    ]);
    expect(feed.noContactSince).toEqual([
      {
        id: "enq-3",
        contactName: "Chitra",
        lastActivityAt: "2026-08-01T04:00:00.000Z",
        daysSince: 13,
      },
    ]);
  });

  it("computes no-contact from last_activity_at rather than storing it (C6)", async () => {
    await getTodayFeed(scope, { noContactDays: 14 });
    const staleQuery = String(query.mock.calls[2][0]);
    expect(staleQuery).toContain("last_activity_at");
    expect(staleQuery).toContain("interval");
    expect(query.mock.calls[2][1]).toContain(14);
  });

  it("defaults the no-contact window to seven days", async () => {
    await getTodayFeed(scope);
    expect(query.mock.calls[2][1]).toContain(7);
  });

  it("filters reminders to one user when asked", async () => {
    await getTodayFeed(scope, { userId: "user-7" });
    expect(String(query.mock.calls[0][0])).toContain("user_id = $2");
  });
});
```

```ts
// ads-agent/lib/reminders/scheduler.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const claimDueReminders = vi.fn();
const createNotification = vi.fn();
const query = vi.fn();

vi.mock("../db/cross-tenant", () => ({
  withCrossTenantRead: async (_actor: string, fn: (c: unknown) => Promise<unknown>) => fn({ query }),
}));
vi.mock("../db/reminders", () => ({ claimDueReminders }));
vi.mock("../db/notifications", () => ({ createNotification }));
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { fireDueReminders } from "./scheduler";

const reminder = {
  id: "rem-1",
  orgId: "org-1",
  enquiryId: "enq-1",
  userId: "user-7",
  dueAt: "2026-08-14T04:00:00.000Z",
  note: "Call back about the tour",
  state: "pending" as const,
  createdAt: "2026-08-12T04:00:00.000Z",
};

beforeEach(() => {
  claimDueReminders.mockReset().mockResolvedValue([]);
  createNotification.mockReset().mockResolvedValue({ id: "note-1" });
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
});

describe("fireDueReminders", () => {
  it("notifies the owning user and marks the reminder fired in one transaction", async () => {
    claimDueReminders.mockResolvedValue([reminder]);
    await expect(fireDueReminders(new Date("2026-08-14T05:00:00.000Z"))).resolves.toEqual({
      fired: 1,
    });
    expect(createNotification).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      {
        userId: "user-7",
        kind: "reminder_due",
        enquiryId: "enq-1",
        title: "Reminder due",
        body: "Call back about the tour",
      },
      expect.anything(),
    );
    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements.some((s) => s.includes("state = 'fired'"))).toBe(true);
  });

  it("does nothing when nothing is due", async () => {
    await expect(fireDueReminders()).resolves.toEqual({ fired: 0 });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("keeps going after one org fails, so one bad tenant cannot stall the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    claimDueReminders.mockResolvedValue([reminder, { ...reminder, id: "rem-2", orgId: "org-2" }]);
    createNotification.mockRejectedValueOnce(new Error("boom"));
    await expect(fireDueReminders()).resolves.toEqual({ fired: 1 });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/db/today-feed.test.ts lib/reminders/scheduler.test.ts`
Expected: FAIL — unresolved imports for `./today-feed` and `./scheduler`.

- [ ] **Step 3: Write the Today feed**

```ts
// ads-agent/lib/db/today-feed.ts
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type DueReminder = {
  id: string;
  dueAt: string;
  note: string | null;
  enquiryId: string | null;
  contactName: string | null;
};

export type WaitingEnquiry = {
  id: string;
  contactName: string | null;
  listingUrl: string | null;
  firstSeenAt: string;
};

export type StaleEnquiry = {
  id: string;
  contactName: string | null;
  lastActivityAt: string;
  daysSince: number;
};

export type TodayFeed = {
  dueReminders: DueReminder[];
  waitingEnquiries: WaitingEnquiry[];
  noContactSince: StaleEnquiry[];
};

/**
 * "No contact since X" is a query, not a table (C6). The answer is
 * last_activity_at against an interval, and materialising it would be a cache
 * that goes stale the moment a broker makes a call. noContactDays is a
 * parameter rather than a constant because seven days is a guess and the first
 * broker will have an opinion.
 */
export async function getTodayFeed(
  scope: Scope,
  opts: { userId?: string; noContactDays?: number; now?: Date } = {},
): Promise<TodayFeed> {
  const clause = scopeClause(scope);
  const now = (opts.now ?? new Date()).toISOString();
  const noContactDays = opts.noContactDays ?? 7;

  return withTenantTransaction(scope, async (c) => {
    const reminderParams: unknown[] = [...clause.params];
    let reminderWhere = `${clause.sql} AND r.state = 'pending'`;
    if (opts.userId) {
      reminderParams.push(opts.userId);
      reminderWhere += ` AND r.user_id = $${reminderParams.length}`;
    }
    reminderParams.push(now);
    const dueReminders = await c.query<{
      id: string;
      due_at: Date;
      note: string | null;
      enquiry_id: string | null;
      contact_name: string | null;
    }>(
      `SELECT r.id, r.due_at, r.note, r.enquiry_id, e.contact_name
         FROM adsagent.reminders r
         LEFT JOIN adsagent.enquiries e ON e.id = r.enquiry_id AND e.org_id = r.org_id
        WHERE ${reminderWhere.replace(/\borg_id\b/g, "r.org_id")}
          AND r.due_at <= $${reminderParams.length}
        ORDER BY r.due_at`,
      reminderParams,
    );

    const waiting = await c.query<{
      id: string;
      contact_name: string | null;
      listing_url: string | null;
      first_seen_at: Date;
    }>(
      `SELECT id, contact_name, listing_url, first_seen_at
         FROM adsagent.enquiries
        WHERE ${clause.sql} AND lifecycle = 'active' AND reply_state = 'waiting'
        ORDER BY first_seen_at
        LIMIT 50`,
      clause.params,
    );

    const stale = await c.query<{
      id: string;
      contact_name: string | null;
      last_activity_at: Date;
      days_since: string;
    }>(
      `SELECT id, contact_name, last_activity_at,
              floor(extract(epoch FROM (now() - last_activity_at)) / 86400) AS days_since
         FROM adsagent.enquiries
        WHERE ${clause.sql}
          AND lifecycle = 'active'
          AND reply_state <> 'closed'
          AND last_activity_at < now() - ($${clause.params.length + 1}::int * interval '1 day')
        ORDER BY last_activity_at
        LIMIT 50`,
      [...clause.params, noContactDays],
    );

    return {
      dueReminders: dueReminders.rows.map((r) => ({
        id: r.id,
        dueAt: r.due_at.toISOString(),
        note: r.note,
        enquiryId: r.enquiry_id,
        contactName: r.contact_name,
      })),
      waitingEnquiries: waiting.rows.map((r) => ({
        id: r.id,
        contactName: r.contact_name,
        listingUrl: r.listing_url,
        firstSeenAt: r.first_seen_at.toISOString(),
      })),
      noContactSince: stale.rows.map((r) => ({
        id: r.id,
        contactName: r.contact_name,
        lastActivityAt: r.last_activity_at.toISOString(),
        daysSince: Number(r.days_since),
      })),
    };
  });
}
```

- [ ] **Step 4: Write the scheduler**

```ts
// ads-agent/lib/reminders/scheduler.ts
import { withCrossTenantRead } from "../db/cross-tenant";
import { createNotification } from "../db/notifications";
import { claimDueReminders } from "../db/reminders";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";

/**
 * Fires every reminder whose due time has passed, for every org. Idempotent by
 * construction: claimDueReminders takes FOR UPDATE SKIP LOCKED, and the
 * notification insert and the state flip commit together, so two scheduler
 * instances cannot both notify for one reminder.
 */
export async function fireDueReminders(
  now: Date = new Date(),
  limit = 200,
): Promise<{ fired: number }> {
  const due = await withCrossTenantRead("reminder-scheduler", (client) =>
    claimDueReminders(client, now.toISOString(), limit),
  );

  let fired = 0;
  for (const reminder of due) {
    const scope: Scope = { kind: "org", orgId: reminder.orgId };
    try {
      await withTenantTransaction(scope, async (client) => {
        await createNotification(
          scope,
          {
            userId: reminder.userId,
            kind: "reminder_due",
            enquiryId: reminder.enquiryId,
            title: "Reminder due",
            body: reminder.note,
          },
          client,
        );
        await client.query(
          `UPDATE adsagent.reminders SET state = 'fired', fired_at = now()
            WHERE org_id = $1 AND id = $2 AND state = 'pending'`,
          [reminder.orgId, reminder.id],
        );
      });
      fired++;
    } catch (err) {
      // One org's failure must not stall every other org's reminders. The row
      // stays pending, so the next tick retries it.
      console.error("reminder scheduler: failed to fire", {
        reminderId: reminder.id,
        orgId: reminder.orgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { fired };
}
```

```ts
// ads-agent/scripts/run-reminder-scheduler.ts
/**
 * Fires due reminders into the notification feed — `npm run worker:reminders`.
 * Follows scripts/run-decision-cycle.ts: the schedule is env-overridable and
 * the work is idempotent, so restarting mid-tick loses nothing.
 */
import cron from "node-cron";
import { fireDueReminders } from "../lib/reminders/scheduler";

// Every minute: a reminder that fires up to six hours late is not a reminder.
const SCHEDULE = process.env.REMINDER_SCHEDULE ?? "* * * * *";

async function tick(): Promise<void> {
  const result = await fireDueReminders();
  if (result.fired > 0) console.log(`reminder scheduler: fired ${result.fired}`);
}

cron.schedule(SCHEDULE, () => {
  tick().catch((err) => console.error("reminder scheduler: tick failed", err));
});

console.log(`reminder scheduler started, schedule="${SCHEDULE}" (Ctrl+C to stop)`);
```

- [ ] **Step 5: Write the three routes**

```ts
// ads-agent/app/api/today/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getTodayFeed } from "@/lib/db/today-feed";

export async function GET(req: Request) {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();

  const raw = new URL(req.url).searchParams.get("noContactDays");
  const parsed = raw === null ? 7 : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    return NextResponse.json(
      { error: "noContactDays must be a whole number between 1 and 365" },
      { status: 400 },
    );
  }

  const feed = await getTodayFeed(scope, {
    userId: access.session.userId,
    noContactDays: parsed,
  });
  return NextResponse.json(feed);
}
```

```ts
// ads-agent/app/api/reminders/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { createReminder, listPendingReminders } from "@/lib/db/reminders";

export async function GET() {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const reminders = await listPendingReminders(scope, { userId: access.session.userId });
  return NextResponse.json({ reminders });
}

export async function POST(req: Request) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();

  let body: { enquiryId?: unknown; dueAt?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.dueAt !== "string" || Number.isNaN(Date.parse(body.dueAt))) {
    return NextResponse.json({ error: "dueAt must be an ISO timestamp" }, { status: 400 });
  }

  try {
    const reminder = await createReminder(scope, {
      enquiryId: typeof body.enquiryId === "string" ? body.enquiryId : null,
      userId: access.session.userId,
      dueAt: body.dueAt,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    });
    return NextResponse.json({ reminder }, { status: 201 });
  } catch (err) {
    // createReminder rejects a past dueAt: that is a bad request, not a bug.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not create reminder" },
      { status: 400 },
    );
  }
}
```

```ts
// ads-agent/app/api/reminders/[id]/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { REMINDER_STATES, setReminderState, type ReminderState } from "@/lib/db/reminders";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  let state: unknown;
  try {
    ({ state } = (await req.json()) as { state?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // 'fired' is the scheduler's to set, not a client's.
  const settable: ReminderState[] = ["done", "cancelled"];
  if (typeof state !== "string" || !settable.includes(state as ReminderState)) {
    return NextResponse.json(
      { error: `state must be one of ${settable.join(", ")} (of ${REMINDER_STATES.join(", ")})` },
      { status: 400 },
    );
  }

  const reminder = await setReminderState(scope, id, state as ReminderState);
  if (!reminder) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ reminder });
}
```

- [ ] **Step 6: Run the tests**

Run: `cd ads-agent && npx vitest run lib/db/today-feed.test.ts lib/reminders/scheduler.test.ts lib/db/no-crm-imports.test.ts`
Expected: PASS, 4 + 3 + 2 tests.

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/today-feed.ts ads-agent/lib/db/today-feed.test.ts \
        ads-agent/lib/reminders/ ads-agent/scripts/run-reminder-scheduler.ts \
        ads-agent/app/api/today/ ads-agent/app/api/reminders/
git commit -m "feat(reminders): scheduler firing into notifications, and Today (C5, C6)

'No contact since X' is a query rather than a table: materialising it would
be a cache that goes stale the moment a broker makes a call. Firing is
idempotent -- SKIP LOCKED claim plus notification and state flip in one
transaction -- so two scheduler instances cannot double-notify."
```

## Task 21: Requirement extraction from call notes (C3)

**Wave:** S5-B · **Skills:** `senior-backend`, `prompt-engineer` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/enquiries/requirement-extraction.ts`
- Create: `ads-agent/lib/enquiries/requirement-extraction.test.ts`
- Create: `ads-agent/app/api/enquiries/[id]/requirements/extract/route.ts`
- Create: `ads-agent/app/api/enquiries/[id]/requirements/revisions/[revisionId]/apply/route.ts`

**Interfaces:**
- Consumes: `chatCompletion`, `firstChoiceContent`, `isBifrostConfigured` from `ads-agent/lib/bifrost/client.ts:49,65,72`; `createRevision`, `applyRevision`, `listPendingRevisions`, `type RequirementPatch` (Task 9); `getEnquiryById` (Task 6); `createNotification` (Task 18).
- Produces:
  - `extractRequirementDiff(notes: string): Promise<RequirementPatch>`
  - `parseRequirementDiff(raw: string | undefined): RequirementPatch` — pure, exported for testing
  - `POST /api/enquiries/[id]/requirements/extract` → creates a **pending** revision
  - `POST /api/enquiries/[id]/requirements/revisions/[revisionId]/apply` → applies it, with a confirming user

**Context:** Backend spec C3. **Extraction must never auto-apply.** The screen shows chips and an explicit "Update the requirement" button, and the backend contract mirrors that: `extract` writes a revision with `applied = false`, and only `applyRevision` — which requires `confirmedBy` and is guarded by a check constraint (Task 9) — can change the live requirement. The extract route does not call `upsertRequirement` at all, and a test asserts that.

The model is asked for a strict JSON schema and its output is re-validated in TypeScript anyway: `responseFormat` is a request, not a guarantee, and a hallucinated `desksMin: -3` must not reach a `CHECK` constraint and 500 the request. Anything that fails validation is dropped from the patch rather than failing the whole extraction — a partial diff is useful and an error is not.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/enquiries/requirement-extraction.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatCompletion = vi.fn();
vi.mock("../bifrost/client", () => ({
  chatCompletion,
  isBifrostConfigured: () => true,
  firstChoiceContent: (r: { choices?: { message?: { content?: string } }[] }) =>
    r.choices?.[0]?.message?.content,
}));

import { extractRequirementDiff, parseRequirementDiff } from "./requirement-extraction";

function reply(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => chatCompletion.mockReset());

describe("parseRequirementDiff", () => {
  it("keeps the fields it understands", () => {
    expect(
      parseRequirementDiff(
        JSON.stringify({
          desksMin: 38,
          desksMax: 38,
          budgetPerDeskInr: 9500,
          moveInBy: "2026-09-01",
          mustHaves: ["metro walkable"],
        }),
      ),
    ).toEqual({
      desksMin: 38,
      desksMax: 38,
      budgetPerDeskInr: 9500,
      moveInBy: "2026-09-01",
      mustHaves: ["metro walkable"],
    });
  });

  it("drops an impossible value instead of letting it reach a CHECK constraint", () => {
    expect(parseRequirementDiff(JSON.stringify({ desksMin: -3, desksMax: 40 }))).toEqual({
      desksMax: 40,
    });
  });

  it("drops a range that is the wrong way round", () => {
    expect(parseRequirementDiff(JSON.stringify({ desksMin: 40, desksMax: 10 }))).toEqual({});
  });

  it("returns an empty patch for prose, not a throw", () => {
    expect(parseRequirementDiff("I could not find any requirements.")).toEqual({});
  });

  it("returns an empty patch for undefined", () => {
    expect(parseRequirementDiff(undefined)).toEqual({});
  });

  it("ignores keys that are not requirement fields", () => {
    expect(parseRequirementDiff(JSON.stringify({ desksMin: 12, tier: "hot" }))).toEqual({
      desksMin: 12,
    });
  });
});

describe("extractRequirementDiff", () => {
  it("asks for strict JSON and returns the validated patch", async () => {
    chatCompletion.mockResolvedValue(reply(JSON.stringify({ desksMin: 38, desksMax: 38 })));
    await expect(extractRequirementDiff("They settled on 38 desks")).resolves.toEqual({
      desksMin: 38,
      desksMax: 38,
    });
    const options = chatCompletion.mock.calls[0][0];
    expect(options.responseFormat?.type).toBe("json_schema");
    expect(options.temperature).toBe(0);
  });

  it("returns an empty patch when the model call fails, rather than throwing at the broker", async () => {
    chatCompletion.mockRejectedValue(new Error("upstream 503"));
    await expect(extractRequirementDiff("They settled on 38 desks")).resolves.toEqual({});
  });

  it("does not call the model for empty notes", async () => {
    await expect(extractRequirementDiff("   ")).resolves.toEqual({});
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/enquiries/requirement-extraction.test.ts`
Expected: FAIL — `Failed to resolve import "./requirement-extraction"`.

- [ ] **Step 3: Write the extraction module**

```ts
// ads-agent/lib/enquiries/requirement-extraction.ts
import { chatCompletion, firstChoiceContent, isBifrostConfigured } from "../bifrost/client";
import type { RequirementPatch } from "../db/enquiry-requirements";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    desksMin: { type: ["integer", "null"] },
    desksMax: { type: ["integer", "null"] },
    budgetPerDeskInr: { type: ["number", "null"] },
    moveInBy: { type: ["string", "null"], description: "ISO date, YYYY-MM-DD" },
    mustHaves: { type: "array", items: { type: "string" } },
  },
  required: [],
} as const;

const SYSTEM = `You extract office-space requirements from a broker's call notes.
Return only what the notes actually state. Omit any field the notes do not
mention -- do not infer, do not fill gaps, and do not repeat a previous value.
Desk counts are whole numbers. Budget is rupees per desk per month. Dates are
ISO YYYY-MM-DD.`;

/**
 * Re-validates the model's output in TypeScript even though the request asked
 * for a strict schema: responseFormat is a request, not a guarantee, and a
 * hallucinated desksMin of -3 must not reach a CHECK constraint and 500 the
 * broker's request. A field that fails validation is dropped rather than
 * failing the whole extraction -- a partial diff is useful, an error is not.
 */
export function parseRequirementDiff(raw: string | undefined): RequirementPatch {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const source = parsed as Record<string, unknown>;
  const patch: RequirementPatch = {};

  const desksMin = Number(source.desksMin);
  if (Number.isInteger(desksMin) && desksMin > 0) patch.desksMin = desksMin;

  const desksMax = Number(source.desksMax);
  if (Number.isInteger(desksMax) && desksMax > 0) patch.desksMax = desksMax;

  if (patch.desksMin !== undefined && patch.desksMax !== undefined) {
    if (patch.desksMax < patch.desksMin) {
      delete patch.desksMin;
      delete patch.desksMax;
    }
  }

  const budget = Number(source.budgetPerDeskInr);
  if (Number.isFinite(budget) && budget >= 0) patch.budgetPerDeskInr = budget;

  if (typeof source.moveInBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.moveInBy)) {
    if (!Number.isNaN(Date.parse(source.moveInBy))) patch.moveInBy = source.moveInBy;
  }

  if (Array.isArray(source.mustHaves)) {
    const cleaned = source.mustHaves
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length <= 120);
    if (cleaned.length > 0) patch.mustHaves = cleaned;
  }

  return patch;
}

export async function extractRequirementDiff(notes: string): Promise<RequirementPatch> {
  if (!notes.trim() || !isBifrostConfigured()) return {};
  try {
    const response = await chatCompletion({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: notes.slice(0, 4000) },
      ],
      // Zero temperature: the same notes must yield the same diff, or the
      // broker cannot trust the chips they are being asked to confirm.
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 20_000,
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "requirement_diff", schema: SCHEMA, strict: true },
      },
    });
    return parseRequirementDiff(firstChoiceContent(response));
  } catch (err) {
    // The broker is mid-call-log. An extraction failure degrades to no chips,
    // never to a failed call log.
    console.error("requirement extraction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
```

- [ ] **Step 4: Write the two routes**

```ts
// ads-agent/app/api/enquiries/[id]/requirements/extract/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getEnquiryById } from "@/lib/db/enquiries";
import { createRevision } from "@/lib/db/enquiry-requirements";
import { extractRequirementDiff } from "@/lib/enquiries/requirement-extraction";

/**
 * Proposes; never applies (C3). The screen shows the returned diff as chips
 * with an explicit "Update the requirement" button, which calls the apply
 * route. This handler does not import upsertRequirement, deliberately.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  let notes: unknown;
  try {
    ({ notes } = (await req.json()) as { notes?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof notes !== "string" || !notes.trim()) {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const proposed = await extractRequirementDiff(notes);
  if (Object.keys(proposed).length === 0) {
    return NextResponse.json({ revision: null, proposed: {} });
  }

  const revision = await createRevision(scope, { enquiryId: id, source: "call_notes", proposed });
  return NextResponse.json({ revision, proposed }, { status: 201 });
}
```

```ts
// ads-agent/app/api/enquiries/[id]/requirements/revisions/[revisionId]/apply/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getEnquiryById } from "@/lib/db/enquiries";
import { applyRevision } from "@/lib/db/enquiry-requirements";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id, revisionId } = await params;

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // The session user is the confirming human. applyRevision refuses an empty
  // one, and a check constraint refuses an applied revision with no confirmer.
  const requirement = await applyRevision(scope, revisionId, access.session.userId);
  if (!requirement) {
    return NextResponse.json({ error: "not found or already applied" }, { status: 404 });
  }
  return NextResponse.json({ requirement });
}
```

- [ ] **Step 5: Assert the extract route cannot apply**

Add to `ads-agent/lib/enquiries/requirement-extraction.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the extract route cannot apply a requirement (C3)", () => {
  const src = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "app",
      "api",
      "enquiries",
      "[id]",
      "requirements",
      "extract",
      "route.ts",
    ),
    "utf8",
  );

  it("does not import upsertRequirement", () => {
    expect(src).not.toContain("upsertRequirement");
  });

  it("does not import applyRevision", () => {
    expect(src).not.toContain("applyRevision");
  });

  it("creates a revision, which starts unapplied", () => {
    expect(src).toContain("createRevision");
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `cd ads-agent && npx vitest run lib/enquiries/requirement-extraction.test.ts`
Expected: PASS, 12 tests.

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/enquiries/requirement-extraction.ts \
        ads-agent/lib/enquiries/requirement-extraction.test.ts \
        "ads-agent/app/api/enquiries/[id]/requirements/extract/route.ts" \
        "ads-agent/app/api/enquiries/[id]/requirements/revisions/[revisionId]/apply/route.ts"
git commit -m "feat(enquiries): requirement extraction that proposes only (C3)

The extract route writes an unapplied revision and does not import
upsertRequirement -- a static test asserts that, because 'never
auto-applies' is a property and not an intention. The model's JSON is
re-validated in TypeScript: a hallucinated negative desk count must not
reach a CHECK constraint and 500 a broker mid call log."
```

## Task 22: Contact reveal (A5)

**Wave:** S5-B · **Skills:** `security-auditor`, `senior-backend` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/db/contact-reveal.ts`
- Create: `ads-agent/lib/db/contact-reveal.test.ts`
- Create: `ads-agent/app/api/enquiries/[id]/reveal/route.ts`

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` (S3); `withTenantTransaction`, `orgIdForWrite` (Task 2); `recordAccess` (Task 5).
- Produces:
  - `type RevealedContact = { name: string | null; phone: string | null; email: string | null; source: "twenty" | "captured" }`
  - `revealContact(scope, enquiryId, actorUserId): Promise<RevealedContact | null>`
  - `POST /api/enquiries/[id]/reveal`

**Context:** Backend spec A5. `maskPhone()` in `twenty-pipeline.ts:63` hides the number on every CRM surface; A5 asks for an authorised unmask for the owning broker. Two things make this more than a getter:

1. **It says which value it returned.** `enquiries.contact_phone` is the immutable as-captured submission; `contacts.phone` is the Twenty-reconciled cache. When the contact is `synced` the reconciled value is the truth, because Twenty's dedup may have merged the person; otherwise the captured value is all there is. Returning one silently would leave the broker unable to tell a corrected number from an original one.
2. **Every reveal is audited.** Rule 6(1)(c) and (e) require access logs, and unmasking personal data is exactly the access a breach report has to enumerate. The audit row commits in the **same transaction** as the read, so there is no window in which a reveal happened and no log exists.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/contact-reveal.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const recordAccess = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./access-log", () => ({ recordAccess }));

import { revealContact } from "./contact-reveal";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => {
  query.mockReset();
  recordAccess.mockReset().mockResolvedValue(undefined);
});

describe("revealContact", () => {
  it("prefers the Twenty-reconciled value and says so", async () => {
    query.mockResolvedValue({
      rows: [
        {
          captured_name: "Asha Rao",
          captured_phone: "+919800000000",
          captured_email: null,
          contact_name: "Asha R Rao",
          contact_phone: "+919800000001",
          contact_email: "asha@example.com",
          sync_state: "synced",
        },
      ],
    });
    await expect(revealContact(scope, "enq-1", "user-7")).resolves.toEqual({
      name: "Asha R Rao",
      phone: "+919800000001",
      email: "asha@example.com",
      source: "twenty",
    });
  });

  it("falls back to the as-captured value when the contact has not synced", async () => {
    query.mockResolvedValue({
      rows: [
        {
          captured_name: "Asha Rao",
          captured_phone: "+919800000000",
          captured_email: null,
          contact_name: "Asha Rao",
          contact_phone: null,
          contact_email: null,
          sync_state: "pending",
        },
      ],
    });
    await expect(revealContact(scope, "enq-1", "user-7")).resolves.toEqual({
      name: "Asha Rao",
      phone: "+919800000000",
      email: null,
      source: "captured",
    });
  });

  it("audits the reveal in the same transaction as the read", async () => {
    query.mockResolvedValue({
      rows: [
        {
          captured_name: "Asha Rao",
          captured_phone: "+919800000000",
          captured_email: null,
          contact_name: null,
          contact_phone: null,
          contact_email: null,
          sync_state: null,
        },
      ],
    });
    await revealContact(scope, "enq-1", "user-7");
    expect(recordAccess).toHaveBeenCalledWith(
      scope,
      {
        actorKind: "user",
        actorRef: "user-7",
        action: "contact.reveal",
        subjectKind: "enquirer",
        subjectRef: "enq-1",
      },
      expect.anything(),
    );
  });

  it("returns null and audits nothing for another tenant's enquiry", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(revealContact(scope, "enq-other", "user-7")).resolves.toBeNull();
    expect(recordAccess).not.toHaveBeenCalled();
  });

  it("does not reveal a suppressed enquiry's contact", async () => {
    query.mockResolvedValue({ rows: [] });
    await revealContact(scope, "enq-1", "user-7");
    expect(String(query.mock.calls[0][0])).toContain("lifecycle = 'active'");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/contact-reveal.test.ts`
Expected: FAIL — `Failed to resolve import "./contact-reveal"`.

- [ ] **Step 3: Write the module**

```ts
// ads-agent/lib/db/contact-reveal.ts
import { recordAccess } from "./access-log";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type RevealedContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Which of the two identity sources this came from, so the broker can tell. */
  source: "twenty" | "captured";
};

type RevealRow = {
  captured_name: string | null;
  captured_phone: string | null;
  captured_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  sync_state: string | null;
};

/**
 * The authorised unmask (A5). maskPhone() hides the number on every CRM
 * surface; this is the one path that returns it, and it audits itself in the
 * same transaction as the read so there is no window in which a reveal
 * happened and no log exists.
 *
 * Twenty's reconciled value wins when the contact is synced, because its dedup
 * may have merged the person and the merged result is the truth (§3). The
 * `source` field is not decoration: a broker needs to know whether they are
 * looking at a corrected number or the one the enquirer typed.
 */
export async function revealContact(
  scope: Scope,
  enquiryId: string,
  actorUserId: string,
): Promise<RevealedContact | null> {
  orgIdForWrite(scope);
  const clause = scopeClause(scope, "e.org_id");

  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<RevealRow>(
      `SELECT e.contact_name  AS captured_name,
              e.contact_phone AS captured_phone,
              e.contact_email AS captured_email,
              c.name          AS contact_name,
              c.phone         AS contact_phone,
              c.email         AS contact_email,
              c.sync_state    AS sync_state
         FROM adsagent.enquiries e
         LEFT JOIN adsagent.contacts c ON c.id = e.contact_id AND c.org_id = e.org_id
        WHERE ${clause.sql} AND e.lifecycle = 'active' AND e.id = $${clause.params.length + 1}`,
      [...clause.params, enquiryId],
    );
    const row = rows[0];
    if (!row) return null;

    await recordAccess(
      scope,
      {
        actorKind: "user",
        actorRef: actorUserId,
        action: "contact.reveal",
        subjectKind: "enquirer",
        subjectRef: enquiryId,
      },
      client,
    );

    if (row.sync_state === "synced") {
      return {
        name: row.contact_name,
        phone: row.contact_phone,
        email: row.contact_email,
        source: "twenty",
      };
    }
    return {
      name: row.captured_name ?? row.contact_name,
      phone: row.captured_phone,
      email: row.captured_email,
      source: "captured",
    };
  });
}
```

- [ ] **Step 4: Write the route**

```ts
// ads-agent/app/api/enquiries/[id]/reveal/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { revealContact } from "@/lib/db/contact-reveal";

/**
 * POST rather than GET, deliberately: this is an audited, non-idempotent act
 * from a compliance point of view, and it must not be cached, prefetched or
 * retried by a browser on the broker's behalf.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeFromSession();
  const { id } = await params;

  const contact = await revealContact(scope, id, access.session.userId);
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ contact }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 5: Run the tests**

Run: `cd ads-agent && npx vitest run lib/db/contact-reveal.test.ts lib/db/no-crm-imports.test.ts`
Expected: PASS, 5 + 2 tests.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/contact-reveal.ts ads-agent/lib/db/contact-reveal.test.ts \
        "ads-agent/app/api/enquiries/[id]/reveal/route.ts"
git commit -m "feat(enquiries): audited contact reveal (A5)

maskPhone hides the number everywhere; this is the one path that returns it,
and the audit row commits in the same transaction as the read. It reports
which of the two identity sources it used, because a broker needs to know
whether they are seeing a corrected number or the one the enquirer typed."
```

## Task 23 (fan-in): the S5 gate

**Wave:** S5-C · **Skills:** `senior-qa`, `tdd-guide`, `adversarial-reviewer` · **Model:** `inherit`

**Files:**
- Create: `ads-agent/lib/enquiries/enquiry-loop.integration.test.ts`

**Interfaces:** Consumes everything from Tasks 17–22. Produces the gate.

**Context:** The S5 gate is "reminders and extraction working". Reminders are provable end to end against the database; extraction's model call is not, so its gate is that a proposal reaches the pending state and cannot reach the live requirement without a confirming human — which is the property that matters and is exactly what C3 asks for.

- [ ] **Step 1: Merge the wave**

```bash
git checkout main
git merge --no-ff s5b-reminders-today s5b-extraction s5b-reveal
```

Expected: no conflicts — the three branches share no file (see the wave S5-B disjointness proof).

- [ ] **Step 2: Write the gate test**

```ts
// ads-agent/lib/enquiries/enquiry-loop.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "../db/client";
import { revealContact } from "../db/contact-reveal";
import { createContact } from "../db/contacts";
import { createEnquiry } from "../db/enquiries";
import { addMessage } from "../db/enquiry-messages";
import { applyRevision, createRevision, getRequirement } from "../db/enquiry-requirements";
import { listSignals, refreshEnquirySignals } from "../db/enquiry-signals";
import { listNotifications } from "../db/notifications";
import { createReminder, listPendingReminders } from "../db/reminders";
import { getTodayFeed } from "../db/today-feed";
import { fireDueReminders } from "../reminders/scheduler";
import type { Scope } from "../db/scope-sql";

if (!process.env.DATABASE_URL) {
  throw new Error("enquiry-loop.integration.test.ts requires DATABASE_URL");
}

let orgId: string;
let userId: string;
let scope: Scope;

beforeAll(async () => {
  const pool = getPool();
  const org = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, slug) VALUES ('Loop Test', 'loop-test') RETURNING id`,
  );
  orgId = org.rows[0].id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO public.users (org_id, email, role) VALUES ($1, 'loop@test.local', 'operator')
     RETURNING id`,
    [orgId],
  );
  userId = user.rows[0].id;
  scope = { kind: "org", orgId };
});

afterAll(async () => {
  const pool = getPool();
  await pool.query(`DELETE FROM public.orgs WHERE slug = 'loop-test'`);
  await pool.end();
});

async function seedEnquiry(name: string) {
  const contact = await createContact(scope, { name, phone: "+919800000000" });
  const enquiry = await createEnquiry(scope, {
    contactId: contact.id,
    contactName: name,
    contactPhone: "+919800000000",
  });
  return { contact, enquiry };
}

describe("reminders work end to end (C4, C5)", () => {
  it("fires a due reminder into the notification feed exactly once", async () => {
    const { enquiry } = await seedEnquiry("Reminder Target");
    const reminder = await createReminder(scope, {
      enquiryId: enquiry.id,
      userId,
      dueAt: new Date(Date.now() + 60_000).toISOString(),
      note: "Call back about the tour",
    });
    expect(await listPendingReminders(scope, { userId })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: reminder.id })]),
    );

    // Nothing due yet.
    expect(await fireDueReminders(new Date())).toEqual({ fired: 0 });

    const after = new Date(Date.now() + 120_000);
    expect((await fireDueReminders(after)).fired).toBeGreaterThanOrEqual(1);

    const notifications = await listNotifications(scope, userId, { unreadOnly: true });
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reminder_due", enquiryId: enquiry.id }),
      ]),
    );

    // Idempotent: a second pass finds nothing pending and does not double-notify.
    const before = notifications.length;
    await fireDueReminders(after);
    expect(await listNotifications(scope, userId, { unreadOnly: true })).toHaveLength(before);
  });
});

describe("the Today feed answers all three questions (C6)", () => {
  it("lists waiting enquiries and enquiries with no contact since the window", async () => {
    const { enquiry } = await seedEnquiry("Stale Target");
    await getPool().query(
      `UPDATE adsagent.enquiries SET last_activity_at = now() - interval '30 days'
        WHERE id = $1`,
      [enquiry.id],
    );

    const feed = await getTodayFeed(scope, { userId, noContactDays: 7 });
    expect(feed.waitingEnquiries.map((e) => e.id)).toContain(enquiry.id);
    const stale = feed.noContactSince.find((e) => e.id === enquiry.id);
    expect(stale?.daysSince).toBeGreaterThanOrEqual(29);

    // A tighter window than the gap must still find it; a wider one must not.
    const wide = await getTodayFeed(scope, { userId, noContactDays: 90 });
    expect(wide.noContactSince.map((e) => e.id)).not.toContain(enquiry.id);
  });
});

describe("extraction proposes and only a human applies (C3)", () => {
  it("leaves the live requirement untouched until a revision is confirmed", async () => {
    const { enquiry } = await seedEnquiry("Extraction Target");
    const revision = await createRevision(scope, {
      enquiryId: enquiry.id,
      source: "call_notes",
      proposed: { desksMin: 38, desksMax: 38 },
    });

    expect(await getRequirement(scope, enquiry.id)).toBeNull();

    const applied = await applyRevision(scope, revision.id, userId);
    expect(applied).toMatchObject({ desksMin: 38, desksMax: 38 });

    // Applying twice is refused rather than silently repeated.
    expect(await applyRevision(scope, revision.id, userId)).toBeNull();

    const stored = await getPool().query<{ confirmed_by: string; applied: boolean }>(
      `SELECT confirmed_by, applied FROM adsagent.enquiry_requirement_revisions WHERE id = $1`,
      [revision.id],
    );
    expect(stored.rows[0]).toEqual({ confirmed_by: userId, applied: true });
  });

  it("refuses an applied revision with no confirming human at the database level", async () => {
    const { enquiry } = await seedEnquiry("Constraint Target");
    const revision = await createRevision(scope, {
      enquiryId: enquiry.id,
      source: "agent",
      proposed: { desksMin: 10 },
    });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT public.set_tenant($1)", [orgId]);
      await expect(
        client.query(
          `UPDATE adsagent.enquiry_requirement_revisions SET applied = true WHERE id = $1`,
          [revision.id],
        ),
      ).rejects.toThrow(/requirement_revision_confirmed/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("signals and reveal", () => {
  it("derives a countable signal from the thread (A6)", async () => {
    const { enquiry } = await seedEnquiry("Signal Target");
    await addMessage(scope, {
      enquiryId: enquiry.id,
      channel: "web_form",
      body: "What is the price per desk?",
    });
    await addMessage(scope, {
      enquiryId: enquiry.id,
      channel: "email",
      body: "Any discount on that pricing?",
      externalId: "loop-1",
    });
    await refreshEnquirySignals(scope, enquiry.id);
    const signals = await listSignals(scope, enquiry.id);
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "asked_about_pricing", occurrences: 2 }),
      ]),
    );
  });

  it("writes an access-log row for every reveal (A5)", async () => {
    const { enquiry } = await seedEnquiry("Reveal Target");
    const revealed = await revealContact(scope, enquiry.id, userId);
    expect(revealed?.phone).toBe("+919800000000");
    expect(revealed?.source).toBe("captured");

    const audit = await getPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM context.access_log
        WHERE org_id = $1 AND action = 'contact.reveal' AND subject_ref = $2`,
      [orgId, enquiry.id],
    );
    expect(Number(audit.rows[0].n)).toBe(1);
  });
});
```

- [ ] **Step 3: Run the gate**

Run:

```bash
docker compose -f docker-compose.listings.yml up -d
cd ads-agent && npm run migrate && npx vitest run lib/enquiries/enquiry-loop.integration.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 4: Run everything**

Run: `cd ads-agent && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

Run: `npx vitest run && npx tsc --noEmit` from the repo root.
Expected: PASS, no type errors.

Run the RLS catalogue check from Task 16 Step 4 again — it now covers `reminders`, `notifications` and `enquiry_signals`.
Expected: zero rows other than the `deletion_propagations` exclusion recorded at S4.

- [ ] **Step 5: Adversarial review**

Dispatch one `adversarial-reviewer` on the most capable model over the merged S5 diff, with the Global Constraints as its attention lens, pointed at:

1. Whether anything other than `applyRevision` can write `adsagent.enquiry_requirements`.
2. Whether `fireDueReminders` can double-notify under two concurrent schedulers.
3. Whether any new query reaches a table outside `withTenantTransaction` or `withCrossTenantRead`.
4. Whether `revealContact` can return a value without its audit row committing.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/enquiries/enquiry-loop.integration.test.ts
git commit -m "test(s5): the enquiry loop gate

Reminders fire into notifications exactly once, the Today feed answers all
three questions, and a requirement revision cannot become live without a
confirming human -- enforced by a check constraint, not only by code."
```

**S5 gate — stop and confirm before Task 24.** Reminders fire idempotently, the Today feed answers, extraction proposes without applying, and both suites plus both type checks are clean.

## Task 24: Remove the interim platform-only guard

**Wave:** S5-D (last, alone) · **Skills:** `security-auditor`, `refactoring-specialist` · **Model:** `inherit`

**Files:**
- Modify: `ads-agent/lib/crm/twenty-client.ts` (delete `assertNotSharedInstance` and its call)
- Modify: `ads-agent/lib/crm/twenty-client.test.ts` (replace the two guard tests)

**Interfaces:** Consumes `orgsWithoutOwnInstance` (Task 4) through `scripts/check-twenty-coverage.ts` (Task 11). Produces nothing new — it removes code.

**Context:** The tenancy spec's Q4 resolution introduced a client-level platform-only guard as **interim containment**: Twenty's deduplication has merged contacts across tenant lines in the shared instance, so no org except the platform may reach it. §11 says the guard "stays in force until every org has its own instance, and is removed only then."

**This task is last on purpose.** The guard is the only thing standing between a newly created org with a misconfigured registry row and the contaminated shared instance. Removing it before every org is covered would not fail loudly — it would silently start merging a new customer's contacts into the shared pool, and that merge is not reversible.

After removal the client is still not permissive: `getTwentyClient` throws when an org has no connection or its connection is not `active`, which is a strictly stronger guard than the interim one because it is per-org rather than per-URL.

- [ ] **Step 1: Run the coverage gate and stop if it fails**

Run: `cd ads-agent && npx tsx --env-file=.env.local scripts/check-twenty-coverage.ts`
Expected: exit 0 with `twenty coverage: every org has its own active instance`.

**If it exits non-zero, stop here.** Do not proceed, do not weaken the check, and do not remove the guard for "just the orgs that are covered". Provision the listed orgs (Task 11 Step 7) and re-run. This is the only gate on this task and it is not advisory.

- [ ] **Step 2: Confirm no org points at the shared instance**

Run:

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) AS on_shared FROM context.twenty_connections
 WHERE base_url = '$SHARED_TWENTY_BASE_URL'"
```

Expected: `0`. If the platform org still has a row on the shared instance, retire it first — per §11 the shared instance becomes read-only and platform-only and is decommissioned when nothing references it, so a live registry row pointing at it means something still does.

- [ ] **Step 3: Replace the two guard tests with their successors**

In `ads-agent/lib/crm/twenty-client.test.ts`, delete these two tests:

- `"refuses a non-platform org pointed at the contaminated shared instance"`
- `"allows the platform org on the shared instance while the guard stands"`

and add:

```ts
it("no longer special-cases the shared instance, because no org points at it", async () => {
  getTwentyConnection.mockResolvedValue({ ...active, baseUrl: "https://crm.gentlespace.in" });
  const client = await getTwentyClient("org-1");
  expect(client.orgId).toBe("org-1");
});

it("still refuses any org without its own active connection, which is the stronger guard", async () => {
  getTwentyConnection.mockResolvedValue(null);
  await expect(getTwentyClient("org-2")).rejects.toThrow(/no Twenty connection/i);
  getTwentyConnection.mockResolvedValue({ ...active, state: "deprovisioned" });
  await expect(getTwentyClient("org-1")).rejects.toThrow(/state deprovisioned/i);
});
```

Also delete the two `process.env` assignments for `PLATFORM_ORG_ID` and `SHARED_TWENTY_BASE_URL` from `beforeEach`; nothing reads them any more.

- [ ] **Step 4: Run the tests and watch the new ones fail**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-client.test.ts`
Expected: FAIL on `no longer special-cases the shared instance` — the guard is still in place and throws `interim platform-only guard`. That failure is the proof the guard was actually load-bearing.

- [ ] **Step 5: Delete the guard**

In `ads-agent/lib/crm/twenty-client.ts`, delete the whole `assertNotSharedInstance` function and its call site inside `getTwentyClient`, so the resolver body reads:

```ts
export async function getTwentyClient(orgId: string): Promise<TwentyClient> {
  const connection = await getTwentyConnection(orgId);
  if (!connection) throw new Error(`twenty: no Twenty connection for org ${orgId}`);
  if (connection.state !== "active") {
    throw new Error(`twenty: connection for org ${orgId} is in state ${connection.state}`);
  }

  const base = connection.baseUrl.replace(/\/$/, "");
  const key = await resolveTwentyApiKey(connection.apiKeyRef);
  // ... rest of the function unchanged ...
```

- [ ] **Step 6: Run everything**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-client.test.ts`
Expected: PASS, 6 tests.

Run: `cd ads-agent && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

Run: `grep -rn "PLATFORM_ORG_ID\|SHARED_TWENTY_BASE_URL" ads-agent/lib ads-agent/app --include=*.ts --include=*.tsx`
Expected: no output outside `scripts/check-twenty-coverage.ts`, which keeps reading `SHARED_TWENTY_BASE_URL` so the coverage check still means something for orgs provisioned later.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/crm/twenty-client.ts ads-agent/lib/crm/twenty-client.test.ts
git commit -m "refactor(crm): remove the interim platform-only guard

Every org now has its own active Twenty instance -- verified by
scripts/check-twenty-coverage.ts, which is the gate for this change and
exits non-zero otherwise. What remains is stronger than what was removed:
getTwentyClient throws per-org when a connection is missing or not active,
rather than per-URL when it happens to be the shared one."
```

---

# Deferred, with the reason

Nothing here is forgotten. Each item is a spec requirement this plan deliberately does not implement, with why and where it lands.

| Requirement | Source | Why not here | Lands at |
|---|---|---|---|
| **Encryption at rest for `contact_phone` / `contact_email`** | data model §6.3, datastore §11.2 | Open question 12.1 — `pgcrypto` in-database versus application-side envelope encryption with GCP KMS — is unresolved, and the choice determines whether SQL-side search on those columns survives and whether key destruction can *be* the erasure primitive. Picking one inside an implementation task would be a design decision in disguise. The columns exist and are RLS-protected; §11.2 is explicit that RLS alone is not sufficient, so this is a real outstanding obligation and not a nicety. | A dedicated task once 12.1 is answered. Blocks nothing in S4/S5; **must** land before real enquirer data exists in production. |
| **Twenty-side per-subject deletion** | Twenty tenancy spec §10 | Suppression cannot import the Twenty client — the request path must not depend on Twenty being up, and `no-crm-imports.test.ts` enforces it. Task 15 writes `deletion_propagations` with `store = 'twenty'` in state `'pending'`, so the debt is on the ledger where a regulator can see it. | S5a, as an outbox consumer on `deletion.requested`. |
| **Outbox and relay** | datastore §14, tenancy spec §7 | S5a by the build sequence, which is after S5. Tasks 12 and 20 use claim-based pollers with the signatures the consumers will keep. | S5a |
| **Inbound email and WhatsApp** | backend spec B2, B3 | S15. `enquiry_messages` already carries `channel`, `external_id` and `reply_token`, and the unique key makes a redelivery a no-op, so the tables need no change. | S15 |
| **`G2` daily digest email** | backend spec G1/G2 | Explicitly "deferred — not decided", and it is the sole exception to BD2's no-sending-library rule. Task 18 ships in-app notifications only, so G1 stands without it. | undecided |
| **`G3` delivery preferences** | backend spec G3 | There is one delivery channel, so there is nothing to have a preference about. | with G2 |
| **`corridor_id` foreign key on `adsagent.enquiries`** | data model §3, §4 | `public.corridors` does not exist until S7. The column is present so S7 is one `ADD CONSTRAINT`. | S7 |
| **`listing_id` resolution from `listing_url`** | backend spec D3 | Attribution work. The column and the captured URL both exist. | S7 |
| **Twenty version-skew alerting** | tenancy spec §8 | `twenty_version` is recorded on every connection and returned on every client, so the comparison has its inputs. The alert needs the observability channel from datastore §12.4, which no step of this plan builds. | with datastore §12.4 |
| **Instance suspension policy** | tenancy spec §14.2 | Needs usage data that does not exist yet. `state = 'suspended'` is supported end to end: `getTwentyClient` throws on it and the projection worker degrades explicitly. | when there is usage data |
| **API-key seeding from Twenty's server CLI** | tenancy spec §14.1 | Twenty exposes no endpoint. Task 11 prints the manual step; automating it is not assumed. | if upstream adds one |

---

# Self-review

## 1. Spec coverage

| Spec requirement | Task |
|---|---|
| S4 gate: broker works an enquiry end to end | 16 (integration test, first describe block) |
| S4 gate: an enquiry survives Twenty being down | 12 (worker design), 16 (the test that proves it), 6 (`no-crm-imports.test.ts` as the structural guarantee) |
| S5 gate: reminders working | 17, 20, 23 |
| S5 gate: extraction working | 21, 23 |
| A1 enquiries table, the record not a shadow | 3, 6 |
| A2 reply-state lifecycle, mapped not conflated | 6 (`reply_state`), 12 (`REPLY_STATE_TO_STAGE` with `closed → null`) |
| A3 activity log, append-only | 8 |
| A4 structured requirements with revision history | 9, 13 |
| A5 contact reveal | 22 |
| A6 signals | 19 |
| B1 website form → enquiry, inverted | 14 |
| B4 message store with channel provenance | 7 |
| C1 call log write | 8, 13 |
| C2 outcome vocabulary as a typed enum | 8 (`CALL_OUTCOMES` plus a CHECK plus a call-shape constraint) |
| C3 extraction proposes, human confirms | 9 (`applyRevision` + check constraint), 21 (route that cannot apply) |
| C4 reminder model | 17 |
| C5 reminder scheduler firing into Today | 20 |
| C6 "no contact since X" | 20 (`today-feed.ts`) |
| C7 note sync back to Twenty | 12 (`projectPendingActivities`) |
| G1 notification model with read state | 18 |
| TW1 one instance per org | 4, 11 |
| TW2/TW3 ownership boundary, Twenty wins on identity | 3 (`markContactSynced` overwrites wholesale), 10 (`upsertPerson` returns Twenty's values), 22 (`source` field) |
| TW4 Twenty never synchronous on capture | 12, 14, 16 |
| TW5 enquiries reference a local contact row | 6 (`contact_id`, no `twenty_person_id`) |
| TW6 provisioning through Coolify | 11 |
| TW7 Gentle Space is itself a tenant | 11 Step 7, 14 (`GENTLE_SPACE_ORG_ID`) |
| TW8 contaminated instance not migrated | Global Constraints, 11 commit message, 24 |
| Tenancy §4 local schema | 3 |
| Tenancy §5 connection registry | 4 |
| Tenancy §6 client consolidation, both paths | 10 (ads-agent), 14 (root app) |
| Tenancy §7 write paths | 12, 13, 14 |
| Tenancy §8 dedup merge, unreachable, suspended, version skew | 3 (one-hop follow), 12 (23505 handling), 10 (throws on suspended), Deferred (skew alert) |
| Tenancy §9 provisioning and lifecycle | 11 |
| Tenancy §10 compliance | 15, Deferred (Twenty-side deletion) |
| Tenancy §11 migration — none, guard removed late | Global Constraints, 24 |
| Tenancy §12 build-sequence placement | matches: §3 client work carried forward in 10; §4 contacts and registry in 3, 4, 6; §5a noted throughout |
| Tenancy §13 non-goals | respected: no Twenty UI, no custom objects, no bidirectional sync beyond §3 |
| Data model §3 enquiry spine | 3, 6, 7, 8, 9, 17 |
| Data model §6.1 suppression then erasure | 5, 15 |
| Data model §6.2 access log | 5, 22 |
| Data model §6.3 encryption | **Deferred, with the reason stated** |
| Data model §0/§1 conventions | every migration; Task 16 Step 4 verifies mechanically |
| Datastore §11.1/§11.2/§11.3 | 5, 15; §11.3's cross-tenant caution is why `withCrossTenantRead` is `FOR SELECT` and audited |
| Dataflow review A-1 | 3, 6, 10, 22 — the boundary is implemented, including which side wins |
| Build sequence: suppression designed in **at S4** | 3, 5, 6, 15 — lifecycle columns are in the first migration of every table, never a later `ALTER` |

**Requirements I could not turn into a task:** one, `contact_phone`/`contact_email` encryption at rest, because open question 12.1 is unresolved and the answer changes the schema. It is in Deferred with the reason and a "must land before real enquirer data" condition.

## 2. Placeholder scan

No "TBD", no "add error handling", no "similar to Task N", no test described without its code, no reference to a type or function not defined in a task or named in a Consumes block. Every code step carries the code; every `Run:` carries expected output. Two drafting slips were found and fixed rather than explained away: a dead `sql`/`void sql` pair in Task 6 and a missing `.` in the scheduler's `process.env` read in Task 20.

Three places name a signature this plan does not define, each identified as coming from the S1–S3 plan and listed in Preconditions: `Scope`, `scopeClause`, and the `set_tenant`/`current_tenant` SQL functions. Task 10 additionally assumes S3 gave `logAiAction`, `getOverviewStats`, `countAiActionsToday`, `listRecentAiActions` and `runDecisionCycle` a leading `scope` parameter, and says explicitly what to do if S3 named it differently.

## 3. Type consistency

Checked across tasks, names identical throughout:

- `Scope` is `{ kind: "platform" } | { kind: "org"; orgId: string }` in every file.
- `withTenantTransaction(scope, fn)` in ads-agent; `withTenantTransaction(orgId, fn)` in the root app — **deliberately different**, because the root app has no `Scope` type, and both are documented at their definition.
- `ReplyState` = `"waiting" | "called" | "closed"`, exported from `enquiries.ts`, consumed by `twenty-projection.ts` and the state route.
- `CallOutcome` from `enquiry-activities.ts` is the same union in the migration CHECK, the calls route and `formatActivityNote`.
- `RequirementPatch` from `enquiry-requirements.ts` is what `extractRequirementDiff` returns, what `createRevision` stores, and what the requirements route parses.
- `UnsyncedActivity` is defined once in `enquiry-activities.ts` and consumed by `formatActivityNote` and `projectPendingActivities`.
- `orgIdForWrite` (not `requireOrgId`, not `orgIdFromScope`) everywhere.
- `markContactSynced` / `markContactSyncFailed` / `markContactMergedAway` / `markContactMergedIntoPerson` — four distinct names, each used consistently.
- `getTwentyClient(orgId: string)` takes a raw org id everywhere, never a `Scope`; the reason is stated at its definition and at `getTwentyConnection`.
- `ProjectionResult` is `{ attempted, succeeded, failed }` in both projection functions and both sets of assertions.
- `TwentyConnectionState` values match the migration's CHECK list exactly.
- `createNotification(scope, input, client?)` — the optional trailing client matches `createContact`, `createEnquiry`, `addMessage`, `createRevision`, `upsertRequirement`, `recordAccess` and `touchLastActivity`, which all follow the same convention.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-12-s4-s5-enquiry-spine.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration. Waves S4-A, S4-C, S4-D, S4-E, S5-A and S5-B each need one git worktree and branch per agent (`best-of-n-runner`), with the fan-in task closing the wave.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batching with checkpoints at the S4 and S5 gates.

**Which approach?**
