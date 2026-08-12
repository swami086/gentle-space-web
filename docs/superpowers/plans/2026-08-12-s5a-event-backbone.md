# S5a Event Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the transactional outbox, the Google Cloud Pub/Sub topology, and the relay between them, so that an event cannot exist without its row, or its row without the event.

**Architecture:** Domain writers insert into `context.outbox_events` **inside the same transaction as the domain change** — that single insert is the only publish path in the codebase. A relay process, connecting as its own cross-tenant role, claims unpublished rows with `FOR UPDATE SKIP LOCKED`, publishes them to Pub/Sub, and marks them published in the same transaction as the claim; a crash anywhere in that sequence yields duplicate delivery, never loss. Delivery is at-least-once, so consumers de-duplicate on the outbox event id via `context.consumed_events`, and deletion events — the one class where a drop is a compliance breach — are additionally reconciled against `context.deletion_propagations` rather than trusted to the queue.

**Tech Stack:** PostgreSQL 18 (`uuidv7()`, `FOR UPDATE SKIP LOCKED`, partial indexes, RLS), Google Cloud Pub/Sub with ordering keys and dead-letter topics, `@google-cloud/pubsub` (one new dependency, gated on approval in Task 5), the Pub/Sub emulator via Docker Compose for local tests, TypeScript, Vitest, `tsx` for cron and worker entry points.

---

## Preconditions

Do not start Task 1 until all four hold. Each is verifiable with one command; if any fails, **STOP and escalate** rather than creating the missing object under a migration number this plan does not own.

- [ ] **The S3 gate has passed.** `docs/superpowers/plans/2026-08-12-s1-s3-foundation.md` is merged to `main`, its cross-tenant suite is green including the pooled-connection case, and `ads-agent/lib/db/scope-sql.ts` exists exporting `type Scope` and `scopeClause`.

  Verify: `cd ads-agent && npx vitest run app/api/cross-tenant.test.ts` → PASS, and `ls ads-agent/lib/db/scope-sql.ts` → the path prints.

- [ ] **S4/S5 have landed the enquiry spine** (`docs/superpowers/plans/2026-08-12-s4-s5-enquiry-spine.md`), including the compliance tables from data model §6: `context.access_log`, `context.deletion_requests`, `context.deletion_propagations`.

  Verify:

```bash
psql "$TEST_DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='context' AND table_name IN ('access_log','deletion_requests','deletion_propagations') ORDER BY table_name"
```

  Expected exactly three rows: `access_log`, `deletion_propagations`, `deletion_requests`. Task 7 writes cross-tenant audit rows to the first; Task 9 reconciles against the other two. If they are absent they belong to S4's compliance scope — escalate, do not create them here.

- [ ] **The schemas and roles from S1–S3 exist:** `listings`, `adsagent`, `context`, `public`, `derived`, with `public.set_tenant(uuid)`, `public.current_tenant()`, `public.lifecycle_state` and `public.org_ref`.

  Verify: `psql "$TEST_DATABASE_URL" -c "SELECT public.current_tenant()"` → one row, `NULL`.

- [ ] **A live PostgreSQL 18 instance is reachable at `TEST_DATABASE_URL`**, as a non-superuser owner role without `BYPASSRLS`. The gate this plan exists to prove is a transaction-atomicity property; it cannot be proven against a mocked pool.

  Verify: `psql "$TEST_DATABASE_URL" -c "SHOW server_version" -c "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"` → version `18.x`, and both flags `f`.

**S5a must precede S6a.** Portal ingestion publishes `portal.event` through this outbox (build sequence, "What can run in parallel"). §14.6's GCS export subscription is defined here as a contract and created by an explicitly flagged command; the ClickHouse S3Queue side is S6/S6a's work and is not built in this plan.

---

## Global Constraints

Every task inherits these. Copy this section verbatim into every implementer and reviewer dispatch.

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

- **The outbox insert is the only publish path.** `ads-agent/lib/events/publisher.ts` is the only file in the repository permitted to import `@google-cloud/pubsub`, enforced by a repo-wide test (Task 11), not by convention.
- **`enqueueEvent` requires org scope and throws on platform scope.** Every event belongs to exactly one tenant; there is no cross-tenant event.
- **`claimUnpublished` requires platform scope and throws on org scope.** The relay publishes every tenant's events, and that asymmetry is a compile-and-runtime-visible fact rather than a comment.
- **The relay connects as `outbox_relay`,** a non-owner cross-tenant role with its own `USING (true)` policy, from `OUTBOX_RELAY_DATABASE_URL`. It never uses the application pool, and it writes one `context.access_log` row per org per tick with `actor_kind = 'cross_tenant'` (data model §5a).
- **Pub/Sub topic ids equal outbox topic values, character for character.** Pub/Sub permits periods in resource ids, so there is deliberately no name-mapping layer to drift.
- **Ordering key is `org_id::text`, never global** (§14.3). A failed publish permanently pauses that ordering key, so every failure path calls `resumePublishing`.
- **Database-backed tests are named `*.db.test.ts`** and run with `npx vitest run --config vitest.db.config.ts` from `ads-agent/`. They fail loudly when `TEST_DATABASE_URL` is unset — they never skip, because a gate that can silently not run is not a gate.
- **One new dependency, `@google-cloud/pubsub`, is proposed and must be approved** at Task 5 Step 1 before installation.

### Migration numbers owned by this plan

This plan owns **040–049** and uses five. Never use a number outside the range; never let two tasks claim the same number.

| Number | Task | Object |
|---|---|---|
| `040_outbox_events` | Task 1 | `context.outbox_events`, its indexes, RLS and policy |
| `041_outbox_relay_role` | Task 7 | role `outbox_relay`, its cross-tenant policy and grants |
| `042_outbox_health_view` | Task 10 | `context.outbox_health` (`security_invoker`) |
| `043_deletion_propagation_publish` | Task 9 | `ALTER TABLE context.deletion_propagations ADD COLUMN last_published_at` |
| `044_consumed_events` | Task 8 | `context.consumed_events`, the consumer idempotency guard |

---

## File Structure

**Created — `ads-agent/`**

| File | Responsibility |
|---|---|
| `lib/db/migrations/040_outbox_events.up.sql` / `.down.sql` | the outbox table, both indexes, RLS, tenant policy, grants |
| `lib/db/migrations/041_outbox_relay_role.up.sql` / `.down.sql` | the relay's role, its `USING (true)` policy, its grants |
| `lib/db/migrations/042_outbox_health_view.up.sql` / `.down.sql` | one view answering every §12.4 outbox signal |
| `lib/db/migrations/043_deletion_propagation_publish.up.sql` / `.down.sql` | `last_published_at` on the propagation ledger |
| `lib/db/migrations/044_consumed_events.up.sql` / `.down.sql` | the consumer idempotency table |
| `lib/db/test-support.ts` | live-database test helpers: pool, org seeding, outbox reset |
| `lib/db/tx.ts` | `withTenantTransaction` — the only way a domain write and its event share a transaction |
| `lib/db/outbox.ts` | `enqueueEvent`, `claimUnpublished`, `markPublished`, `markFailed` |
| `lib/events/topics.ts` | the topic vocabulary, single source of truth against the DB CHECK |
| `lib/events/envelope.ts` | `OutboxRow` → Pub/Sub message, including the idempotency attributes |
| `lib/events/publisher.ts` | the only file allowed to import `@google-cloud/pubsub` |
| `lib/events/relay-pool.ts` | the `outbox_relay` pool, separate from the application pool |
| `lib/events/relay.ts` | claim → publish → mark, one transaction, per-org fairness, cross-tenant audit |
| `lib/events/idempotency.ts` | `consumeOnce` — redelivery is a no-op |
| `lib/events/deletion-reconciler.ts` | §14.4: the ledger is truth, the queue is transport |
| `lib/events/health.ts` | §12.4 signals and their alert thresholds |
| `lib/events/prune.ts` | §5a retention: prune published rows, report bloat |
| `scripts/run-outbox-relay.ts` | the relay's long-running entry point |
| `scripts/run-deletion-reconciler.ts` | cron: re-publish unfinished erasures, alert on stalls |
| `scripts/check-outbox-health.ts` | cron: exit non-zero with one `ALERT` line per breached signal |
| `scripts/prune-outbox.ts` | cron: retention |
| `scripts/bootstrap-pubsub-emulator.ts` | create every topic and subscription in the emulator |
| `vitest.db.config.ts` | the `*.db.test.ts` project |

**Created — repository root app**

| File | Responsibility |
|---|---|
| `lib/db/scope.ts` | the same `Scope` type, duplicated deliberately (no shared package between apps) |
| `lib/db/tx.ts` | `withTenantTransaction` against the listings pool |
| `lib/db/outbox.ts` | `enqueueEvent` for the listings app, same SQL contract |
| `lib/events/no-direct-publish.test.ts` | repo-wide: only the publisher boundary may import the Pub/Sub client |

**Created — infrastructure**

| File | Responsibility |
|---|---|
| `infra/pubsub/create-topics.sh` | every `gcloud` call: topics, subscriptions, DLQ, IAM, optional GCS export |

**Modified**

| File | Change |
|---|---|
| `ads-agent/vitest.config.ts` | exclude `**/*.db.test.ts` from the default run |
| `ads-agent/package.json` | `@google-cloud/pubsub` dependency; `test:db`, `relay`, `reconcile:deletions`, `outbox:health`, `outbox:prune`, `pubsub:bootstrap` scripts |
| `docker-compose.listings.yml` | a `pubsub-emulator` service for local development and tests |
| `deploy/docker-compose.prod.yml` | an `outbox-relay` service |

---

## Parallel execution model

Ceiling of **8 concurrent implementation subagents**; this plan never reaches it. `superpowers:subagent-driven-development` lists parallel implementers sharing a working tree under **Never**, so each concurrent task is **one git worktree and one branch**, dispatched as the `best-of-n-runner` subagent type, and each wave closes with an explicit fan-in merge before the next wave is dispatched.

**The critical path is genuinely narrow.** The outbox table gates every other task, and the publish helper gates the relay, so Waves 1 and 2 are width 1 and 2. Inflating them would produce agents editing files that do not exist yet.

| Wave | Tasks | Width | Why that width |
|---|---|---|---|
| 1 | 1 | **1** | Task 1 creates `context.outbox_events` and `lib/db/test-support.ts`, which every later task's tests import, and it is the only task that edits `vitest.config.ts`. Nothing can be written against a table that does not exist. |
| 2 | 2, 4 | **2** | Disjoint file sets and no import between them: Task 2 owns `lib/db/tx.ts` + its test; Task 4 owns `lib/events/topics.ts`, `lib/events/envelope.ts` + their tests. Both depend only on Wave 1. Task 3 cannot join — `lib/db/outbox.ts` imports `OutboxTopic` from Task 4 and its test uses `withTenantTransaction` from Task 2. |
| 3 | 3, 5, 6 | **3** | Task 3 owns `lib/db/outbox.ts`; Task 5 owns `lib/events/publisher.ts`, `scripts/bootstrap-pubsub-emulator.ts`, `docker-compose.listings.yml`, `ads-agent/package.json`; Task 6 owns `infra/pubsub/create-topics.sh`. No file appears in two lists. All three consume only Wave 1–2 outputs (`OutboxTopic`, `PublishableMessage`, the table). No migrations in this wave, so no number can collide. |
| 4 | 7, 8, 11 | **3** | Task 7 owns migration `041`, `lib/events/relay-pool.ts`, `lib/events/relay.ts`, `scripts/run-outbox-relay.ts`, `deploy/docker-compose.prod.yml`. Task 8 owns migration `044`, `lib/events/idempotency.ts`. Task 11 owns the four root-app files. Distinct migration numbers, disjoint file sets, and all three need Wave 3's publisher and `outbox.ts`. Task 11's architecture test asserts the allowlist created in Wave 3, so it cannot run earlier. |
| 5 | 9, 10 | **2** | Task 9 owns migration `043`, `lib/events/deletion-reconciler.ts`, `scripts/run-deletion-reconciler.ts`. Task 10 owns migration `042`, `lib/events/health.ts`, `lib/events/prune.ts`, `scripts/check-outbox-health.ts`, `scripts/prune-outbox.ts`. Both import `relay-pool.ts` read-only from Wave 4 and neither modifies it. Migration numbers `043` and `042` are distinct. |
| 6 | 12 | **1** | Fan-in. The gate proves properties across every file in the plan; splitting it would let one agent declare the gate passed on half the evidence. Ends with a single whole-branch adversarial review. |

Fan-in after each wave: merge every branch into the wave's integration branch, run `cd ads-agent && npx vitest run` and `npx vitest run --config vitest.db.config.ts`, and only then dispatch the next wave.

### Dispatch assignment

| Task | Skills | Model |
|---|---|---|
| 1 | `postgres-pro`, `database-designer` | `composer-2.5-fast` |
| 2 | `senior-backend`, `tdd-guide` | `inherit` |
| 3 | `senior-backend`, `sql-pro` | `inherit` |
| 4 | `typescript-pro`, `tdd-guide` | `composer-2.5-fast` |
| 5 | `platform-engineer`, `docker-expert`, `typescript-pro` | `inherit` |
| 6 | `gcp-cloud-architect`, `senior-devops` | `inherit` |
| 7 | `senior-backend`, `postgres-pro`, `sre-engineer` | `inherit` |
| 8 | `postgres-pro`, `tdd-guide` | `composer-2.5-fast` |
| 9 | `senior-backend`, `postgres-pro`, `sre-engineer` | `inherit` |
| 10 | `observability-designer`, `postgres-pro` | `composer-2.5-fast` |
| 11 | `typescript-pro`, `test-automator` | `composer-2.5-fast` |
| 12 | `senior-qa`, `chaos-engineer`, `adversarial-reviewer` | `inherit` |

Seven tasks are `inherit`, five are `composer-2.5-fast`. The `inherit` set is not spread evenly on purpose: it is every task where a plausible-looking simplification silently loses an event (2, 3, 7, 9), where the task mutates infrastructure outside the repo (5, 6), or where the deliverable is a judgement rather than a file (12).

---

## What stays on cron, and why both exist (§14.5)

Recorded here because the plan's reviewers keep asking, and because "move it all to events" is the wrong instinct. **Cron is a clock; Pub/Sub is transport.** The rule: nothing in a cron job does work that can fail slowly — it finds candidates and publishes.

| Stays on cron | Finds by time | Publishes, rather than doing the work |
|---|---|---|
| `scripts/run-deletion-reconciler.ts` (Task 9) | propagations still `pending` past the threshold | `deletion.requested`, once per unfinished store |
| `scripts/prune-outbox.ts` (Task 10) | published rows past the retention window | nothing — deletion of its own bookkeeping is not an event |
| `scripts/check-outbox-health.ts` (Task 10) | now | nothing — it exits non-zero and prints `ALERT` lines |
| `scripts/run-decision-cycle.ts` (exists, untouched) | the `0 */6 * * *` tick | S10/S12 convert its inline work to `agent.task_requested`; this plan does not touch it |
| reminders due, snapshots past TTL, records past the retention floor, stale-graph sweeps | their own timestamps | `reminder.due`, `graph.tenant_stale`, `deletion.requested` — owned by S5, S8 and S8a respectively |

`scripts/run-outbox-relay.ts` is **not** cron. It is a continuous loop with a sub-second sleep, because outbox latency is user-visible and a minute-granularity clock would add a minute to every enquiry.

---

# Wave 1

## Task 1: The outbox table

**Files:**
- Create: `ads-agent/lib/db/migrations/040_outbox_events.up.sql`
- Create: `ads-agent/lib/db/migrations/040_outbox_events.down.sql`
- Create: `ads-agent/lib/db/test-support.ts`
- Create: `ads-agent/lib/db/outbox-schema.db.test.ts`
- Create: `ads-agent/vitest.db.config.ts`
- Modify: `ads-agent/vitest.config.ts`
- Modify: `ads-agent/package.json` (scripts only)

**Interfaces:**
- Consumes: `public.org_ref`, `public.current_tenant()`, schema `context`, table `public.orgs` — all from S1–S3.
- Produces: table `context.outbox_events` with columns `id, org_id, topic, payload, ordering_key, published_at, attempts, last_error, created_at`; indexes `outbox_events_unpublished_idx` and `outbox_events_org_created_idx`; policy `tenant_isolation`. Plus `ads-agent/lib/db/test-support.ts` exporting `testPool(): Pool`, `seedOrg(pool: Pool, name: string): Promise<string>`, `resetOutbox(pool: Pool): Promise<void>`, `closeTestPool(): Promise<void>` — **every later task's database test imports these.**

**Skills:** `postgres-pro`, `database-designer`
**Model:** `composer-2.5-fast` — every SQL statement, every catalogue assertion and both config files are written out below; this is transcription plus `psql` verification.

- [ ] **Step 1: Add the `*.db.test.ts` project and keep it out of the default run**

Create `ads-agent/vitest.db.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database-backed tests. Separate from vitest.config.ts because they need a live
// PostgreSQL 18 at TEST_DATABASE_URL and take seconds, not milliseconds.
// Run with: npx vitest run --config vitest.db.config.ts
export default defineConfig({
  test: {
    include: ["**/*.db.test.ts"],
    // Transaction-atomicity tests contend on the same rows; serialise them.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
```

Modify `ads-agent/vitest.config.ts` — replace the `test` block with:

```ts
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/*.db.test.ts"],
  },
```

Add to `ads-agent/package.json` `scripts`:

```json
    "test:db": "vitest run --config vitest.db.config.ts",
```

- [ ] **Step 2: Write the failing schema test**

Create `ads-agent/lib/db/outbox-schema.db.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, testPool } from "./test-support";

const pool = testPool();

afterAll(async () => {
  await closeTestPool();
});

describe("context.outbox_events", () => {
  it("lives in the context schema with the columns from data model 5a", async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'context' AND table_name = 'outbox_events'
        ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: "attempts", data_type: "integer", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "last_error", data_type: "text", is_nullable: "YES" },
      { column_name: "ordering_key", data_type: "text", is_nullable: "NO" },
      { column_name: "org_id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "payload", data_type: "jsonb", is_nullable: "NO" },
      { column_name: "published_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "topic", data_type: "text", is_nullable: "NO" },
    ]);
  });

  it("defaults id to uuidv7 so the relay reads in insertion order", async () => {
    const { rows } = await pool.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'context' AND table_name = 'outbox_events' AND column_name = 'id'`,
    );
    expect(rows[0].column_default).toContain("uuidv7()");
  });

  it("has row level security enabled AND forced", async () => {
    const { rows } = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname = 'outbox_events'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("carries a tenant policy with both USING and WITH CHECK", async () => {
    const { rows } = await pool.query<{ polname: string; qual: string | null; withcheck: string | null }>(
      `SELECT pol.polname,
              pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
              pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
         FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname = 'outbox_events' AND pol.polname = 'tenant_isolation'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain("current_tenant()");
    expect(rows[0].withcheck).toContain("current_tenant()");
  });

  it("has the relay's partial index and a tenant-leading index", async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'context' AND tablename = 'outbox_events' ORDER BY indexname`,
    );
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("outbox_events_unpublished_idx")).toContain("WHERE (published_at IS NULL)");
    expect(byName.get("outbox_events_org_created_idx")).toContain("(org_id, created_at)");
  });

  it("rejects a topic outside the published vocabulary", async () => {
    const orgId = await pool
      .query<{ id: string }>(`INSERT INTO public.orgs (name, kind) VALUES ('topic-check', 'external') RETURNING id`)
      .then((r) => r.rows[0].id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT public.set_tenant($1)", [orgId]);
      await expect(
        client.query(
          `INSERT INTO context.outbox_events (org_id, topic, payload, ordering_key)
           VALUES ($1, 'enquiry.invented', '{}'::jsonb, $1::text)`,
          [orgId],
        ),
      ).rejects.toThrow(/outbox_events_topic_check/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Step 3: Write `test-support.ts`**

Create `ads-agent/lib/db/test-support.ts`:

```ts
import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * The pool every *.db.test.ts uses. Throws rather than skipping when
 * TEST_DATABASE_URL is unset: the S5a gate is a transaction-atomicity property,
 * and a gate that can silently not run is not a gate.
 */
export function testPool(): Pool {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Database tests need a live PostgreSQL 18:\n" +
        "  docker compose -f ../docker-compose.listings.yml up -d db\n" +
        "  export TEST_DATABASE_URL=postgres://gentle:gentle@localhost:5433/gentle_space_listings",
    );
  }
  if (!pool) {
    // max: 1 so a test can assert what the *next* request on the same physical
    // connection sees — the pooled-connection tenant leak is invisible otherwise.
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  }
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function seedOrg(pool: Pool, name: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, kind) VALUES ($1, 'external') RETURNING id`,
    [`${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  return rows[0].id;
}

export async function resetOutbox(pool: Pool, orgId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [orgId]);
    await client.query(`DELETE FROM context.outbox_events WHERE org_id = $1`, [orgId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd ads-agent
export TEST_DATABASE_URL=postgres://gentle:gentle@localhost:5433/gentle_space_listings
npx vitest run --config vitest.db.config.ts lib/db/outbox-schema.db.test.ts
```

Expected: FAIL — the first test reports `expected [] to deeply equal [ { column_name: 'attempts', … } ]` because `context.outbox_events` does not exist yet.

- [ ] **Step 5: Write migration 040**

Create `ads-agent/lib/db/migrations/040_outbox_events.up.sql`:

```sql
-- S5a: the transactional outbox. Data model §5a, datastore spec §14.1.
-- Every object schema-qualified: search_path leads with ag_catalog, so an
-- unqualified CREATE TABLE lands inside the AGE extension's schema.
BEGIN;

CREATE TABLE context.outbox_events (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),   -- also the consumer idempotency key
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),

  topic         TEXT NOT NULL CONSTRAINT outbox_events_topic_check CHECK (topic IN (
                  'enquiry.received','enquiry.activity_logged','graph.tenant_stale',
                  'agent.task_requested','reminder.due','deletion.requested',
                  'portal.event')),
  payload       JSONB NOT NULL,
  ordering_key  TEXT NOT NULL,          -- org_id::text; per-tenant ordering, never global

  published_at  TIMESTAMPTZ,            -- NULL = awaiting the relay
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The relay's only query. Partial index stays small no matter how much history
-- accumulates. Deliberate exception to "every index leads with org_id": the
-- relay is cross-tenant by design and an org_id-leading index cannot serve
-- "oldest unpublished across all tenants".
CREATE INDEX outbox_events_unpublished_idx
  ON context.outbox_events (created_at)
  WHERE published_at IS NULL;

-- Tenant-scoped reads (a broker inspecting their own event history, the
-- retention prune, the health view per org) get the org-leading index.
CREATE INDEX outbox_events_org_created_idx
  ON context.outbox_events (org_id, created_at);

ALTER TABLE context.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.outbox_events FORCE  ROW LEVEL SECURITY;

-- WITH CHECK as well as USING: USING alone lets a tenant write rows carrying
-- another tenant's org_id.
CREATE POLICY tenant_isolation ON context.outbox_events
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

GRANT USAGE ON SCHEMA context TO adsagent_rw, listings_rw, context_rw, shared_rw;
GRANT SELECT, INSERT ON context.outbox_events
  TO adsagent_rw, listings_rw, context_rw, shared_rw;

COMMIT;
```

Create `ads-agent/lib/db/migrations/040_outbox_events.down.sql`:

```sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON context.outbox_events;
DROP INDEX IF EXISTS context.outbox_events_org_created_idx;
DROP INDEX IF EXISTS context.outbox_events_unpublished_idx;
DROP TABLE IF EXISTS context.outbox_events;
COMMIT;
```

- [ ] **Step 6: Apply the migration and run the test to verify it passes**

```bash
cd ads-agent
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/040_outbox_events.up.sql
```

Expected: `BEGIN`, `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX`, `ALTER TABLE`, `ALTER TABLE`, `CREATE POLICY`, `GRANT`, `GRANT`, `COMMIT`.

```bash
npx vitest run --config vitest.db.config.ts lib/db/outbox-schema.db.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Verify the down migration reverses cleanly, then re-apply**

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/040_outbox_events.down.sql
psql "$TEST_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='context' AND table_name='outbox_events'"
```

Expected: `0`.

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/040_outbox_events.up.sql
npx vitest run --config vitest.db.config.ts lib/db/outbox-schema.db.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 8: Verify the default test run is unaffected, then commit**

```bash
cd ads-agent && npx vitest run
```

Expected: PASS, with no `*.db.test.ts` file listed in the output.

```bash
git add ads-agent/lib/db/migrations/040_outbox_events.up.sql \
        ads-agent/lib/db/migrations/040_outbox_events.down.sql \
        ads-agent/lib/db/test-support.ts \
        ads-agent/lib/db/outbox-schema.db.test.ts \
        ads-agent/vitest.db.config.ts ads-agent/vitest.config.ts ads-agent/package.json
git commit -m "feat(outbox): add context.outbox_events with forced RLS

The transactional outbox from data model §5a. Publishing to Pub/Sub from a
request handler is a dual-write: the row commits and the publish fails, or the
publish succeeds and the transaction rolls back. The event now lives in the
same transaction as the domain change."
```

---

# Wave 2

## Task 2: `withTenantTransaction` — one transaction for the write and its event

**Files:**
- Create: `ads-agent/lib/db/tx.ts`
- Create: `ads-agent/lib/db/tx.db.test.ts`

**Interfaces:**
- Consumes: `type Scope` from `ads-agent/lib/db/scope-sql.ts` (S1–S3), shaped `{ kind: "platform" | "org"; orgId: string }`; `getPool()` from `ads-agent/lib/db/client.ts`; `testPool`, `seedOrg`, `closeTestPool` from `ads-agent/lib/db/test-support.ts` (Task 1).
- Produces: `withTenantTransaction<T>(scope: Scope, fn: (client: PoolClient) => Promise<T>, pool?: Pool): Promise<T>`. Tasks 3, 9, 11 and 12 call it. The optional third parameter is how Task 9 runs the reconciler against the relay pool without duplicating this logic.

**Note before you start:** run `ls ads-agent/lib/db/tx.ts`. If S4/S5 already created it, do not overwrite — add the missing `pool` parameter and the missing tests to the existing file, keeping its exported name `withTenantTransaction`.

**Skills:** `senior-backend`, `tdd-guide`
**Model:** `inherit` — transaction atomicity is not transcription. The rollback path, the platform-scope branch that deliberately does *not* set a tenant, and the pooled-connection leak assertion all need someone who understands why `set_config`'s third argument is the whole point. Also the one task that may find an existing file and must extend rather than overwrite it.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/db/tx.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestPool, seedOrg, testPool } from "./test-support";
import { withTenantTransaction } from "./tx";

const pool = testPool();
let orgId: string;

beforeAll(async () => {
  orgId = await seedOrg(pool, "tx-test");
});

afterAll(async () => {
  await closeTestPool();
});

describe("withTenantTransaction", () => {
  it("sets the tenant for the duration of the callback", async () => {
    const seen = await withTenantTransaction({ kind: "org", orgId }, async (client) => {
      const { rows } = await client.query<{ tenant: string | null }>("SELECT public.current_tenant() AS tenant");
      return rows[0].tenant;
    });
    expect(seen).toBe(orgId);
  });

  it("does not leak the tenant onto the pooled connection after commit", async () => {
    await withTenantTransaction({ kind: "org", orgId }, async (client) => {
      await client.query("SELECT 1");
    });
    // Same physical connection: the pool has max 1.
    const { rows } = await pool.query<{ tenant: string | null }>("SELECT public.current_tenant() AS tenant");
    expect(rows[0].tenant).toBeNull();
  });

  it("rolls back every statement when the callback throws", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId }, async (client) => {
        await client.query(
          `INSERT INTO context.outbox_events (org_id, topic, payload, ordering_key)
           VALUES ($1, 'graph.tenant_stale', '{"probe":true}'::jsonb, $1::text)`,
          [orgId],
        );
        throw new Error("caller failed after writing");
      }),
    ).rejects.toThrow("caller failed after writing");

    const rows = await withTenantTransaction({ kind: "org", orgId }, async (client) => {
      const result = await client.query(`SELECT id FROM context.outbox_events WHERE org_id = $1`, [orgId]);
      return result.rows;
    });
    expect(rows).toEqual([]);
  });

  it("leaves the tenant unset under platform scope so cross-tenant reads work", async () => {
    const seen = await withTenantTransaction({ kind: "platform", orgId }, async (client) => {
      const { rows } = await client.query<{ tenant: string | null }>("SELECT public.current_tenant() AS tenant");
      return rows[0].tenant;
    });
    expect(seen).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/db/tx.db.test.ts
```

Expected: FAIL — `Failed to resolve import "./tx"`.

- [ ] **Step 3: Write the minimal implementation**

Create `ads-agent/lib/db/tx.ts`:

```ts
import type { Pool, PoolClient } from "pg";
import { getPool } from "./client";
import type { Scope } from "./scope-sql";

/**
 * The only way a domain write and its outbox event share a transaction.
 *
 * Org scope calls public.set_tenant, which uses set_config(..., true) —
 * transaction-scoped. Platform scope deliberately leaves the tenant unset,
 * mirroring scopeClause yielding TRUE: a cross-tenant reader that set a tenant
 * would be restricted to it by RLS.
 *
 * The optional pool lets the relay and the deletion reconciler run against
 * OUTBOX_RELAY_DATABASE_URL without duplicating this transaction discipline.
 */
export async function withTenantTransaction<T>(
  scope: Scope,
  fn: (client: PoolClient) => Promise<T>,
  pool: Pool = getPool(),
): Promise<T> {
  const client = await pool.connect();
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

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/db/tx.db.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/tx.ts ads-agent/lib/db/tx.db.test.ts
git commit -m "feat(db): add withTenantTransaction

set_config's third argument is transaction-scoped, so the tenant must be set
inside the transaction that carries the write. The pooled-connection test
asserts the next request on the same physical connection sees NULL."
```

## Task 4: The event vocabulary and the wire envelope

**Files:**
- Create: `ads-agent/lib/events/topics.ts`
- Create: `ads-agent/lib/events/envelope.ts`
- Create: `ads-agent/lib/events/envelope.test.ts`
- Create: `ads-agent/lib/events/topics.db.test.ts`

**Interfaces:**
- Consumes: `context.outbox_events` and its `outbox_events_topic_check` constraint (Task 1); `testPool`, `closeTestPool` (Task 1).
- Produces: `OUTBOX_TOPICS` (a `readonly` tuple), `type OutboxTopic`, `DELETION_TOPIC`, `isOutboxTopic(value: string): value is OutboxTopic` from `topics.ts`; `type OutboxRow`, `type EventEnvelope`, `type PublishableMessage`, `ENVELOPE_SCHEMA_VERSION`, `buildEnvelope(row: OutboxRow): EventEnvelope`, `toPublishableMessage(row: OutboxRow): PublishableMessage` from `envelope.ts`. Tasks 3, 5, 7, 8, 9, 11 all import from these two files.

**Skills:** `typescript-pro`, `tdd-guide`
**Model:** `composer-2.5-fast` — two small pure modules and every test case are written out below, and the parity test's regex is given literally.

- [ ] **Step 1: Write the failing envelope test**

Create `ads-agent/lib/events/envelope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ENVELOPE_SCHEMA_VERSION, buildEnvelope, toPublishableMessage, type OutboxRow } from "./envelope";
import { DELETION_TOPIC, OUTBOX_TOPICS, isOutboxTopic } from "./topics";

const row: OutboxRow = {
  id: "018f3c1a-0000-7000-8000-000000000001",
  orgId: "018f3c1a-0000-7000-8000-0000000000aa",
  topic: "enquiry.received",
  payload: { enquiryId: "e-1", source: "form" },
  orderingKey: "018f3c1a-0000-7000-8000-0000000000aa",
  attempts: 0,
  createdAt: "2026-08-12T04:05:06.000Z",
};

describe("topics", () => {
  it("publishes exactly the seven topics from datastore §14.2", () => {
    expect([...OUTBOX_TOPICS]).toEqual([
      "enquiry.received",
      "enquiry.activity_logged",
      "graph.tenant_stale",
      "agent.task_requested",
      "reminder.due",
      "deletion.requested",
      "portal.event",
    ]);
  });

  it("names the deletion topic, the one class where a drop is a compliance breach", () => {
    expect(DELETION_TOPIC).toBe("deletion.requested");
  });

  it("narrows unknown strings", () => {
    expect(isOutboxTopic("enquiry.received")).toBe(true);
    expect(isOutboxTopic("enquiry.invented")).toBe(false);
  });
});

describe("buildEnvelope", () => {
  it("carries the outbox id as the consumer idempotency key", () => {
    expect(buildEnvelope(row)).toEqual({
      eventId: row.id,
      orgId: row.orgId,
      topic: "enquiry.received",
      occurredAt: "2026-08-12T04:05:06.000Z",
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      payload: { enquiryId: "e-1", source: "form" },
    });
  });
});

describe("toPublishableMessage", () => {
  it("orders by org, never globally, and repeats the ids as attributes", () => {
    const message = toPublishableMessage(row);
    expect(message.topic).toBe("enquiry.received");
    expect(message.orderingKey).toBe(row.orgId);
    expect(message.attributes).toEqual({
      eventId: row.id,
      orgId: row.orgId,
      topic: "enquiry.received",
      schemaVersion: "1",
    });
    expect(JSON.parse(message.data.toString("utf8"))).toEqual(buildEnvelope(row));
  });
});
```

- [ ] **Step 2: Write the failing parity test**

Create `ads-agent/lib/events/topics.db.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, testPool } from "../db/test-support";
import { OUTBOX_TOPICS } from "./topics";

const pool = testPool();

afterAll(async () => {
  await closeTestPool();
});

describe("topic vocabulary", () => {
  // Two lists of topics is one list too many. If someone adds a topic to the
  // CHECK constraint without adding it to OUTBOX_TOPICS, the relay silently
  // cannot publish it; the reverse fails at insert time in production.
  it("matches context.outbox_events.topic's CHECK constraint exactly", async () => {
    const { rows } = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'outbox_events_topic_check'
          AND conrelid = 'context.outbox_events'::regclass`,
    );
    expect(rows).toHaveLength(1);
    const inConstraint = [...rows[0].definition.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]);
    expect([...inConstraint].sort()).toEqual([...OUTBOX_TOPICS].sort());
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
cd ads-agent
npx vitest run lib/events/envelope.test.ts
npx vitest run --config vitest.db.config.ts lib/events/topics.db.test.ts
```

Expected: both FAIL with `Failed to resolve import "./topics"` / `"./envelope"`.

- [ ] **Step 4: Write `topics.ts`**

Create `ads-agent/lib/events/topics.ts`:

```ts
/**
 * The event vocabulary — datastore spec §14.2.
 *
 * This list and the outbox_events_topic_check constraint are the same list;
 * topics.db.test.ts asserts that against the live catalogue.
 *
 * These strings are used verbatim as Pub/Sub topic ids. Pub/Sub permits periods
 * in resource ids, so there is deliberately no name-mapping layer to drift.
 */
export const OUTBOX_TOPICS = [
  "enquiry.received",
  "enquiry.activity_logged",
  "graph.tenant_stale",
  "agent.task_requested",
  "reminder.due",
  "deletion.requested",
  "portal.event",
] as const;

export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];

/**
 * §14.4: a lost deletion.requested message is a failed erasure obligation under
 * DPDP and GDPR — a compliance failure, not a retry. It gets its own alert and
 * its own reconciler.
 */
export const DELETION_TOPIC: OutboxTopic = "deletion.requested";

export function isOutboxTopic(value: string): value is OutboxTopic {
  return (OUTBOX_TOPICS as readonly string[]).includes(value);
}
```

- [ ] **Step 5: Write `envelope.ts`**

Create `ads-agent/lib/events/envelope.ts`:

```ts
import type { OutboxTopic } from "./topics";

export const ENVELOPE_SCHEMA_VERSION = 1;

/** One row of context.outbox_events, in application shape. */
export type OutboxRow = {
  id: string;
  orgId: string;
  topic: OutboxTopic;
  payload: Record<string, unknown>;
  orderingKey: string;
  attempts: number;
  createdAt: string;
};

export type EventEnvelope = {
  eventId: string;
  orgId: string;
  topic: OutboxTopic;
  occurredAt: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
};

export type PublishableMessage = {
  topic: OutboxTopic;
  data: Buffer;
  orderingKey: string;
  attributes: Record<string, string>;
};

export function buildEnvelope(row: OutboxRow): EventEnvelope {
  return {
    eventId: row.id,
    orgId: row.orgId,
    topic: row.topic,
    occurredAt: row.createdAt,
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    payload: row.payload,
  };
}

export function toPublishableMessage(row: OutboxRow): PublishableMessage {
  const envelope = buildEnvelope(row);
  return {
    topic: row.topic,
    data: Buffer.from(JSON.stringify(envelope), "utf8"),
    // §14.3: per-tenant ordering is what matters; global ordering would
    // serialise every tenant behind every other.
    orderingKey: row.orderingKey,
    // Repeated as attributes so a consumer can de-duplicate without parsing
    // the body, and so a dead-lettered message is still attributable.
    attributes: {
      eventId: envelope.eventId,
      orgId: envelope.orgId,
      topic: envelope.topic,
      schemaVersion: String(envelope.schemaVersion),
    },
  };
}
```

- [ ] **Step 6: Run both tests to verify they pass**

```bash
cd ads-agent
npx vitest run lib/events/envelope.test.ts
npx vitest run --config vitest.db.config.ts lib/events/topics.db.test.ts
```

Expected: PASS, 6 tests then 1 test.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/events/topics.ts ads-agent/lib/events/envelope.ts \
        ads-agent/lib/events/envelope.test.ts ads-agent/lib/events/topics.db.test.ts
git commit -m "feat(events): add the topic vocabulary and wire envelope

Topic ids are used verbatim as Pub/Sub topic ids, and a database test asserts
the TypeScript union equals the CHECK constraint, so the two lists cannot
drift apart."
```

---

# Wave 3

## Task 3: The outbox data layer

**Files:**
- Create: `ads-agent/lib/db/outbox.ts`
- Create: `ads-agent/lib/db/outbox.db.test.ts`

**Interfaces:**
- Consumes: `type Scope` from `./scope-sql`; `withTenantTransaction` from `./tx` (Task 2); `type OutboxRow` from `../events/envelope` and `type OutboxTopic` from `../events/topics` (Task 4); `testPool`, `seedOrg`, `resetOutbox`, `closeTestPool` (Task 1).
- Produces:
  - `type OutboxEventInput = { topic: OutboxTopic; payload: Record<string, unknown> }`
  - `enqueueEvent(scope: Scope, client: PoolClient, event: OutboxEventInput): Promise<string>` — returns the event id, throws on platform scope
  - `claimUnpublished(scope: Scope, client: PoolClient, limit: number): Promise<OutboxRow[]>` — throws on org scope
  - `markPublished(scope: Scope, client: PoolClient, ids: string[]): Promise<void>`
  - `markFailed(scope: Scope, client: PoolClient, id: string, error: string): Promise<void>`
  - `listEventsForOrg(scope: Scope, client: PoolClient): Promise<OutboxRow[]>` — tenant-scoped read used by Tasks 9 and 12
  - Tasks 7, 9, 11 and 12 call these.

**Skills:** `senior-backend`, `sql-pro`
**Model:** `inherit` — `FOR UPDATE SKIP LOCKED` under a test pool of `max: 1` alongside a second relay pool is exactly the kind of lock interaction that produces a confusing failure with a correct implementation. The implementer needs to reason about which connection holds what, not just paste the SQL.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/db/outbox.db.test.ts`:

```ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimUnpublished, enqueueEvent, listEventsForOrg, markFailed, markPublished } from "./outbox";
import { closeTestPool, resetOutbox, seedOrg, testPool } from "./test-support";
import { withTenantTransaction } from "./tx";

const pool = testPool();
let orgA: string;
let orgB: string;

let relay: Pool | null = null;

// Task 7 introduces lib/events/relay-pool.ts for this. Until then the platform-
// scoped assertions below use their own pool: what they test is the SQL, not
// role privileges, and OUTBOX_RELAY_DATABASE_URL is honoured when it is set.
function relayPool(): Pool {
  relay ??= new Pool({
    connectionString: process.env.OUTBOX_RELAY_DATABASE_URL ?? process.env.TEST_DATABASE_URL,
    max: 1,
  });
  return relay;
}

beforeEach(async () => {
  orgA ??= await seedOrg(pool, "outbox-a");
  orgB ??= await seedOrg(pool, "outbox-b");
  await resetOutbox(pool, orgA);
  await resetOutbox(pool, orgB);
});

afterAll(async () => {
  if (relay) await relay.end();
  await closeTestPool();
});

describe("enqueueEvent", () => {
  it("writes a row whose ordering key is the org id", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, {
        topic: "enquiry.received",
        payload: { enquiryId: "e-1" },
      }),
    );

    const rows = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      listEventsForOrg({ kind: "org", orgId: orgA }, client),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].orderingKey).toBe(orgA);
    expect(rows[0].topic).toBe("enquiry.received");
    expect(rows[0].payload).toEqual({ enquiryId: "e-1" });
    expect(rows[0].attempts).toBe(0);
  });

  it("refuses platform scope, because every event belongs to a tenant", async () => {
    await expect(
      withTenantTransaction({ kind: "platform", orgId: orgA }, (client) =>
        enqueueEvent({ kind: "platform", orgId: orgA }, client, {
          topic: "enquiry.received",
          payload: {},
        }),
      ),
    ).rejects.toThrow("enqueueEvent requires org scope");
  });
});

describe("claimUnpublished", () => {
  it("returns every tenant's unpublished rows oldest first under platform scope", async () => {
    await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, { topic: "reminder.due", payload: { n: 1 } }),
    );
    await withTenantTransaction({ kind: "org", orgId: orgB }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgB }, client, { topic: "reminder.due", payload: { n: 2 } }),
    );

    const claimed = await withTenantTransaction(
      { kind: "platform", orgId: orgA },
      (client) => claimUnpublished({ kind: "platform", orgId: orgA }, client, 10),
      relayPool(),
    );
    const orgs = claimed.map((row) => row.orgId);
    expect(orgs).toContain(orgA);
    expect(orgs).toContain(orgB);
    expect(claimed.map((row) => row.payload.n)).toEqual([1, 2]);
  });

  it("refuses org scope, because the relay publishes every tenant's events", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
        claimUnpublished({ kind: "org", orgId: orgA }, client, 10),
      ),
    ).rejects.toThrow("claimUnpublished is platform-scoped");
  });
});

describe("markPublished / markFailed", () => {
  it("stamps published_at and increments attempts with the error text", async () => {
    const published = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, { topic: "graph.tenant_stale", payload: {} }),
    );
    const failed = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, { topic: "graph.tenant_stale", payload: {} }),
    );

    await withTenantTransaction(
      { kind: "platform", orgId: orgA },
      async (client) => {
        await markPublished({ kind: "platform", orgId: orgA }, client, [published]);
        await markFailed({ kind: "platform", orgId: orgA }, client, failed, "UNAVAILABLE: transport closed");
      },
      relayPool(),
    );

    const remaining = await withTenantTransaction(
      { kind: "platform", orgId: orgA },
      (client) => claimUnpublished({ kind: "platform", orgId: orgA }, client, 10),
      relayPool(),
    );
    expect(remaining.map((row) => row.id)).toEqual([failed]);
    expect(remaining[0].attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/db/outbox.db.test.ts
```

Expected: FAIL — `Failed to resolve import "./outbox"`.

- [ ] **Step 3: Write the minimal implementation**

Create `ads-agent/lib/db/outbox.ts`:

```ts
import type { PoolClient } from "pg";
import type { OutboxRow } from "../events/envelope";
import type { OutboxTopic } from "../events/topics";
import type { Scope } from "./scope-sql";

export type OutboxEventInput = {
  topic: OutboxTopic;
  payload: Record<string, unknown>;
};

type OutboxDbRow = {
  id: string;
  org_id: string;
  topic: OutboxTopic;
  payload: Record<string, unknown>;
  ordering_key: string;
  attempts: number;
  created_at: Date;
};

function toOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    orgId: row.org_id,
    topic: row.topic,
    payload: row.payload,
    orderingKey: row.ordering_key,
    attempts: row.attempts,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = "id, org_id, topic, payload, ordering_key, attempts, created_at";

/**
 * The only way to publish. The caller supplies the client so the event lands in
 * the same transaction as the domain change — that is the whole point of the
 * outbox (datastore spec §14.1).
 */
export async function enqueueEvent(
  scope: Scope,
  client: PoolClient,
  event: OutboxEventInput,
): Promise<string> {
  if (scope.kind !== "org") {
    throw new Error("enqueueEvent requires org scope: every event belongs to exactly one tenant");
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO context.outbox_events (org_id, topic, payload, ordering_key)
     VALUES ($1, $2, $3::jsonb, $1::text)
     RETURNING id`,
    [scope.orgId, event.topic, JSON.stringify(event.payload)],
  );
  return rows[0].id;
}

/**
 * The relay's claim. FOR UPDATE SKIP LOCKED so two relay instances never
 * publish the same row, and ORDER BY created_at so a uuidv7 primary key keeps
 * these reads sequential rather than scattered.
 */
export async function claimUnpublished(
  scope: Scope,
  client: PoolClient,
  limit: number,
): Promise<OutboxRow[]> {
  if (scope.kind !== "platform") {
    throw new Error("claimUnpublished is platform-scoped: the relay publishes every tenant's events");
  }
  const { rows } = await client.query<OutboxDbRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM context.outbox_events
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map(toOutboxRow);
}

export async function markPublished(scope: Scope, client: PoolClient, ids: string[]): Promise<void> {
  if (scope.kind !== "platform") {
    throw new Error("markPublished is platform-scoped: only the relay marks rows published");
  }
  if (ids.length === 0) return;
  await client.query(
    `UPDATE context.outbox_events SET published_at = now() WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

export async function markFailed(
  scope: Scope,
  client: PoolClient,
  id: string,
  error: string,
): Promise<void> {
  if (scope.kind !== "platform") {
    throw new Error("markFailed is platform-scoped: only the relay records publish failures");
  }
  await client.query(
    `UPDATE context.outbox_events
        SET attempts = attempts + 1, last_error = $2
      WHERE id = $1`,
    [id, error.slice(0, 2000)],
  );
}

/** Tenant-scoped read. RLS makes the WHERE clause a belt to the policy's braces. */
export async function listEventsForOrg(scope: Scope, client: PoolClient): Promise<OutboxRow[]> {
  if (scope.kind !== "org") {
    throw new Error("listEventsForOrg requires org scope");
  }
  const { rows } = await client.query<OutboxDbRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM context.outbox_events
      WHERE org_id = $1
      ORDER BY created_at`,
    [scope.orgId],
  );
  return rows.map(toOutboxRow);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/db/outbox.db.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/outbox.ts ads-agent/lib/db/outbox.db.test.ts
git commit -m "feat(outbox): add the outbox data layer

enqueueEvent takes the caller's client so the event commits with the domain
change. claimUnpublished refuses org scope and enqueueEvent refuses platform
scope, so the relay/writer asymmetry is a runtime error rather than a comment."
```

## Task 5: The Pub/Sub boundary and the local emulator

**Files:**
- Create: `ads-agent/lib/events/publisher.ts`
- Create: `ads-agent/lib/events/publisher.emulator.db.test.ts`
- Create: `ads-agent/scripts/bootstrap-pubsub-emulator.ts`
- Modify: `ads-agent/package.json`
- Modify: `docker-compose.listings.yml`

**Interfaces:**
- Consumes: `type OutboxTopic`, `OUTBOX_TOPICS` from `./topics`; `type PublishableMessage` from `./envelope` (Task 4).
- Produces: `type Publisher = { publish(message: PublishableMessage): Promise<string>; resume(topic: OutboxTopic, orderingKey: string): void; close(): Promise<void> }` and `createPublisher(): Publisher`. Task 7's relay takes a `Publisher` as an injected dependency; Task 12's gate injects a fake one. **This is the only file in the repository permitted to import `@google-cloud/pubsub`**, and Task 11's test enforces that.

**Skills:** `platform-engineer`, `docker-expert`, `typescript-pro`
**Model:** `inherit` — Step 1 is a STOP that asks a human for a dependency decision, and no mechanical agent should decide how to proceed if the answer is no. The emulator's gaps (no dead-letter topics, no filters) also mean the implementer must know which behaviours cannot be verified locally rather than assuming a green test covers them.

- [ ] **Step 1: Ask before adding the dependency — STOP here**

This task needs one new dependency, and the Global Constraints forbid adding one without asking. Post exactly this to the user and wait for a yes:

> S5a needs `@google-cloud/pubsub` (the official Google Cloud client) as a dependency of `ads-agent`. It is the only new dependency in the plan.
>
> The alternative is calling the Pub/Sub REST API with a hand-rolled OAuth token, which would (a) still need a Google auth library, (b) lose the client's ordering-key sequencing and batching, and (c) lose `PUBSUB_EMULATOR_HOST` support — the emulator is only addressed automatically by the official client, so local tests would need cloud credentials.
>
> Approve `npm install @google-cloud/pubsub` in `ads-agent/`?

If the answer is no, STOP and escalate: the rest of the plan's publish path has no implementation without a Pub/Sub client, and choosing the REST path is a design decision, not an implementer's call.

- [ ] **Step 2: Install the dependency and add the emulator service**

```bash
cd ads-agent && npm install @google-cloud/pubsub
```

Expected: `added N packages`, and `@google-cloud/pubsub` appears under `dependencies` in `ads-agent/package.json`.

Add to `docker-compose.listings.yml` under `services:`:

```yaml
  # Local Pub/Sub. The official client addresses this automatically when
  # PUBSUB_EMULATOR_HOST is set, so no test needs cloud credentials.
  # Caveat: the emulator implements neither dead-letter topics nor subscription
  # filters, so DLQ behaviour is verified against a real project (Task 6), not here.
  pubsub-emulator:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:latest
    container_name: gentle-space-pubsub
    command:
      - gcloud
      - beta
      - emulators
      - pubsub
      - start
      - --project=gentle-space-local
      - --host-port=0.0.0.0:8085
    ports:
      - "8085:8085"
```

Add to `ads-agent/package.json` `scripts`:

```json
    "pubsub:bootstrap": "tsx --env-file=.env.local scripts/bootstrap-pubsub-emulator.ts",
```

- [ ] **Step 3: Write the failing test**

Create `ads-agent/lib/events/publisher.emulator.db.test.ts`:

```ts
import { PubSub } from "@google-cloud/pubsub";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toPublishableMessage, type OutboxRow } from "./envelope";
import { createPublisher, type Publisher } from "./publisher";

// The emulator, not the cloud. docker compose -f ../docker-compose.listings.yml up -d pubsub-emulator
const PROJECT = "gentle-space-local";
const TOPIC = "enquiry.received";
const SUBSCRIPTION = "test-publisher-roundtrip";

let publisher: Publisher;
let admin: PubSub;

beforeAll(async () => {
  if (!process.env.PUBSUB_EMULATOR_HOST) {
    throw new Error(
      "PUBSUB_EMULATOR_HOST is not set. Start the emulator and export it:\n" +
        "  docker compose -f ../docker-compose.listings.yml up -d pubsub-emulator\n" +
        "  export PUBSUB_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=gentle-space-local",
    );
  }
  admin = new PubSub({ projectId: PROJECT });
  const [exists] = await admin.topic(TOPIC).exists();
  if (!exists) await admin.createTopic(TOPIC);
  const [subExists] = await admin.subscription(SUBSCRIPTION).exists();
  if (!subExists) {
    await admin.topic(TOPIC).createSubscription(SUBSCRIPTION, { enableMessageOrdering: true });
  }
  publisher = createPublisher();
});

afterAll(async () => {
  await publisher.close();
  await admin.subscription(SUBSCRIPTION).delete().catch(() => undefined);
  await admin.close();
});

function rowFor(orgId: string, n: number): OutboxRow {
  return {
    id: `018f3c1a-0000-7000-8000-00000000000${n}`,
    orgId,
    topic: "enquiry.received",
    payload: { n },
    orderingKey: orgId,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
}

describe("createPublisher", () => {
  it("publishes a message that arrives with its idempotency attributes intact", async () => {
    const orgId = "018f3c1a-0000-7000-8000-0000000000a1";
    const row = rowFor(orgId, 1);

    const received: { eventId: string; orgId: string; body: unknown }[] = [];
    const subscription = admin.subscription(SUBSCRIPTION);
    subscription.on("message", (message) => {
      received.push({
        eventId: message.attributes.eventId,
        orgId: message.attributes.orgId,
        body: JSON.parse(message.data.toString("utf8")),
      });
      message.ack();
    });

    await publisher.publish(toPublishableMessage(row));

    await expect
      .poll(() => received.length, { timeout: 10_000, interval: 100 })
      .toBeGreaterThan(0);
    subscription.removeAllListeners("message");
    await subscription.close();

    expect(received[0].eventId).toBe(row.id);
    expect(received[0].orgId).toBe(orgId);
    expect(received[0].body).toMatchObject({ eventId: row.id, topic: "enquiry.received", payload: { n: 1 } });
  });

  it("resumes an ordering key after a failure, so one error does not stop a tenant forever", () => {
    // resumePublishing is a no-op on a healthy key; the assertion is that the
    // boundary exposes it at all. Without it, the first transient publish error
    // permanently pauses that org's ordering key.
    expect(() => publisher.resume("enquiry.received", "018f3c1a-0000-7000-8000-0000000000a1")).not.toThrow();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd /Users/swami/Documents/GentleSpace_Web && docker compose -f docker-compose.listings.yml up -d pubsub-emulator
cd ads-agent
export PUBSUB_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=gentle-space-local
npx vitest run --config vitest.db.config.ts lib/events/publisher.emulator.db.test.ts
```

Expected: FAIL — `Failed to resolve import "./publisher"`.

- [ ] **Step 5: Write `publisher.ts`**

Create `ads-agent/lib/events/publisher.ts`:

```ts
import { PubSub, type Topic } from "@google-cloud/pubsub";
import type { PublishableMessage } from "./envelope";
import type { OutboxTopic } from "./topics";

/**
 * The only module in this repository permitted to import @google-cloud/pubsub.
 * `lib/events/no-direct-publish.test.ts` in the root app fails the build if any
 * other file does.
 *
 * Writers publish by inserting into context.outbox_events inside their own
 * transaction; the relay is the only caller of this module. Datastore §14.1:
 * publish through the database, never directly.
 *
 * PUBSUB_EMULATOR_HOST is honoured by the client automatically, which is why
 * every test here runs without cloud credentials.
 */
export type Publisher = {
  publish(message: PublishableMessage): Promise<string>;
  resume(topic: OutboxTopic, orderingKey: string): void;
  close(): Promise<void>;
};

export function createPublisher(): Publisher {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  }
  const client = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  const topics = new Map<string, Topic>();

  function topicFor(name: OutboxTopic): Topic {
    const existing = topics.get(name);
    if (existing) return existing;
    // messageOrdering must be enabled on the publisher or the client throws
    // when a message carries an orderingKey.
    const topic = client.topic(name, { messageOrdering: true });
    topics.set(name, topic);
    return topic;
  }

  return {
    async publish(message) {
      return topicFor(message.topic).publishMessage({
        data: message.data,
        orderingKey: message.orderingKey,
        attributes: message.attributes,
      });
    },
    // A failed publish permanently pauses that ordering key. Without this call
    // the first transient error stops one tenant's events forever.
    resume(topic, orderingKey) {
      topicFor(topic).resumePublishing(orderingKey);
    },
    async close() {
      topics.clear();
      await client.close();
    },
  };
}
```

- [ ] **Step 6: Write the emulator bootstrap script**

Create `ads-agent/scripts/bootstrap-pubsub-emulator.ts`:

```ts
/**
 * Creates every topic and one subscription per topic in the Pub/Sub emulator,
 * so local development sees the same topology as production. Cloud topology is
 * infra/pubsub/create-topics.sh; this is its emulator twin.
 *
 * Run: npm run pubsub:bootstrap
 */
import { PubSub } from "@google-cloud/pubsub";
import { OUTBOX_TOPICS } from "../lib/events/topics";

async function main(): Promise<void> {
  if (!process.env.PUBSUB_EMULATOR_HOST) {
    throw new Error("PUBSUB_EMULATOR_HOST is not set — refusing to create topics against real Pub/Sub");
  }
  const client = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "gentle-space-local" });
  for (const name of OUTBOX_TOPICS) {
    const topic = client.topic(name);
    const [topicExists] = await topic.exists();
    if (!topicExists) {
      await client.createTopic(name);
      console.log(`created topic ${name}`);
    }
    const subscriptionName = `${name}.local`;
    const [subExists] = await client.subscription(subscriptionName).exists();
    if (!subExists) {
      await topic.createSubscription(subscriptionName, { enableMessageOrdering: true });
      console.log(`created subscription ${subscriptionName}`);
    }
  }
  await client.close();
  console.log(`emulator ready: ${OUTBOX_TOPICS.length} topics`);
}

main().catch((err) => {
  console.error("bootstrap-pubsub-emulator failed", err);
  process.exit(1);
});
```

- [ ] **Step 7: Run the test to verify it passes, and the bootstrap script**

```bash
cd ads-agent
export PUBSUB_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=gentle-space-local
npx vitest run --config vitest.db.config.ts lib/events/publisher.emulator.db.test.ts
```

Expected: PASS, 2 tests.

```bash
npx tsx scripts/bootstrap-pubsub-emulator.ts
```

Expected: seven `created topic …` lines, seven `created subscription …` lines, then `emulator ready: 7 topics`. Running it a second time prints only `emulator ready: 7 topics`.

- [ ] **Step 8: Commit**

```bash
git add ads-agent/lib/events/publisher.ts ads-agent/lib/events/publisher.emulator.db.test.ts \
        ads-agent/scripts/bootstrap-pubsub-emulator.ts ads-agent/package.json \
        ads-agent/package-lock.json docker-compose.listings.yml
git commit -m "feat(events): add the single Pub/Sub publish boundary

One file may import the client, and one test (Task 11) fails if another does.
resume() is exposed because a failed ordered publish pauses that ordering key
until it is resumed — otherwise one transient error stops a tenant forever."
```

## Task 6: The Google Cloud topology

**Files:**
- Create: `infra/pubsub/create-topics.sh`

**Interfaces:**
- Consumes: the seven topic ids from `ads-agent/lib/events/topics.ts` (Task 4) — repeated literally in the script, because a shell script cannot import TypeScript, and verified by Step 5's count assertion.
- Produces: in the target GCP project — seven topics, one dead-letter topic, the subscriptions from §14.2, the two IAM bindings dead-lettering needs, and the `outbox-relay` service account holding `roles/pubsub.publisher` on each topic and nothing wider.

**Skills:** `gcp-cloud-architect`, `senior-devops`
**Model:** `inherit` — this task mutates a real Google Cloud project. The IAM bindings dead-lettering silently needs, the `expirationPolicy: {}` reading, and the resource counts in the verification block all require someone who can tell a benign difference from a broken topology instead of declaring success on exit code 0.

- [ ] **Step 1: Write the script**

Create `infra/pubsub/create-topics.sh`:

```bash
#!/usr/bin/env bash
# S5a event backbone — Google Cloud Pub/Sub topology (datastore spec §14.2–§14.4).
#
# Idempotent: every create tolerates ALREADY_EXISTS. Safe to re-run.
#
#   ./infra/pubsub/create-topics.sh
#   ./infra/pubsub/create-topics.sh --with-gcs-export gs://gentle-space-raw-events
#
# The --with-gcs-export flag creates the §14.6 Cloud Storage export subscription.
# It belongs to S6a (portal ingestion) and needs the bucket to exist first; the
# ClickHouse S3Queue side is not created here.
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT is not set}"
RELAY_SA="outbox-relay@${PROJECT_ID}.iam.gserviceaccount.com"
DLQ_TOPIC="gs-events-dead-letter"
GCS_BUCKET=""

if [[ "${1:-}" == "--with-gcs-export" ]]; then
  GCS_BUCKET="${2:?--with-gcs-export needs a bucket URI, e.g. gs://gentle-space-raw-events}"
fi

TOPICS=(
  enquiry.received
  enquiry.activity_logged
  graph.tenant_stale
  agent.task_requested
  reminder.due
  deletion.requested
  portal.event
)

# One subscription per consumer named in §14.2. deletion.requested gets one per
# store, matching context.deletion_propagations.store's CHECK list (§14.4).
declare -A SUBSCRIPTIONS=(
  [enquiry.received]="local-persist twenty-sync graph-stale agent-wake notify"
  [enquiry.activity_logged]="twenty-notes graph-stale requirement-extraction"
  [graph.tenant_stale]="rebuild-worker"
  [agent.task_requested]="kanban-dispatcher"
  [reminder.due]="notify today-feed"
  [deletion.requested]="postgres clickhouse duckdb-snapshot graph twenty vector-index objectstore langfuse clickhouse-raw"
  [portal.event]="gcs-export"
)

ok_exists() { grep -q "ALREADY_EXISTS\|already exists" <<<"$1" || return 1; }

run_tolerating_exists() {
  local output
  if ! output="$("$@" 2>&1)"; then
    ok_exists "$output" || { echo "$output" >&2; return 1; }
    echo "  exists already"
    return 0
  fi
  echo "$output"
}

echo "== enabling the API =="
gcloud services enable pubsub.googleapis.com --project "$PROJECT_ID"

echo "== dead-letter topic (created first: subscriptions reference it) =="
run_tolerating_exists gcloud pubsub topics create "$DLQ_TOPIC" \
  --project "$PROJECT_ID" --message-retention-duration=7d

echo "== topics =="
for topic in "${TOPICS[@]}"; do
  echo "-- $topic"
  run_tolerating_exists gcloud pubsub topics create "$topic" \
    --project "$PROJECT_ID" --message-retention-duration=7d
done

echo "== relay service account, publisher on each topic and nothing wider =="
run_tolerating_exists gcloud iam service-accounts create outbox-relay \
  --project "$PROJECT_ID" --display-name="S5a outbox relay publisher"
for topic in "${TOPICS[@]}"; do
  gcloud pubsub topics add-iam-policy-binding "$topic" \
    --project "$PROJECT_ID" \
    --member="serviceAccount:${RELAY_SA}" \
    --role="roles/pubsub.publisher" >/dev/null
  echo "  publisher on $topic"
done

echo "== subscriptions =="
for topic in "${TOPICS[@]}"; do
  for consumer in ${SUBSCRIPTIONS[$topic]}; do
    sub="${topic}.${consumer}"
    echo "-- $sub"
    # expiration-period=never: an unattached subscription is deleted after 31
    # days of inactivity by default, which would silently drop a consumer that
    # has not shipped yet.
    # ack-deadline 60s and max-delivery-attempts 5 are the retry budget before
    # dead-lettering; ordering is enabled because delivery is per-tenant ordered.
    run_tolerating_exists gcloud pubsub subscriptions create "$sub" \
      --project "$PROJECT_ID" \
      --topic="$topic" \
      --ack-deadline=60 \
      --message-retention-duration=7d \
      --expiration-period=never \
      --enable-message-ordering \
      --dead-letter-topic="$DLQ_TOPIC" \
      --max-delivery-attempts=5
  done
done

echo "== IAM that dead-lettering silently needs =="
# Without these two bindings, dead-lettering fails without an error and the
# message is simply redelivered forever. This is the classic Pub/Sub trap.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PUBSUB_SA="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

gcloud pubsub topics add-iam-policy-binding "$DLQ_TOPIC" \
  --project "$PROJECT_ID" --member="$PUBSUB_SA" --role="roles/pubsub.publisher" >/dev/null
echo "  pubsub SA can publish to $DLQ_TOPIC"

for topic in "${TOPICS[@]}"; do
  for consumer in ${SUBSCRIPTIONS[$topic]}; do
    gcloud pubsub subscriptions add-iam-policy-binding "${topic}.${consumer}" \
      --project "$PROJECT_ID" --member="$PUBSUB_SA" --role="roles/pubsub.subscriber" >/dev/null
  done
done
echo "  pubsub SA can subscribe to every subscription"

echo "== dead-letter drain subscription (so dead letters are inspectable) =="
run_tolerating_exists gcloud pubsub subscriptions create "${DLQ_TOPIC}.inspect" \
  --project "$PROJECT_ID" --topic="$DLQ_TOPIC" \
  --ack-deadline=60 --message-retention-duration=7d --expiration-period=never

if [[ -n "$GCS_BUCKET" ]]; then
  echo "== §14.6 Cloud Storage export subscription (S6a) =="
  # Native export type: writes messages to the bucket as they are received,
  # batched by bytes or duration. ClickHouse S3Queue consumes the files; that
  # side is S6/S6a, not this script.
  run_tolerating_exists gcloud pubsub subscriptions create "portal.event.gcs-raw" \
    --project "$PROJECT_ID" \
    --topic="portal.event" \
    --cloud-storage-bucket="${GCS_BUCKET#gs://}" \
    --cloud-storage-file-prefix="raw/" \
    --cloud-storage-file-suffix=".json" \
    --cloud-storage-max-bytes=10MB \
    --cloud-storage-max-duration=60s \
    --expiration-period=never
fi

echo
echo "== verification =="
gcloud pubsub topics list --project "$PROJECT_ID" --format='value(name)' | sort
echo "topics: $(gcloud pubsub topics list --project "$PROJECT_ID" --format='value(name)' | wc -l | tr -d ' ')"
echo "subscriptions: $(gcloud pubsub subscriptions list --project "$PROJECT_ID" --format='value(name)' | wc -l | tr -d ' ')"
```

- [ ] **Step 2: Make it executable and check it with shellcheck's bash mode**

```bash
chmod +x infra/pubsub/create-topics.sh
bash -n infra/pubsub/create-topics.sh
```

Expected: no output (syntax is valid). `bash -n` is used rather than `shellcheck` because shellcheck is not a repository dependency.

- [ ] **Step 3: Dry-run the topic list against the vocabulary**

```bash
diff <(grep -oE "^  [a-z_]+\.[a-z_]+$" infra/pubsub/create-topics.sh | tr -d ' ' | sort) \
     <(grep -oE '"[a-z_]+\.[a-z_]+"' ads-agent/lib/events/topics.ts | tr -d '"' | sort -u)
```

Expected: no output — the script's `TOPICS` array and `OUTBOX_TOPICS` contain the same seven strings.

- [ ] **Step 4: Run it against the project**

```bash
export GOOGLE_CLOUD_PROJECT=propane-galaxy-498403-n8
./infra/pubsub/create-topics.sh
```

Expected, in order: `Operation "operations/…" finished successfully.` from `services enable`; `Created topic [projects/propane-galaxy-498403-n8/topics/gs-events-dead-letter].`; seven more `Created topic […].` lines; `Created service account [outbox-relay].`; seven `  publisher on …` lines; twenty-two `Created subscription […].` lines; `  pubsub SA can publish to gs-events-dead-letter`; `  pubsub SA can subscribe to every subscription`; `Created subscription [projects/…/subscriptions/gs-events-dead-letter.inspect].`; then the verification block ending `topics: 8` and `subscriptions: 23`.

- [ ] **Step 5: Verify idempotency and the dead-letter wiring**

```bash
./infra/pubsub/create-topics.sh | grep -c "exists already"
```

Expected: `31` — every create reports it already exists on the second run, and the exit status is 0.

```bash
gcloud pubsub subscriptions describe enquiry.received.local-persist \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --format="yaml(deadLetterPolicy, enableMessageOrdering, expirationPolicy)"
```

Expected:

```yaml
deadLetterPolicy:
  deadLetterTopic: projects/propane-galaxy-498403-n8/topics/gs-events-dead-letter
  maxDeliveryAttempts: 5
enableMessageOrdering: true
expirationPolicy: {}
```

`expirationPolicy: {}` is how "never expires" is rendered. If it shows a `ttl`, the subscription will be deleted after inactivity — re-run with `--expiration-period=never`.

- [ ] **Step 6: Commit**

```bash
git add infra/pubsub/create-topics.sh
git commit -m "feat(infra): add the Pub/Sub topology script

Seven topics matching the outbox vocabulary character for character, one
subscription per §14.2 consumer, dead-letter topic with the two IAM bindings
dead-lettering silently needs, and a relay service account scoped to publisher
on each topic rather than project-wide."
```

---

# Wave 4

## Task 7: The relay

**Files:**
- Create: `ads-agent/lib/db/migrations/041_outbox_relay_role.up.sql` / `.down.sql`
- Create: `ads-agent/lib/events/relay-pool.ts`
- Create: `ads-agent/lib/events/relay.ts`
- Create: `ads-agent/lib/events/relay.db.test.ts`
- Create: `ads-agent/scripts/run-outbox-relay.ts`
- Modify: `deploy/docker-compose.prod.yml`

**Interfaces:**
- Consumes: `claimUnpublished`, `markPublished`, `markFailed` from `../db/outbox` (Task 3); `withTenantTransaction` from `../db/tx` (Task 2); `toPublishableMessage` from `./envelope` and `DELETION_TOPIC` from `./topics` (Task 4); `type Publisher` from `./publisher` (Task 5).
- Produces: `relayPool(): Pool` and `closeRelayPool(): Promise<void>` from `relay-pool.ts` — Tasks 9 and 10 import these read-only. `type RelayTick = { claimed: number; published: number; failed: number; deferred: number; deletionFailures: string[] }` and `runRelayOnce(deps: RelayDeps): Promise<RelayTick>` where `RelayDeps = { publisher: Publisher; batchSize: number; perOrgCeiling: number }`, from `relay.ts`. Task 12's gate calls `runRelayOnce` with a fake publisher.

**Skills:** `senior-backend`, `postgres-pro`, `sre-engineer`
**Model:** `inherit` — the relay's crash semantics are the plan's central guarantee. Claim, publish and mark must stay inside one transaction, `resume` must be called on every failure path, and the `deferred` rows must be left unpublished rather than dropped. Any of those three can be "simplified" into a lost-event bug that every test still passes.

- [ ] **Step 1: Write migration 041**

Create `ads-agent/lib/db/migrations/041_outbox_relay_role.up.sql`:

```sql
-- S5a: the relay's role. Data model §5a: "the relay connects as its own role
-- and reads across tenants by design, since it is publishing everyone's
-- events. That makes the relay role a deliberate cross-tenant actor and it
-- must write to context.access_log with actor_kind = 'cross_tenant'."
BEGIN;

-- No password here: it is set out of band from the deploy secret
--   ALTER ROLE outbox_relay PASSWORD '…';
-- because this file is in a public repository.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'outbox_relay') THEN
    CREATE ROLE outbox_relay LOGIN NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA context TO outbox_relay;
GRANT SELECT, UPDATE ON context.outbox_events TO outbox_relay;
GRANT INSERT ON context.access_log TO outbox_relay;

-- The one deliberate exception to tenant isolation on this table. Scoped to
-- this role by TO, so no other role inherits it, and carrying WITH CHECK as
-- well as USING because the relay writes published_at.
CREATE POLICY relay_cross_tenant ON context.outbox_events
  FOR ALL TO outbox_relay
  USING      (true)
  WITH CHECK (true);

COMMIT;
```

Create `ads-agent/lib/db/migrations/041_outbox_relay_role.down.sql`:

```sql
BEGIN;
DROP POLICY IF EXISTS relay_cross_tenant ON context.outbox_events;
REVOKE INSERT ON context.access_log FROM outbox_relay;
REVOKE SELECT, UPDATE ON context.outbox_events FROM outbox_relay;
REVOKE USAGE ON SCHEMA context FROM outbox_relay;
-- The role itself is left in place: dropping a role that owns nothing is safe,
-- but a live relay process holding a connection makes DROP ROLE fail, and a
-- failed down migration is worse than a residual role.
COMMIT;
```

- [ ] **Step 2: Write the failing relay test**

Create `ads-agent/lib/events/relay.db.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueEvent, listEventsForOrg } from "../db/outbox";
import { closeTestPool, resetOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import type { PublishableMessage } from "./envelope";
import type { Publisher } from "./publisher";
import { closeRelayPool } from "./relay-pool";
import { runRelayOnce } from "./relay";

const pool = testPool();
let orgA: string;
let orgB: string;

function fakePublisher(behaviour: { failOn?: (m: PublishableMessage) => boolean } = {}) {
  const sent: PublishableMessage[] = [];
  const resumed: string[] = [];
  const publisher: Publisher = {
    async publish(message) {
      if (behaviour.failOn?.(message)) throw new Error("UNAVAILABLE: transport closed");
      sent.push(message);
      return "server-assigned-id";
    },
    resume(_topic, orderingKey) {
      resumed.push(orderingKey);
    },
    async close() {},
  };
  return { publisher, sent, resumed };
}

beforeEach(async () => {
  orgA ??= await seedOrg(pool, "relay-a");
  orgB ??= await seedOrg(pool, "relay-b");
  await resetOutbox(pool, orgA);
  await resetOutbox(pool, orgB);
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

async function enqueue(orgId: string, n: number): Promise<string> {
  return withTenantTransaction({ kind: "org", orgId }, (client) =>
    enqueueEvent({ kind: "org", orgId }, client, { topic: "enquiry.received", payload: { n } }),
  );
}

async function unpublishedIds(orgId: string): Promise<string[]> {
  const rows = await withTenantTransaction({ kind: "org", orgId }, (client) =>
    listEventsForOrg({ kind: "org", orgId }, client),
  );
  return rows.map((row) => row.id);
}

describe("runRelayOnce", () => {
  it("publishes unpublished rows and marks them published", async () => {
    const id = await enqueue(orgA, 1);
    const { publisher, sent } = fakePublisher();

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    expect(tick).toMatchObject({ claimed: 1, published: 1, failed: 0, deferred: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].attributes.eventId).toBe(id);
    expect(sent[0].orderingKey).toBe(orgA);

    const second = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });
    expect(second.claimed).toBe(0);
  });

  it("leaves a row unpublished when the publish fails, and resumes its ordering key", async () => {
    await enqueue(orgA, 1);
    const { publisher, sent, resumed } = fakePublisher({ failOn: () => true });

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    expect(tick).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    expect(sent).toHaveLength(0);
    expect(resumed).toEqual([orgA]);

    const stillThere = await runRelayOnce({ publisher: fakePublisher().publisher, batchSize: 100, perOrgCeiling: 100 });
    expect(stillThere.claimed).toBe(1);
  });

  it("caps how many events one tenant takes from a single tick", async () => {
    await enqueue(orgA, 1);
    await enqueue(orgA, 2);
    await enqueue(orgA, 3);
    await enqueue(orgB, 4);
    const { publisher, sent } = fakePublisher();

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 2 });

    expect(tick).toMatchObject({ claimed: 4, published: 3, deferred: 1 });
    expect(sent.filter((m) => m.orderingKey === orgA)).toHaveLength(2);
    expect(sent.filter((m) => m.orderingKey === orgB)).toHaveLength(1);
    expect(await unpublishedIds(orgA)).toHaveLength(3); // rows persist; only one is unpublished
  });

  it("reports deletion publish failures separately from ordinary ones", async () => {
    await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, {
        topic: "deletion.requested",
        payload: { requestId: "r-1", store: "clickhouse" },
      }),
    );
    const { publisher } = fakePublisher({ failOn: () => true });

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    expect(tick.failed).toBe(1);
    expect(tick.deletionFailures).toHaveLength(1);
  });

  it("writes one cross-tenant access_log row per org per tick", async () => {
    await enqueue(orgA, 1);
    await enqueue(orgB, 2);
    const { publisher } = fakePublisher();

    await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    const { rows } = await pool.query<{ org_id: string; actor_kind: string; actor_ref: string; action: string }>(
      `SELECT org_id, actor_kind, actor_ref, action FROM context.access_log
        WHERE actor_ref = 'outbox-relay' AND org_id = ANY($1::uuid[]) ORDER BY org_id`,
      [[orgA, orgB].sort()],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor_kind === "cross_tenant" && r.action === "outbox.publish")).toBe(true);
  });
});
```

- [ ] **Step 3: Apply migration 041 and run the test to verify it fails**

```bash
cd ads-agent
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/041_outbox_relay_role.up.sql
psql "$TEST_DATABASE_URL" -c "ALTER ROLE outbox_relay PASSWORD 'relay-local'"
export OUTBOX_RELAY_DATABASE_URL="postgres://outbox_relay:relay-local@localhost:5433/gentle_space_listings"
npx vitest run --config vitest.db.config.ts lib/events/relay.db.test.ts
```

Expected: the psql commands print `BEGIN … COMMIT` and `ALTER ROLE`; the test FAILs with `Failed to resolve import "./relay-pool"`.

- [ ] **Step 4: Write `relay-pool.ts`**

Create `ads-agent/lib/events/relay-pool.ts`:

```ts
import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * The relay's own pool, as its own role. Separate from getPool() on purpose:
 * outbox_relay is a deliberate cross-tenant actor (data model §5a) and the
 * application role must never inherit that reach.
 */
export function relayPool(): Pool {
  if (!process.env.OUTBOX_RELAY_DATABASE_URL) {
    throw new Error("OUTBOX_RELAY_DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.OUTBOX_RELAY_DATABASE_URL, max: 2 });
  }
  return pool;
}

export async function closeRelayPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

- [ ] **Step 5: Write `relay.ts`**

Create `ads-agent/lib/events/relay.ts`:

```ts
import type { PoolClient } from "pg";
import { claimUnpublished, markFailed, markPublished } from "../db/outbox";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { toPublishableMessage } from "./envelope";
import type { Publisher } from "./publisher";
import { relayPool } from "./relay-pool";
import { DELETION_TOPIC } from "./topics";

/**
 * Claim, publish, mark — one transaction (datastore spec §14.1).
 *
 * If the process dies after publishing but before COMMIT, the rows stay
 * unpublished and are published again on the next tick. That is at-least-once
 * delivery: duplicates, never loss. It is why every consumer de-duplicates on
 * the outbox event id (lib/events/idempotency.ts) and why the correctness of
 * deletion comes from reconciliation (§14.4), not from delivery.
 *
 * ponytail: publishing while the claim transaction is open holds row locks
 * across network I/O. Bounded by batchSize (default 100, ~1s). Upgrade path if
 * that ceiling is ever reached: add a claimed_at lease column, commit the
 * claim, publish outside the transaction, then mark published in a second one.
 */
export type RelayDeps = {
  publisher: Publisher;
  batchSize: number;
  perOrgCeiling: number;
};

export type RelayTick = {
  claimed: number;
  published: number;
  failed: number;
  deferred: number;
  deletionFailures: string[];
};

const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000000" };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function logRelayAccess(client: PoolClient, orgIds: string[]): Promise<void> {
  for (const orgId of orgIds) {
    await client.query(
      `INSERT INTO context.access_log (org_id, actor_kind, actor_ref, action)
       VALUES ($1, 'cross_tenant', 'outbox-relay', 'outbox.publish')`,
      [orgId],
    );
  }
}

export async function runRelayOnce(deps: RelayDeps): Promise<RelayTick> {
  const { publisher, batchSize, perOrgCeiling } = deps;

  return withTenantTransaction(
    PLATFORM,
    async (client) => {
      const rows = await claimUnpublished(PLATFORM, client, batchSize);
      const takenPerOrg = new Map<string, number>();
      const publishedIds: string[] = [];
      const deletionFailures: string[] = [];
      let failed = 0;
      let deferred = 0;

      for (const row of rows) {
        const taken = takenPerOrg.get(row.orgId) ?? 0;
        if (taken >= perOrgCeiling) {
          // §12.6 applied to the relay: one tenant's burst must not starve the
          // others. The row stays unpublished and is claimed next tick.
          deferred += 1;
          continue;
        }
        takenPerOrg.set(row.orgId, taken + 1);
        try {
          await publisher.publish(toPublishableMessage(row));
          publishedIds.push(row.id);
        } catch (err) {
          failed += 1;
          if (row.topic === DELETION_TOPIC) deletionFailures.push(row.id);
          // Ordered publishing pauses the key on failure until it is resumed.
          publisher.resume(row.topic, row.orderingKey);
          await markFailed(PLATFORM, client, row.id, errorText(err));
        }
      }

      await markPublished(PLATFORM, client, publishedIds);
      await logRelayAccess(client, [...takenPerOrg.keys()]);

      if (deletionFailures.length > 0) {
        // §14.4: a lost deletion event is a compliance failure, not a missed
        // update, so it gets an alert of its own rather than sharing the
        // ordinary publish-failure counter.
        console.error(
          `ALERT outbox.deletion_publish_failed count=${deletionFailures.length} ids=${deletionFailures.join(",")}`,
        );
      }

      return {
        claimed: rows.length,
        published: publishedIds.length,
        failed,
        deferred,
        deletionFailures,
      };
    },
    relayPool(),
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/events/relay.db.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Write the relay entry point and its production service**

Create `ads-agent/scripts/run-outbox-relay.ts`:

```ts
/**
 * The relay — `npm run relay`. Not cron: outbox latency is user-visible, and a
 * minute-granularity clock would add a minute to every enquiry. Cron's job in
 * this system is finding work by time (datastore spec §14.5); this loop's job
 * is transport.
 */
import { createPublisher } from "../lib/events/publisher";
import { closeRelayPool } from "../lib/events/relay-pool";
import { runRelayOnce } from "../lib/events/relay";

const POLL_MS = Number(process.env.OUTBOX_RELAY_POLL_MS ?? 500);
const BATCH_SIZE = Number(process.env.OUTBOX_RELAY_BATCH_SIZE ?? 100);
const PER_ORG_CEILING = Number(process.env.OUTBOX_RELAY_PER_ORG_CEILING ?? 25);
const IDLE_BACKOFF_MS = Number(process.env.OUTBOX_RELAY_IDLE_BACKOFF_MS ?? 2000);

let running = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const publisher = createPublisher();
  console.log(`outbox relay started, poll=${POLL_MS}ms batch=${BATCH_SIZE} perOrg=${PER_ORG_CEILING}`);

  while (running) {
    try {
      const tick = await runRelayOnce({ publisher, batchSize: BATCH_SIZE, perOrgCeiling: PER_ORG_CEILING });
      if (tick.published > 0 || tick.failed > 0) {
        console.log(
          `outbox relay tick claimed=${tick.claimed} published=${tick.published} failed=${tick.failed} deferred=${tick.deferred}`,
        );
      }
      await sleep(tick.claimed === 0 ? IDLE_BACKOFF_MS : POLL_MS);
    } catch (err) {
      console.error("ALERT outbox.relay_tick_failed", err);
      await sleep(IDLE_BACKOFF_MS);
    }
  }

  await publisher.close();
  await closeRelayPool();
  console.log("outbox relay stopped");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`outbox relay received ${signal}, finishing the current tick`);
    running = false;
  });
}

main().catch((err) => {
  console.error("outbox relay failed to start", err);
  process.exit(1);
});
```

Add to `ads-agent/package.json` `scripts`:

```json
    "relay": "tsx --env-file=.env.local scripts/run-outbox-relay.ts",
```

Add to `deploy/docker-compose.prod.yml` under `services:`:

```yaml
  outbox-relay:
    build: ../ads-agent
    command: ["npx", "tsx", "scripts/run-outbox-relay.ts"]
    depends_on:
      ads-db:
        condition: service_healthy
    networks:
      - default
    environment:
      # Its own role, not the application's — the relay reads across tenants.
      OUTBOX_RELAY_DATABASE_URL: ${OUTBOX_RELAY_DATABASE_URL}
      GOOGLE_CLOUD_PROJECT: ${VERTEX_PROJECT_ID:-propane-galaxy-498403-n8}
      GOOGLE_APPLICATION_CREDENTIALS: /secrets/outbox-relay.json
      OUTBOX_RELAY_POLL_MS: ${OUTBOX_RELAY_POLL_MS:-500}
      OUTBOX_RELAY_BATCH_SIZE: ${OUTBOX_RELAY_BATCH_SIZE:-100}
      OUTBOX_RELAY_PER_ORG_CEILING: ${OUTBOX_RELAY_PER_ORG_CEILING:-25}
    volumes:
      - ../deploy/secrets/outbox-relay.json:/secrets/outbox-relay.json:ro
    restart: unless-stopped
```

- [ ] **Step 8: Smoke the entry point against the emulator, then commit**

```bash
cd ads-agent
export PUBSUB_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=gentle-space-local
export OUTBOX_RELAY_DATABASE_URL="postgres://outbox_relay:relay-local@localhost:5433/gentle_space_listings"
timeout 5 npx tsx scripts/run-outbox-relay.ts
```

Expected: `outbox relay started, poll=500ms batch=100 perOrg=25`, then no further output (an empty outbox is silent), then `timeout` exits 124.

```bash
git add ads-agent/lib/db/migrations/041_outbox_relay_role.up.sql \
        ads-agent/lib/db/migrations/041_outbox_relay_role.down.sql \
        ads-agent/lib/events/relay-pool.ts ads-agent/lib/events/relay.ts \
        ads-agent/lib/events/relay.db.test.ts ads-agent/scripts/run-outbox-relay.ts \
        ads-agent/package.json deploy/docker-compose.prod.yml
git commit -m "feat(events): add the outbox relay

Claim with FOR UPDATE SKIP LOCKED, publish, mark published — one transaction,
so a crash yields duplicate delivery rather than a lost event. Connects as
outbox_relay, a deliberate cross-tenant role that audits every tick."
```

## Task 8: Consumer idempotency

**Files:**
- Create: `ads-agent/lib/db/migrations/044_consumed_events.up.sql` / `.down.sql`
- Create: `ads-agent/lib/events/idempotency.ts`
- Create: `ads-agent/lib/events/idempotency.db.test.ts`

**Interfaces:**
- Consumes: `type Scope` from `../db/scope-sql`; `withTenantTransaction` from `../db/tx` (Task 2); `testPool`, `seedOrg`, `closeTestPool` (Task 1).
- Produces: `consumeOnce(scope: Scope, client: PoolClient, consumer: string, eventId: string, handler: (client: PoolClient) => Promise<void>): Promise<{ skipped: boolean }>`. Task 12's gate uses it to prove redelivery is a no-op.

**Skills:** `postgres-pro`, `tdd-guide`
**Model:** `composer-2.5-fast` — migration 044, `consumeOnce` and all four tests are written out below, including the `ON CONFLICT DO NOTHING` shape that carries the whole guarantee.

- [ ] **Step 1: Write migration 044**

Create `ads-agent/lib/db/migrations/044_consumed_events.up.sql`:

```sql
-- S5a: the consumer idempotency guard. Datastore spec §14.3: "Assume
-- at-least-once and make every consumer idempotent, keyed on the outbox event
-- id." Pub/Sub's exactly-once mode is a configuration with caveats; this table
-- keeps working when that configuration is wrong.
BEGIN;

CREATE TABLE context.consumed_events (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id      public.org_ref NOT NULL REFERENCES public.orgs(id),
  consumer    TEXT NOT NULL,
  event_id    UUID NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The actual guarantee. INSERT … ON CONFLICT on this constraint is what makes
  -- a redelivery a no-op; the surrogate id exists to keep the table's shape
  -- consistent with every other table in the model.
  CONSTRAINT consumed_events_once UNIQUE (consumer, event_id)
);

CREATE INDEX consumed_events_org_consumed_idx
  ON context.consumed_events (org_id, consumed_at);

ALTER TABLE context.consumed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.consumed_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.consumed_events
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT, DELETE ON context.consumed_events
  TO adsagent_rw, listings_rw, context_rw, shared_rw;

COMMIT;
```

Create `ads-agent/lib/db/migrations/044_consumed_events.down.sql`:

```sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON context.consumed_events;
DROP INDEX IF EXISTS context.consumed_events_org_consumed_idx;
DROP TABLE IF EXISTS context.consumed_events;
COMMIT;
```

- [ ] **Step 2: Write the failing test**

Create `ads-agent/lib/events/idempotency.db.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestPool, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import { consumeOnce } from "./idempotency";

const pool = testPool();
let orgId: string;
const EVENT = "018f3c1a-0000-7000-8000-0000000000f1";

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "idem");
  await withTenantTransaction({ kind: "org", orgId }, async (client) => {
    await client.query(`DELETE FROM context.consumed_events WHERE org_id = $1`, [orgId]);
  });
});

afterAll(async () => {
  await closeTestPool();
});

describe("consumeOnce", () => {
  it("runs the handler the first time", async () => {
    let calls = 0;
    const result = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      consumeOnce({ kind: "org", orgId }, client, "twenty-sync", EVENT, async () => {
        calls += 1;
      }),
    );
    expect(result).toEqual({ skipped: false });
    expect(calls).toBe(1);
  });

  it("makes a redelivery a no-op", async () => {
    let calls = 0;
    const handler = async () => {
      calls += 1;
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, "twenty-sync", EVENT, handler),
      );
    }
    expect(calls).toBe(1);

    const { rows } = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      client
        .query<{ n: string }>(`SELECT count(*)::text AS n FROM context.consumed_events WHERE event_id = $1`, [EVENT])
        .then((r) => r.rows),
    );
    expect(rows[0].n).toBe("1");
  });

  it("does not record consumption when the handler throws, so the retry still runs", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, "graph-stale", EVENT, async () => {
          throw new Error("consumer blew up");
        }),
      ),
    ).rejects.toThrow("consumer blew up");

    let calls = 0;
    await withTenantTransaction({ kind: "org", orgId }, (client) =>
      consumeOnce({ kind: "org", orgId }, client, "graph-stale", EVENT, async () => {
        calls += 1;
      }),
    );
    expect(calls).toBe(1);
  });

  it("tracks consumers independently, because fan-out means many consumers per event", async () => {
    const seen: string[] = [];
    for (const consumer of ["local-persist", "twenty-sync", "notify"]) {
      await withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, consumer, EVENT, async () => {
          seen.push(consumer);
        }),
      );
    }
    expect(seen).toEqual(["local-persist", "twenty-sync", "notify"]);
  });
});
```

- [ ] **Step 3: Apply the migration and run the test to verify it fails**

```bash
cd ads-agent
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/044_consumed_events.up.sql
npx vitest run --config vitest.db.config.ts lib/events/idempotency.db.test.ts
```

Expected: psql prints `BEGIN … COMMIT`; the test FAILs with `Failed to resolve import "./idempotency"`.

- [ ] **Step 4: Write `idempotency.ts`**

Create `ads-agent/lib/events/idempotency.ts`:

```ts
import type { PoolClient } from "pg";
import type { Scope } from "../db/scope-sql";

/**
 * At-least-once delivery made safe (datastore spec §14.3).
 *
 * The marker insert and the handler share the caller's transaction, so either
 * both stick or neither does: a handler that throws leaves no marker and the
 * redelivery runs for real. `consumer` is part of the key because §14.2 fans
 * one event out to up to five consumers, each of which must see it once.
 */
export async function consumeOnce(
  scope: Scope,
  client: PoolClient,
  consumer: string,
  eventId: string,
  handler: (client: PoolClient) => Promise<void>,
): Promise<{ skipped: boolean }> {
  if (scope.kind !== "org") {
    throw new Error("consumeOnce requires org scope: every event belongs to exactly one tenant");
  }
  const { rowCount } = await client.query(
    `INSERT INTO context.consumed_events (org_id, consumer, event_id)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT consumed_events_once DO NOTHING`,
    [scope.orgId, consumer, eventId],
  );
  if (rowCount === 0) return { skipped: true };
  await handler(client);
  return { skipped: false };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/events/idempotency.db.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Verify the down migration, re-apply, and commit**

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/044_consumed_events.down.sql
psql "$TEST_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='context' AND table_name='consumed_events'"
```

Expected: `0`.

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/044_consumed_events.up.sql
npx vitest run --config vitest.db.config.ts lib/events/idempotency.db.test.ts
```

Expected: PASS, 4 tests.

```bash
git add ads-agent/lib/db/migrations/044_consumed_events.up.sql \
        ads-agent/lib/db/migrations/044_consumed_events.down.sql \
        ads-agent/lib/events/idempotency.ts ads-agent/lib/events/idempotency.db.test.ts
git commit -m "feat(events): make redelivery a no-op

Delivery is at-least-once by design, so consumers de-duplicate on the outbox
event id. The marker insert shares the handler's transaction: a handler that
throws leaves no marker, so the retry still runs."
```

## Task 11: The listings app's publish path, and the boundary test

**Files:**
- Create: `lib/db/scope.ts`
- Create: `lib/db/tx.ts`
- Create: `lib/db/outbox.ts`
- Create: `lib/db/outbox.db.test.ts`
- Create: `lib/events/no-direct-publish.test.ts`

**Interfaces:**
- Consumes: `getPool()` from `lib/db/client.ts` (root app); `context.outbox_events` (Task 1); the existence of `ads-agent/lib/events/publisher.ts` (Task 5) as the sole allowlisted importer.
- Produces: `type Scope`, `withTenantTransaction`, `enqueueEvent` in the root app, with the same signatures as their `ads-agent` twins. S6a's portal ingestion endpoint and the enquiry route call these.

**Why duplicated rather than shared:** the two apps have separate `package.json` files, separate pools and separate deployments, with no shared package between them — the same deliberate duplication as the `AUTH_ISSUER` literal in `ads-agent/lib/auth/dal.ts`. The SQL contract is what is shared, and `no-direct-publish.test.ts` plus the RLS policy are what keep both honest.

**Skills:** `typescript-pro`, `test-automator`
**Model:** `composer-2.5-fast` — the boundary test, the call-site diffs and the self-falsification step are written out below verbatim, including the file list the test is allowed to match.

- [ ] **Step 1: Write the failing boundary test**

Create `lib/events/no-direct-publish.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Datastore spec §14.1: publish through the database, never directly. The rule
// is only real if a test enforces it — a comment does not survive a hurried
// afternoon.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWED = new Set([
  "ads-agent/lib/events/publisher.ts",
  "ads-agent/scripts/bootstrap-pubsub-emulator.ts", // creates topics; never publishes domain events
  "ads-agent/lib/events/publisher.emulator.db.test.ts", // subscribes to assert the boundary works
  "lib/events/no-direct-publish.test.ts",
]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "coverage", ".turbo"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (SOURCE.test(entry)) acc.push(full);
  }
  return acc;
}

describe("the Pub/Sub client has exactly one importer", () => {
  it("is only imported by the publisher boundary", () => {
    const offenders = sourceFiles(REPO_ROOT)
      .filter((file) => /@google-cloud\/pubsub/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file))
      .filter((rel) => !ALLOWED.has(rel))
      .sort();

    expect(offenders).toEqual([]);
  });

  it("has an allowlist that still points at real files", () => {
    for (const allowed of ALLOWED) {
      expect(() => statSync(path.join(REPO_ROOT, allowed)), `${allowed} is allowlisted but missing`).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Write the failing outbox test for the listings app**

Create `lib/db/outbox.db.test.ts`:

```ts
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueEvent } from "./outbox";
import { withTenantTransaction } from "./tx";

// The listings app has no test-support module of its own; this file owns its
// pool because it is the only database test in this app.
const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    (() => {
      throw new Error("TEST_DATABASE_URL is not set — see docs/superpowers/plans/2026-08-12-s5a-event-backbone.md");
    })(),
  max: 1,
});

let orgId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, kind) VALUES ($1, 'external') RETURNING id`,
    [`listings-outbox-${Date.now()}`],
  );
  orgId = rows[0].id;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

afterAll(async () => {
  await pool.end();
});

describe("listings enqueueEvent", () => {
  it("writes a portal.event row inside the caller's transaction", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, {
        topic: "portal.event",
        payload: { sessionId: "s-1", kind: "page_view" },
      }),
    );

    const { rows } = await pool.query<{ id: string; ordering_key: string; topic: string }>(
      `SELECT id, ordering_key, topic FROM context.outbox_events WHERE id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, ordering_key: orgId, topic: "portal.event" });
  });

  it("leaves no event behind when the caller's transaction fails", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId }, async (client) => {
        await enqueueEvent({ kind: "org", orgId }, client, {
          topic: "portal.event",
          payload: { sessionId: "s-2", kind: "page_view" },
        });
        throw new Error("consent check failed after enqueue");
      }),
    ).rejects.toThrow("consent check failed after enqueue");

    const { rows } = await pool.query(
      `SELECT id FROM context.outbox_events WHERE org_id = $1 AND payload->>'sessionId' = 's-2'`,
      [orgId],
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
cd /Users/swami/Documents/GentleSpace_Web
npx vitest run lib/events/no-direct-publish.test.ts lib/db/outbox.db.test.ts
```

Expected: `lib/db/outbox.db.test.ts` FAILs with `Failed to resolve import "./outbox"`. `no-direct-publish.test.ts` PASSes both of its tests, because this task's branch is cut from the Wave 3 merge and `ads-agent/lib/events/publisher.ts` already exists. If the second test instead reports `ads-agent/lib/events/publisher.ts is allowlisted but missing`, the branch was cut before Wave 3 merged — rebase onto it rather than editing the allowlist. Step 6 is what proves this test can fail.

- [ ] **Step 4: Write the three listings-app modules**

Create `lib/db/scope.ts`:

```ts
/**
 * The same Scope the ads-agent app uses (ads-agent/lib/db/scope-sql.ts).
 * Duplicated deliberately: the two apps have separate package.json files, pools
 * and deployments, with no shared package — the same intentional duplication as
 * the AUTH_ISSUER literal in ads-agent/lib/auth/dal.ts. The shared contract is
 * the SQL, and RLS is what enforces it.
 */
export type Scope =
  | { kind: "platform"; orgId: string }
  | { kind: "org"; orgId: string };
```

Create `lib/db/tx.ts`:

```ts
import type { Pool, PoolClient } from "pg";
import { getPool } from "./client";
import type { Scope } from "./scope";

/**
 * One transaction for the domain write and its outbox event. set_config's third
 * argument is transaction-scoped, so the tenant must be set inside the
 * transaction that carries the write, or the next request on the same pooled
 * connection inherits it.
 */
export async function withTenantTransaction<T>(
  scope: Scope,
  fn: (client: PoolClient) => Promise<T>,
  pool: Pool = getPool(),
): Promise<T> {
  const client = await pool.connect();
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

Create `lib/db/outbox.ts`:

```ts
import type { PoolClient } from "pg";
import type { Scope } from "./scope";

/**
 * The listings app's only publish path. There is no Pub/Sub client in this app
 * at all — `lib/events/no-direct-publish.test.ts` fails if one appears. The
 * relay in ads-agent publishes what this writes.
 *
 * Topic list mirrors ads-agent/lib/events/topics.ts and the CHECK constraint on
 * context.outbox_events; a value outside it is rejected by the database.
 */
export type ListingsOutboxTopic = "enquiry.received" | "enquiry.activity_logged" | "portal.event";

export type OutboxEventInput = {
  topic: ListingsOutboxTopic;
  payload: Record<string, unknown>;
};

export async function enqueueEvent(
  scope: Scope,
  client: PoolClient,
  event: OutboxEventInput,
): Promise<string> {
  if (scope.kind !== "org") {
    throw new Error("enqueueEvent requires org scope: every event belongs to exactly one tenant");
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO context.outbox_events (org_id, topic, payload, ordering_key)
     VALUES ($1, $2, $3::jsonb, $1::text)
     RETURNING id`,
    [scope.orgId, event.topic, JSON.stringify(event.payload)],
  );
  return rows[0].id;
}
```

- [ ] **Step 5: Run both tests to verify they pass**

```bash
cd /Users/swami/Documents/GentleSpace_Web
export TEST_DATABASE_URL=postgres://gentle:gentle@localhost:5433/gentle_space_listings
npx vitest run lib/events/no-direct-publish.test.ts lib/db/outbox.db.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Prove the boundary test actually fails when violated**

```bash
printf 'import { PubSub } from "@google-cloud/pubsub";\nexport const bad = PubSub;\n' > lib/db/violation-probe.ts
npx vitest run lib/events/no-direct-publish.test.ts
```

Expected: FAIL — `expected [ 'lib/db/violation-probe.ts' ] to deeply equal []`. A test that cannot fail is not protecting anything.

```bash
rm lib/db/violation-probe.ts
npx vitest run lib/events/no-direct-publish.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add lib/db/scope.ts lib/db/tx.ts lib/db/outbox.ts lib/db/outbox.db.test.ts \
        lib/events/no-direct-publish.test.ts
git commit -m "feat(outbox): give the listings app a publish path and forbid the rest

The listings app writes portal.event and enquiry events into the same outbox and
never imports a Pub/Sub client. A repo-wide test enumerates every file that
imports @google-cloud/pubsub and fails on anything outside the allowlist."
```

---

# Wave 5

## Task 9: Deletion propagation — the one that cannot be lost

**Files:**
- Create: `ads-agent/lib/db/migrations/043_deletion_propagation_publish.up.sql` / `.down.sql`
- Create: `ads-agent/lib/events/deletion-reconciler.ts`
- Create: `ads-agent/lib/events/deletion-reconciler.db.test.ts`
- Create: `ads-agent/scripts/run-deletion-reconciler.ts`
- Modify: `ads-agent/package.json` (scripts only)

**Interfaces:**
- Consumes: `context.deletion_requests` and `context.deletion_propagations` (S4, data model §6.1); `enqueueEvent` from `../db/outbox` (Task 3); `withTenantTransaction` from `../db/tx` (Task 2); `relayPool` from `./relay-pool` (Task 7, read-only import); `DELETION_TOPIC` from `./topics` (Task 4).
- Produces: `type ReconcileResult = { republished: number; stalled: string[] }` and `reconcileDeletions(options: { republishAfterMinutes: number; alertAfterHours: number }): Promise<ReconcileResult>`. Task 12's gate calls it after dropping a deletion event on the floor.

**Skills:** `senior-backend`, `postgres-pro`, `sre-engineer`
**Model:** `inherit` — deletion propagation is the one failure this system is not allowed to have, and the reconciler is the only thing standing behind it. Ledger-as-truth, re-enqueueing under the original org's scope, and refusing to mark a request complete on a publish it did not observe are judgement calls, not transcription. Step 1 may also find the ledger table absent and must stop rather than invent one.

- [ ] **Step 1: Verify the precondition, then write migration 043**

```bash
psql "$TEST_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='context' AND table_name IN ('deletion_requests','deletion_propagations')"
```

Expected: `2`. If it prints anything else, STOP: those tables are S4's compliance deliverable (data model §6.1) and creating them here would put two plans in charge of the same object.

Create `ads-agent/lib/db/migrations/043_deletion_propagation_publish.up.sql`:

```sql
-- S5a: let the reconciling sweeper know when it last published for a store.
-- Datastore spec §14.4: "The queue is transport; the ledger is truth."
-- Expressed as an explicit ALTER because a change written inside a CREATE TABLE
-- body never reaches a provisioned database.
BEGIN;

ALTER TABLE context.deletion_propagations
  ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;

-- The sweeper's query: pending rows whose last publish is old enough to be
-- presumed lost. Partial, so it stays small as the ledger accumulates.
CREATE INDEX IF NOT EXISTS deletion_propagations_pending_idx
  ON context.deletion_propagations (last_published_at)
  WHERE state = 'pending';

GRANT SELECT, UPDATE ON context.deletion_propagations TO outbox_relay;
GRANT SELECT ON context.deletion_requests TO outbox_relay;

COMMIT;
```

Create `ads-agent/lib/db/migrations/043_deletion_propagation_publish.down.sql`:

```sql
BEGIN;
REVOKE SELECT ON context.deletion_requests FROM outbox_relay;
REVOKE SELECT, UPDATE ON context.deletion_propagations FROM outbox_relay;
DROP INDEX IF EXISTS context.deletion_propagations_pending_idx;
ALTER TABLE context.deletion_propagations DROP COLUMN IF EXISTS last_published_at;
COMMIT;
```

- [ ] **Step 2: Write the failing test**

Create `ads-agent/lib/events/deletion-reconciler.db.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listEventsForOrg } from "../db/outbox";
import { closeTestPool, resetOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import { reconcileDeletions } from "./deletion-reconciler";
import { closeRelayPool } from "./relay-pool";

const pool = testPool();
let orgId: string;
let requestId: string;

async function seedPendingErasure(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO context.deletion_requests (org_id, subject_kind, subject_ref, erase_after, respond_by)
     VALUES ($1, 'enquirer', 'enquiry-1', current_date + 365, current_date + 90)
     RETURNING id`,
    [orgId],
  );
  requestId = rows[0].id;
  await pool.query(
    `INSERT INTO context.deletion_propagations (request_id, store, state)
     VALUES ($1, 'clickhouse', 'pending'), ($1, 'twenty', 'pending')`,
    [requestId],
  );
}

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "deletion");
  await pool.query(`DELETE FROM context.deletion_requests WHERE org_id = $1`, [orgId]);
  await resetOutbox(pool, orgId);
  await seedPendingErasure();
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

async function deletionEvents(): Promise<Record<string, unknown>[]> {
  const rows = await withTenantTransaction({ kind: "org", orgId }, (client) =>
    listEventsForOrg({ kind: "org", orgId }, client),
  );
  return rows.filter((row) => row.topic === "deletion.requested").map((row) => row.payload);
}

describe("reconcileDeletions", () => {
  it("publishes one event per unfinished store", async () => {
    const result = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(result.republished).toBe(2);
    const payloads = await deletionEvents();
    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.store).sort()).toEqual(["clickhouse", "twenty"]);
    expect(payloads.every((p) => p.requestId === requestId && p.subjectRef === "enquiry-1")).toBe(true);
  });

  it("does not republish again inside the threshold", async () => {
    await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    const second = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(second.republished).toBe(0);
    expect(await deletionEvents()).toHaveLength(2);
  });

  it("republishes a lost message once the threshold has passed", async () => {
    await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    // The relay published it and the consumer never acted: state is still
    // pending. Age the ledger rather than the clock.
    await pool.query(
      `UPDATE context.deletion_propagations SET last_published_at = now() - interval '20 minutes'
        WHERE request_id = $1`,
      [requestId],
    );

    const third = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(third.republished).toBe(2);
    expect(await deletionEvents()).toHaveLength(4);
  });

  it("stops republishing once a store reports erased", async () => {
    await pool.query(
      `UPDATE context.deletion_propagations SET state = 'erased' WHERE request_id = $1 AND store = 'twenty'`,
      [requestId],
    );

    const result = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(result.republished).toBe(1);
    expect((await deletionEvents()).map((p) => p.store)).toEqual(["clickhouse"]);
  });

  it("reports a stalled erasure so it can be alerted on separately", async () => {
    await pool.query(
      `UPDATE context.deletion_requests SET requested_at = now() - interval '48 hours' WHERE id = $1`,
      [requestId],
    );

    const result = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(result.stalled).toContain(`${requestId}:clickhouse`);
    expect(result.stalled).toContain(`${requestId}:twenty`);
  });
});
```

- [ ] **Step 3: Apply the migration and run the test to verify it fails**

```bash
cd ads-agent
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/043_deletion_propagation_publish.up.sql
npx vitest run --config vitest.db.config.ts lib/events/deletion-reconciler.db.test.ts
```

Expected: psql prints `BEGIN`, `ALTER TABLE`, `CREATE INDEX`, `GRANT`, `GRANT`, `COMMIT`; the test FAILs with `Failed to resolve import "./deletion-reconciler"`.

- [ ] **Step 4: Write `deletion-reconciler.ts`**

Create `ads-agent/lib/events/deletion-reconciler.ts`:

```ts
import { enqueueEvent } from "../db/outbox";
import { withTenantTransaction } from "../db/tx";
import { relayPool } from "./relay-pool";
import { DELETION_TOPIC } from "./topics";

/**
 * Datastore spec §14.4. A lost deletion.requested message is a failed erasure
 * obligation under DPDP and GDPR — a compliance failure, not a retry.
 *
 * "The queue is transport; the ledger is truth." Correctness comes from
 * reconciling against context.deletion_propagations, which records desired
 * state per store, not from trusting delivery. That inversion is what makes
 * at-least-once semantics acceptable for a compliance obligation.
 *
 * Cross-tenant discovery, then a per-tenant transaction: the sweep reads every
 * org's pending rows as the relay role, but each event is written under its own
 * tenant through the one enqueue path, so RLS still applies to the write.
 */
export type ReconcileResult = {
  republished: number;
  /** `${requestId}:${store}` for erasures older than alertAfterHours. */
  stalled: string[];
};

type PendingRow = {
  request_id: string;
  store: string;
  org_id: string;
  subject_kind: string;
  subject_ref: string;
  stalled: boolean;
};

export async function reconcileDeletions(options: {
  republishAfterMinutes: number;
  alertAfterHours: number;
}): Promise<ReconcileResult> {
  const { republishAfterMinutes, alertAfterHours } = options;
  const pool = relayPool();

  const { rows } = await pool.query<PendingRow>(
    `SELECT p.request_id, p.store, r.org_id, r.subject_kind, r.subject_ref,
            (r.requested_at < now() - make_interval(hours => $2)) AS stalled
       FROM context.deletion_propagations p
       JOIN context.deletion_requests r ON r.id = p.request_id
      WHERE p.state = 'pending'
        AND (p.last_published_at IS NULL
             OR p.last_published_at < now() - make_interval(mins => $1))
      ORDER BY r.requested_at
      LIMIT 500`,
    [republishAfterMinutes, alertAfterHours],
  );

  const stalled: string[] = [];
  let republished = 0;

  for (const row of rows) {
    if (row.stalled) stalled.push(`${row.request_id}:${row.store}`);
    await withTenantTransaction(
      { kind: "org", orgId: row.org_id },
      async (client) => {
        await enqueueEvent({ kind: "org", orgId: row.org_id }, client, {
          topic: DELETION_TOPIC,
          payload: {
            requestId: row.request_id,
            store: row.store,
            subjectKind: row.subject_kind,
            subjectRef: row.subject_ref,
          },
        });
        await client.query(
          `UPDATE context.deletion_propagations SET last_published_at = now()
            WHERE request_id = $1 AND store = $2`,
          [row.request_id, row.store],
        );
      },
      pool,
    );
    republished += 1;
  }

  return { republished, stalled };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/events/deletion-reconciler.db.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Write the cron entry point with its own alert**

Create `ads-agent/scripts/run-deletion-reconciler.ts`:

```ts
/**
 * Cron: the deletion reconciler — `npm run reconcile:deletions`.
 *
 * §14.5: cron finds work by time and publishes rather than doing it. §14.4:
 * this is the one event class where a drop is a compliance breach, so its alert
 * is distinct from ordinary publish failures and its exit code is non-zero when
 * an erasure has stalled — a cron mail is the alerting channel.
 *
 * Suggested schedule: every 10 minutes.
 *   */10 * * * * cd /srv/ads-agent && npm run reconcile:deletions
 */
import { reconcileDeletions } from "../lib/events/deletion-reconciler";
import { closeRelayPool } from "../lib/events/relay-pool";

const REPUBLISH_AFTER_MINUTES = Number(process.env.OUTBOX_DELETION_REPUBLISH_AFTER_MINUTES ?? 10);
const ALERT_AFTER_HOURS = Number(process.env.OUTBOX_DELETION_ALERT_AFTER_HOURS ?? 24);

async function main(): Promise<void> {
  const result = await reconcileDeletions({
    republishAfterMinutes: REPUBLISH_AFTER_MINUTES,
    alertAfterHours: ALERT_AFTER_HOURS,
  });
  console.log(`deletion reconciler republished=${result.republished} stalled=${result.stalled.length}`);

  if (result.stalled.length > 0) {
    console.error(
      `ALERT deletion.propagation_stalled count=${result.stalled.length} ` +
        `olderThanHours=${ALERT_AFTER_HOURS} refs=${result.stalled.join(",")}`,
    );
  }

  await closeRelayPool();
  // Non-zero when an erasure obligation is overdue: this is a compliance
  // deadline (DPDP Rule 14(3): 90 days maximum), not a transient blip.
  process.exit(result.stalled.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ALERT deletion.reconciler_failed", err);
  process.exit(1);
});
```

Add to `ads-agent/package.json` `scripts`:

```json
    "reconcile:deletions": "tsx --env-file=.env.local scripts/run-deletion-reconciler.ts",
```

- [ ] **Step 7: Smoke the entry point, verify the down migration, and commit**

```bash
cd ads-agent
export OUTBOX_RELAY_DATABASE_URL="postgres://outbox_relay:relay-local@localhost:5433/gentle_space_listings"
npx tsx scripts/run-deletion-reconciler.ts; echo "exit=$?"
```

Expected: `deletion reconciler republished=N stalled=0` then `exit=0` (N depends on leftover test fixtures; a clean database prints `republished=0`).

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/043_deletion_propagation_publish.down.sql
psql "$TEST_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_schema='context' AND table_name='deletion_propagations' AND column_name='last_published_at'"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/043_deletion_propagation_publish.up.sql
```

Expected: `0` between the two migration runs.

```bash
git add ads-agent/lib/db/migrations/043_deletion_propagation_publish.up.sql \
        ads-agent/lib/db/migrations/043_deletion_propagation_publish.down.sql \
        ads-agent/lib/events/deletion-reconciler.ts \
        ads-agent/lib/events/deletion-reconciler.db.test.ts \
        ads-agent/scripts/run-deletion-reconciler.ts ads-agent/package.json
git commit -m "feat(events): reconcile deletion propagation against the ledger

A lost deletion.requested message is a failed erasure obligation, not a missed
update. Correctness comes from comparing context.deletion_propagations against
actual state and re-publishing anything still pending, with its own alert and a
non-zero exit when an erasure is overdue."
```

## Task 10: Observability and retention

**Files:**
- Create: `ads-agent/lib/db/migrations/042_outbox_health_view.up.sql` / `.down.sql`
- Create: `ads-agent/lib/events/health.ts`
- Create: `ads-agent/lib/events/health.db.test.ts`
- Create: `ads-agent/lib/events/prune.ts`
- Create: `ads-agent/scripts/check-outbox-health.ts`
- Create: `ads-agent/scripts/prune-outbox.ts`
- Modify: `ads-agent/package.json` (scripts only)

**Interfaces:**
- Consumes: `context.outbox_events` (Task 1); `relayPool` from `./relay-pool` (Task 7, read-only import); `DELETION_TOPIC` from `./topics` (Task 4); `testPool`, `seedOrg`, `resetOutbox`, `closeTestPool` (Task 1).
- Produces: `type OutboxHealth`, `readOutboxHealth(): Promise<OutboxHealth>`, `type HealthThresholds`, `healthAlerts(health: OutboxHealth, thresholds: HealthThresholds): string[]` from `health.ts`; `pruneOutbox(retentionDays: number): Promise<{ deleted: number; deadTuples: number }>` from `prune.ts`.

**Skills:** `observability-designer`, `postgres-pro`
**Model:** `composer-2.5-fast` — the view, the grants, the alert thresholds and the prune script are all written out below with their default values chosen in the plan text.

- [ ] **Step 1: Write migration 042**

Create `ads-agent/lib/db/migrations/042_outbox_health_view.up.sql`:

```sql
-- S5a: one view answering every outbox signal from datastore spec §12.4.
-- One query per signal was four round trips and four chances to disagree.
BEGIN;

-- security_invoker so the querying role's RLS applies rather than the view
-- owner's. Without it this view would be a hole straight through tenant
-- isolation for anyone granted SELECT on it.
CREATE VIEW context.outbox_health WITH (security_invoker = true) AS
SELECT
  count(*) FILTER (WHERE published_at IS NULL)                            AS unpublished_count,
  coalesce(
    max(EXTRACT(EPOCH FROM (now() - created_at))) FILTER (WHERE published_at IS NULL),
    0)::bigint                                                            AS oldest_unpublished_seconds,
  count(*) FILTER (WHERE published_at IS NULL AND topic = 'deletion.requested')
                                                                          AS unpublished_deletion_count,
  coalesce(
    max(EXTRACT(EPOCH FROM (now() - created_at)))
      FILTER (WHERE published_at IS NULL AND topic = 'deletion.requested'),
    0)::bigint                                                            AS oldest_unpublished_deletion_seconds,
  count(*) FILTER (WHERE published_at IS NULL AND attempts >= 5)          AS stuck_count
FROM context.outbox_events;

GRANT SELECT ON context.outbox_health TO outbox_relay;

-- Retention (data model §5a) runs as the relay role, which migration 041 gave
-- only SELECT and UPDATE. Pruning published rows needs DELETE, and it is granted
-- here rather than in 041 because retention is this migration's deliverable.
GRANT DELETE ON context.outbox_events TO outbox_relay;

COMMIT;
```

Create `ads-agent/lib/db/migrations/042_outbox_health_view.down.sql`:

```sql
BEGIN;
REVOKE DELETE ON context.outbox_events FROM outbox_relay;
DROP VIEW IF EXISTS context.outbox_health;
COMMIT;
```

- [ ] **Step 2: Write the failing test**

Create `ads-agent/lib/events/health.db.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueEvent } from "../db/outbox";
import { closeTestPool, resetOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import { healthAlerts, readOutboxHealth, type OutboxHealth } from "./health";
import { pruneOutbox } from "./prune";
import { closeRelayPool } from "./relay-pool";

const pool = testPool();
let orgId: string;

const THRESHOLDS = {
  lagSeconds: 300,
  deletionLagSeconds: 60,
  stuckCount: 1,
  deadTuples: 100_000,
};

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "health");
  await resetOutbox(pool, orgId);
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

describe("readOutboxHealth", () => {
  it("counts unpublished rows and separates the deletion class", async () => {
    await withTenantTransaction({ kind: "org", orgId }, async (client) => {
      await enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: {} });
      await enqueueEvent({ kind: "org", orgId }, client, {
        topic: "deletion.requested",
        payload: { requestId: "r-1", store: "graph" },
      });
    });

    const health = await readOutboxHealth();

    expect(health.unpublishedCount).toBeGreaterThanOrEqual(2);
    expect(health.unpublishedDeletionCount).toBeGreaterThanOrEqual(1);
    expect(health.oldestUnpublishedSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("healthAlerts", () => {
  const base: OutboxHealth = {
    unpublishedCount: 0,
    oldestUnpublishedSeconds: 0,
    unpublishedDeletionCount: 0,
    oldestUnpublishedDeletionSeconds: 0,
    stuckCount: 0,
    deadTuples: 0,
  };

  it("is silent when every signal is inside its threshold", () => {
    expect(healthAlerts(base, THRESHOLDS)).toEqual([]);
  });

  it("alerts on relay lag", () => {
    const alerts = healthAlerts({ ...base, oldestUnpublishedSeconds: 400 }, THRESHOLDS);
    expect(alerts).toEqual(["ALERT outbox.relay_lag seconds=400 threshold=300"]);
  });

  it("alerts on deletion lag with a tighter threshold and its own name", () => {
    const alerts = healthAlerts(
      { ...base, unpublishedDeletionCount: 1, oldestUnpublishedDeletionSeconds: 90 },
      THRESHOLDS,
    );
    expect(alerts).toEqual(["ALERT outbox.deletion_lag seconds=90 threshold=60 count=1"]);
  });

  it("alerts on rows the relay keeps failing to publish", () => {
    expect(healthAlerts({ ...base, stuckCount: 3 }, THRESHOLDS)).toEqual([
      "ALERT outbox.stuck_events count=3 threshold=1",
    ]);
  });

  it("alerts on table bloat, the known cost of a queue in Postgres", () => {
    expect(healthAlerts({ ...base, deadTuples: 200_000 }, THRESHOLDS)).toEqual([
      "ALERT outbox.bloat deadTuples=200000 threshold=100000",
    ]);
  });
});

describe("pruneOutbox", () => {
  it("deletes published rows past the retention window and leaves unpublished ones", async () => {
    const keptId = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { keep: true } }),
    );
    const prunedId = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { keep: false } }),
    );
    await pool.query(
      `UPDATE context.outbox_events SET published_at = now() - interval '40 days' WHERE id = $1`,
      [prunedId],
    );

    const result = await pruneOutbox(30);

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM context.outbox_events WHERE id = ANY($1::uuid[])`,
      [[keptId, prunedId]],
    );
    expect(rows.map((r) => r.id)).toEqual([keptId]);
  });
});
```

- [ ] **Step 3: Apply the migration and run the test to verify it fails**

```bash
cd ads-agent
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/042_outbox_health_view.up.sql
npx vitest run --config vitest.db.config.ts lib/events/health.db.test.ts
```

Expected: psql prints `BEGIN`, `CREATE VIEW`, `GRANT`, `COMMIT`; the test FAILs with `Failed to resolve import "./health"`.

- [ ] **Step 4: Write `health.ts`**

Create `ads-agent/lib/events/health.ts`:

```ts
import { relayPool } from "./relay-pool";

/**
 * The outbox's share of datastore spec §12.4: one alert per signal, one channel.
 * The channel is a stable `ALERT <name> …` line on stderr plus a non-zero exit
 * from scripts/check-outbox-health.ts, which is what a solo operator can
 * actually maintain.
 */
export type OutboxHealth = {
  unpublishedCount: number;
  oldestUnpublishedSeconds: number;
  unpublishedDeletionCount: number;
  oldestUnpublishedDeletionSeconds: number;
  stuckCount: number;
  deadTuples: number;
};

export type HealthThresholds = {
  lagSeconds: number;
  deletionLagSeconds: number;
  stuckCount: number;
  deadTuples: number;
};

type HealthRow = {
  unpublished_count: string;
  oldest_unpublished_seconds: string;
  unpublished_deletion_count: string;
  oldest_unpublished_deletion_seconds: string;
  stuck_count: string;
};

export async function readOutboxHealth(): Promise<OutboxHealth> {
  const pool = relayPool();
  const { rows } = await pool.query<HealthRow>(`SELECT * FROM context.outbox_health`);
  // Bloat is not in the view: pg_stat_user_tables is a different relation, and
  // §5a names this table specifically as the one to watch for it.
  const { rows: bloat } = await pool.query<{ n_dead_tup: string }>(
    `SELECT coalesce(n_dead_tup, 0)::text AS n_dead_tup
       FROM pg_stat_user_tables
      WHERE schemaname = 'context' AND relname = 'outbox_events'`,
  );
  return {
    unpublishedCount: Number(rows[0].unpublished_count),
    oldestUnpublishedSeconds: Number(rows[0].oldest_unpublished_seconds),
    unpublishedDeletionCount: Number(rows[0].unpublished_deletion_count),
    oldestUnpublishedDeletionSeconds: Number(rows[0].oldest_unpublished_deletion_seconds),
    stuckCount: Number(rows[0].stuck_count),
    deadTuples: Number(bloat[0]?.n_dead_tup ?? 0),
  };
}

export function healthAlerts(health: OutboxHealth, thresholds: HealthThresholds): string[] {
  const alerts: string[] = [];
  if (health.oldestUnpublishedSeconds > thresholds.lagSeconds) {
    alerts.push(
      `ALERT outbox.relay_lag seconds=${health.oldestUnpublishedSeconds} threshold=${thresholds.lagSeconds}`,
    );
  }
  // §14.4: deletion gets its own alert and a tighter threshold, because a
  // delayed erasure is a compliance breach rather than a stale dashboard.
  if (health.oldestUnpublishedDeletionSeconds > thresholds.deletionLagSeconds) {
    alerts.push(
      `ALERT outbox.deletion_lag seconds=${health.oldestUnpublishedDeletionSeconds} ` +
        `threshold=${thresholds.deletionLagSeconds} count=${health.unpublishedDeletionCount}`,
    );
  }
  if (health.stuckCount >= thresholds.stuckCount) {
    alerts.push(`ALERT outbox.stuck_events count=${health.stuckCount} threshold=${thresholds.stuckCount}`);
  }
  if (health.deadTuples > thresholds.deadTuples) {
    alerts.push(`ALERT outbox.bloat deadTuples=${health.deadTuples} threshold=${thresholds.deadTuples}`);
  }
  return alerts;
}
```

- [ ] **Step 5: Write `prune.ts`**

Create `ads-agent/lib/events/prune.ts`:

```ts
import { relayPool } from "./relay-pool";

/**
 * Data model §5a retention. "A high-churn queue table is exactly where MVCC
 * bloat and vacuum pressure bite" — published rows are kept only as long as
 * they are useful for debugging replay.
 *
 * This is a genuine DELETE, and it is not an exception to "suppression columns,
 * never DELETE": that rule protects personal data under DPDP's retention floor.
 * These rows are transport bookkeeping whose payloads reference the records
 * rather than being them, and the record itself is retained by the store that
 * owns it.
 */
export async function pruneOutbox(retentionDays: number): Promise<{ deleted: number; deadTuples: number }> {
  const pool = relayPool();
  const { rowCount } = await pool.query(
    `DELETE FROM context.outbox_events
      WHERE published_at IS NOT NULL
        AND published_at < now() - make_interval(days => $1)`,
    [retentionDays],
  );
  const { rows } = await pool.query<{ n_dead_tup: string }>(
    `SELECT coalesce(n_dead_tup, 0)::text AS n_dead_tup
       FROM pg_stat_user_tables
      WHERE schemaname = 'context' AND relname = 'outbox_events'`,
  );
  return { deleted: rowCount ?? 0, deadTuples: Number(rows[0]?.n_dead_tup ?? 0) };
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/events/health.db.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 7: Write the two cron entry points**

Create `ads-agent/scripts/check-outbox-health.ts`:

```ts
/**
 * Cron: the outbox's four §12.4 signals — `npm run outbox:health`.
 * Prints one ALERT line per breached signal and exits non-zero, so cron mail is
 * the alerting channel and no additional service is needed.
 *
 * Suggested schedule: every 5 minutes.
 *   */5 * * * * cd /srv/ads-agent && npm run outbox:health
 */
import { healthAlerts, readOutboxHealth } from "../lib/events/health";
import { closeRelayPool } from "../lib/events/relay-pool";

async function main(): Promise<void> {
  const health = await readOutboxHealth();
  const alerts = healthAlerts(health, {
    lagSeconds: Number(process.env.OUTBOX_LAG_ALERT_SECONDS ?? 300),
    deletionLagSeconds: Number(process.env.OUTBOX_DELETION_LAG_ALERT_SECONDS ?? 60),
    stuckCount: Number(process.env.OUTBOX_STUCK_ALERT_COUNT ?? 1),
    deadTuples: Number(process.env.OUTBOX_BLOAT_ALERT_DEAD_TUPLES ?? 100_000),
  });

  console.log(
    `outbox health unpublished=${health.unpublishedCount} oldestSeconds=${health.oldestUnpublishedSeconds} ` +
      `deletionUnpublished=${health.unpublishedDeletionCount} stuck=${health.stuckCount} deadTuples=${health.deadTuples}`,
  );
  for (const alert of alerts) console.error(alert);

  await closeRelayPool();
  process.exit(alerts.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ALERT outbox.health_check_failed", err);
  process.exit(1);
});
```

Create `ads-agent/scripts/prune-outbox.ts`:

```ts
/**
 * Cron: outbox retention — `npm run outbox:prune`.
 * Data model §5a: keep published rows only as long as they are useful for
 * debugging replay, and monitor bloat on this table specifically.
 *
 * Suggested schedule: daily, off-peak.
 *   17 3 * * * cd /srv/ads-agent && npm run outbox:prune
 */
import { pruneOutbox } from "../lib/events/prune";
import { closeRelayPool } from "../lib/events/relay-pool";

const RETENTION_DAYS = Number(process.env.OUTBOX_RETENTION_DAYS ?? 14);

async function main(): Promise<void> {
  const result = await pruneOutbox(RETENTION_DAYS);
  console.log(`outbox prune deleted=${result.deleted} retentionDays=${RETENTION_DAYS} deadTuples=${result.deadTuples}`);
  await closeRelayPool();
}

main().catch((err) => {
  console.error("ALERT outbox.prune_failed", err);
  process.exit(1);
});
```

Add to `ads-agent/package.json` `scripts`:

```json
    "outbox:health": "tsx --env-file=.env.local scripts/check-outbox-health.ts",
    "outbox:prune": "tsx --env-file=.env.local scripts/prune-outbox.ts",
```

- [ ] **Step 8: Smoke both entry points and commit**

```bash
cd ads-agent
export OUTBOX_RELAY_DATABASE_URL="postgres://outbox_relay:relay-local@localhost:5433/gentle_space_listings"
npx tsx scripts/check-outbox-health.ts; echo "exit=$?"
npx tsx scripts/prune-outbox.ts
```

Expected: an `outbox health unpublished=… ` line then `exit=0` on a drained outbox (`exit=1` with `ALERT` lines if the test fixtures left unpublished rows — drain with `npx tsx scripts/run-outbox-relay.ts` for a few seconds first), and `outbox prune deleted=… retentionDays=14 deadTuples=…`.

```bash
git add ads-agent/lib/db/migrations/042_outbox_health_view.up.sql \
        ads-agent/lib/db/migrations/042_outbox_health_view.down.sql \
        ads-agent/lib/events/health.ts ads-agent/lib/events/health.db.test.ts \
        ads-agent/lib/events/prune.ts ads-agent/scripts/check-outbox-health.ts \
        ads-agent/scripts/prune-outbox.ts ads-agent/package.json
git commit -m "feat(events): add outbox observability and retention

Four §12.4 signals from one security_invoker view, with deletion lag alerting
separately on a tighter threshold. Retention prunes published rows and reports
dead tuples, because a queue table in Postgres is where vacuum pressure bites."
```

---

# Wave 6

## Task 12 (fan-in): The S5a gate

**Files:**
- Create: `ads-agent/lib/events/gate.db.test.ts`

**Interfaces:**
- Consumes: everything. `enqueueEvent`, `listEventsForOrg`, `claimUnpublished` (Task 3); `withTenantTransaction` (Task 2); `runRelayOnce` (Task 7); `consumeOnce` (Task 8); `reconcileDeletions` (Task 9); `readOutboxHealth` (Task 10); `testPool`, `seedOrg`, `resetOutbox`, `closeTestPool` (Task 1).
- Produces: nothing importable. This is the gate: **an event cannot exist without its row, or its row without the event.**

**Skills:** `senior-qa`, `chaos-engineer`, `adversarial-reviewer`
**Model:** `inherit` — the gate is a judgement about whether the four properties actually hold end to end, not a transcription. Step 5 deliberately breaks the relay to prove the gate catches a dual-write, and only someone who understands what they are looking at can tell a real failure from a test that leaked rows from a neighbouring org.

- [ ] **Step 1: Merge every Wave 1–5 branch and confirm the suite is green**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git merge --no-ff wave-1 wave-2 wave-3 wave-4 wave-5
cd ads-agent && npx vitest run && npx vitest run --config vitest.db.config.ts
cd .. && npx vitest run
```

Expected: three PASS runs. Conflicts are expected only in `ads-agent/package.json` `scripts` — keep every script, they are additive.

- [ ] **Step 2: Write the failing gate test**

Create `ads-agent/lib/events/gate.db.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueEvent, listEventsForOrg } from "../db/outbox";
import { closeTestPool, resetOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import type { PublishableMessage } from "./envelope";
import { consumeOnce } from "./idempotency";
import type { Publisher } from "./publisher";
import { reconcileDeletions } from "./deletion-reconciler";
import { closeRelayPool } from "./relay-pool";
import { runRelayOnce } from "./relay";

const pool = testPool();
let orgId: string;

/**
 * A publisher that records what reached the wire and can fail on demand. The
 * distinction that matters: `sent` is what a consumer would have seen, so a row
 * appearing there twice is at-least-once working, and a committed row never
 * appearing there at all is the gate failing.
 */
function recordingPublisher() {
  const sent: PublishableMessage[] = [];
  let failNext = false;
  let failAfterSend = false;
  const publisher: Publisher = {
    async publish(message) {
      if (failNext) throw new Error("UNAVAILABLE: transport closed");
      sent.push(message);
      if (failAfterSend) throw new Error("crashed after the message left, before the row was marked");
      return "server-id";
    },
    resume() {},
    async close() {},
  };
  return {
    publisher,
    sent,
    failEverything() {
      failNext = true;
    },
    recover() {
      failNext = false;
      failAfterSend = false;
    },
    crashAfterSending() {
      failAfterSend = true;
    },
  };
}

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "gate");
  await resetOutbox(pool, orgId);
  await withTenantTransaction({ kind: "org", orgId }, async (client) => {
    await client.query(`DELETE FROM context.consumed_events WHERE org_id = $1`, [orgId]);
  });
  await pool.query(`DELETE FROM context.deletion_requests WHERE org_id = $1`, [orgId]);
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

async function drain(publisher: Publisher, ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });
    if (tick.claimed === 0) return;
  }
}

/**
 * The relay is cross-tenant by design, so it may carry other orgs' rows on the
 * same tick. Every assertion about what reached the wire filters to this test's
 * org, or it would be flaky the moment another test leaves a row behind.
 */
function sentEventIds(sent: PublishableMessage[]): string[] {
  return sent.filter((m) => m.attributes.orgId === orgId).map((m) => m.attributes.eventId);
}

describe("S5a gate: an event cannot exist without its row", () => {
  it("leaves nothing on the wire when the domain transaction fails", async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS context.s5a_gate_probe (
         id UUID PRIMARY KEY DEFAULT uuidv7(),
         org_id UUID NOT NULL,
         note TEXT NOT NULL
       )`,
    );

    await expect(
      withTenantTransaction({ kind: "org", orgId }, async (client) => {
        await client.query(`INSERT INTO context.s5a_gate_probe (org_id, note) VALUES ($1, 'enquiry')`, [orgId]);
        await enqueueEvent({ kind: "org", orgId }, client, {
          topic: "enquiry.received",
          payload: { probe: "rollback" },
        });
        throw new Error("Twenty sync rejected the payload");
      }),
    ).rejects.toThrow("Twenty sync rejected the payload");

    // Neither half of the write survived, which is the property: no orphaned
    // event, and no domain row a consumer would never hear about.
    const probes = await pool.query(`SELECT id FROM context.s5a_gate_probe WHERE org_id = $1`, [orgId]);
    expect(probes.rows).toEqual([]);

    const events = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      listEventsForOrg({ kind: "org", orgId }, client),
    );
    expect(events).toEqual([]);

    const recorder = recordingPublisher();
    await drain(recorder.publisher);
    expect(sentEventIds(recorder.sent)).toEqual([]);

    await pool.query(`DROP TABLE context.s5a_gate_probe`);
  });
});

describe("S5a gate: a row cannot exist without its event", () => {
  it("still delivers a committed row after the relay crashes between commit and publish", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "enquiry.received", payload: { probe: "crash" } }),
    );

    // The message reaches the wire, then the relay dies before marking the row.
    const recorder = recordingPublisher();
    recorder.crashAfterSending();
    await expect(runRelayOnce({ publisher: recorder.publisher, batchSize: 100, perOrgCeiling: 100 })).rejects.toThrow(
      "crashed after the message left",
    );
    expect(sentEventIds(recorder.sent)).toEqual([id]);

    // The row survived unpublished, so the next tick sends it again: duplicates,
    // never loss. That is what makes idempotent consumers mandatory.
    recorder.recover();
    await drain(recorder.publisher);
    expect(sentEventIds(recorder.sent)).toEqual([id, id]);
  });

  it("keeps delivering after repeated publish failures rather than dropping the row", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { probe: "retry" } }),
    );

    const recorder = recordingPublisher();
    recorder.failEverything();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tick = await runRelayOnce({ publisher: recorder.publisher, batchSize: 100, perOrgCeiling: 100 });
      expect(tick).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    }

    recorder.recover();
    await drain(recorder.publisher);
    expect(sentEventIds(recorder.sent)).toEqual([id]);
  });
});

describe("S5a gate: redelivery is a no-op", () => {
  it("runs a consumer once no matter how many times the message arrives", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "enquiry.received", payload: { probe: "idem" } }),
    );

    const recorder = recordingPublisher();
    recorder.crashAfterSending();
    await expect(runRelayOnce({ publisher: recorder.publisher, batchSize: 100, perOrgCeiling: 100 })).rejects.toThrow();
    recorder.recover();
    await drain(recorder.publisher);
    const delivered = sentEventIds(recorder.sent);
    expect(delivered).toEqual([id, id]); // the same event, delivered twice

    let sideEffects = 0;
    for (const eventId of delivered) {
      await withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, "twenty-sync", eventId, async () => {
          sideEffects += 1;
        }),
      );
    }

    expect(sideEffects).toBe(1);
  });
});

describe("S5a gate: a deletion event cannot be lost", () => {
  it("recovers an erasure whose message the relay dropped permanently", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO context.deletion_requests (org_id, subject_kind, subject_ref, erase_after, respond_by)
       VALUES ($1, 'enquirer', 'enquiry-gate', current_date + 365, current_date + 90)
       RETURNING id`,
      [orgId],
    );
    const requestId = rows[0].id;
    await pool.query(
      `INSERT INTO context.deletion_propagations (request_id, store, state) VALUES ($1, 'clickhouse', 'pending')`,
      [requestId],
    );

    const first = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    expect(first.republished).toBe(1);

    // The relay drops it on the floor: the row is marked published, but no
    // consumer ever acted, so the ledger is still pending. This is the case a
    // queue alone cannot recover from.
    await pool.query(
      `UPDATE context.outbox_events SET published_at = now()
        WHERE org_id = $1 AND topic = 'deletion.requested'`,
      [orgId],
    );
    await pool.query(
      `UPDATE context.deletion_propagations SET last_published_at = now() - interval '1 hour'
        WHERE request_id = $1`,
      [requestId],
    );

    const second = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(second.republished).toBe(1);
    const events = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      listEventsForOrg({ kind: "org", orgId }, client),
    );
    expect(events.filter((e) => e.topic === "deletion.requested")).toHaveLength(2);

    // And when the store finally reports done, the sweeper stops.
    await pool.query(
      `UPDATE context.deletion_propagations SET state = 'erased', last_published_at = now() - interval '1 hour'
        WHERE request_id = $1`,
      [requestId],
    );
    const third = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    expect(third.republished).toBe(0);
  });
});

describe("S5a gate: tenant isolation survives a cross-tenant relay", () => {
  it("does not let one tenant read another's events even though the relay reads both", async () => {
    const otherOrg = await seedOrg(pool, "gate-other");
    await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { mine: true } }),
    );
    await withTenantTransaction({ kind: "org", orgId: otherOrg }, (client) =>
      enqueueEvent({ kind: "org", orgId: otherOrg }, client, { topic: "reminder.due", payload: { mine: false } }),
    );

    const mine = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      listEventsForOrg({ kind: "org", orgId }, client),
    );
    expect(mine.every((row) => row.orgId === orgId)).toBe(true);
    expect(mine.some((row) => row.payload.mine === false)).toBe(false);

    const recorder = recordingPublisher();
    await drain(recorder.publisher);
    const orgsOnTheWire = new Set(recorder.sent.map((m) => m.attributes.orgId));
    expect(orgsOnTheWire.has(orgId)).toBe(true);
    expect(orgsOnTheWire.has(otherOrg)).toBe(true);
  });
});
```

- [ ] **Step 3: Prove the gate can fail, by breaking the property on purpose**

The gate is written against code that already exists, so it would pass on the first run — which tells you nothing. Break the outbox's central guarantee and watch the gate catch it.

In `ads-agent/lib/events/relay.ts`, temporarily move the `markPublished` call so rows are marked before they are published, which is exactly the dual-write bug the outbox exists to prevent:

```ts
      for (const row of rows) {
        const taken = takenPerOrg.get(row.orgId) ?? 0;
        if (taken >= perOrgCeiling) {
          deferred += 1;
          continue;
        }
        takenPerOrg.set(row.orgId, taken + 1);
        // DELIBERATE BREAK — revert after this step.
        await markPublished(PLATFORM, client, [row.id]);
        try {
          await publisher.publish(toPublishableMessage(row));
          publishedIds.push(row.id);
        } catch (err) {
```

```bash
cd ads-agent && npx vitest run --config vitest.db.config.ts lib/events/gate.db.test.ts
```

Expected: FAIL on both "a row cannot exist without its event" tests — `expected [] to deeply equal [ '018f…' ]` — because a row marked published before the publish succeeds is a row whose event is lost forever. This is the failure mode the whole plan exists to prevent; a gate that cannot detect it is decoration.

Revert the change completely before Step 4:

```bash
git checkout -- ads-agent/lib/events/relay.ts
git diff --stat ads-agent/lib/events/relay.ts
```

Expected: no output from `git diff --stat` — the break is gone.

- [ ] **Step 4: Run the gate to verify it passes**

```bash
cd ads-agent
export TEST_DATABASE_URL=postgres://gentle:gentle@localhost:5433/gentle_space_listings
export OUTBOX_RELAY_DATABASE_URL="postgres://outbox_relay:relay-local@localhost:5433/gentle_space_listings"
npx vitest run --config vitest.db.config.ts lib/events/gate.db.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Run every suite in both apps**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
npx vitest run
npx vitest run --config vitest.db.config.ts
cd /Users/swami/Documents/GentleSpace_Web
npx vitest run
```

Expected: three PASS runs. The `ads-agent` database run reports 10 files — `outbox-schema`, `tx`, `outbox`, `topics`, `publisher.emulator`, `relay`, `idempotency`, `deletion-reconciler`, `health`, `gate` — and the root run includes `lib/events/no-direct-publish.test.ts` and `lib/db/outbox.db.test.ts`.

- [ ] **Step 6: Verify the whole path end to end against the emulator**

```bash
cd ads-agent
export PUBSUB_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=gentle-space-local
npx tsx scripts/bootstrap-pubsub-emulator.ts
psql "$TEST_DATABASE_URL" <<'SQL'
BEGIN;
SELECT public.set_tenant((SELECT id FROM public.orgs ORDER BY created_at LIMIT 1));
INSERT INTO context.outbox_events (org_id, topic, payload, ordering_key)
SELECT id, 'enquiry.received', '{"smoke":true}'::jsonb, id::text
  FROM public.orgs ORDER BY created_at LIMIT 1;
COMMIT;
SQL
timeout 8 npx tsx scripts/run-outbox-relay.ts
npx tsx scripts/check-outbox-health.ts; echo "exit=$?"
```

Expected: `INSERT 0 1`; then `outbox relay started …` followed by one `outbox relay tick claimed=1 published=1 failed=0 deferred=0`; then `outbox health unpublished=0 …` and `exit=0`.

- [ ] **Step 7: Commit and record the gate**

```bash
git add ads-agent/lib/events/gate.db.test.ts
git commit -m "test(s5a): the event backbone gate

An event cannot exist without its row: a failed transaction leaves nothing on
the wire. A row cannot exist without its event: a relay crash between commit and
publish yields a second delivery, never a lost one. Redelivery is a no-op, a
dropped deletion event is recovered from the ledger, and tenant isolation holds
even though the relay reads every tenant."
```

- [ ] **Step 8: Final whole-branch review**

Dispatch one `adversarial-reviewer` on the `inherit` model over `git diff $(git merge-base main HEAD)..HEAD`, with the Global Constraints section as its attention lens. Point its Security Auditor persona specifically at:

1. Whether any code path can publish to Pub/Sub without an outbox row — including `scripts/`, and including the `ALLOWED` set in `lib/events/no-direct-publish.test.ts`, which is the one place the boundary can be widened silently.
2. Whether `relay_cross_tenant` on `context.outbox_events` grants more than the relay needs, and whether `outbox_relay` can reach any table beyond the five it is granted.
3. Whether `context.outbox_health` is `security_invoker`, and whether anything else in the branch introduces a view without it.
4. Whether the deletion reconciler can ever mark `last_published_at` without an event actually being enqueued in the same transaction — that ordering is the difference between a recoverable erasure and a silently abandoned one.
5. Whether every migration in 040–049 has a `.down.sql` that reverses it, and whether any is outside the range.

**S5a gate — the release condition for this step.** `lib/events/gate.db.test.ts` green, all three suites green, and the reviewer's findings resolved. S6a's portal ingestion cannot start until this passes, because it publishes through this outbox.

---

## Adoption (deliberately not tasks in this plan)

This plan delivers the mechanism and proves its properties. Three adoptions follow it and belong to their own plans, because their call sites are named there:

1. **The enquiry spine (S4/S5)** replaces its inline post-commit work with `enqueueEvent(scope, client, { topic: "enquiry.received", … })` inside `withTenantTransaction`, and retires the `runtime = "nodejs"` / "do not forward cancellation" workaround in `app/api/leads/route.ts` — that comment exists only because slow work currently sits inside the request (§14.1).
2. **Portal ingestion (S6a)** publishes `portal.event` through `lib/db/outbox.ts` after the consent check, and runs `infra/pubsub/create-topics.sh --with-gcs-export gs://…` to add the §14.6 export subscription once the raw-events bucket exists.
3. **The agent surfaces (S10, S12)** convert `scripts/run-decision-cycle.ts` from doing work inline to publishing `agent.task_requested`, per §14.5's rule that a cron job finds candidates and publishes.

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| §14.1 publish through the database, never directly | Tasks 1, 3, 11 (boundary test), 5 (single client importer) |
| §14.1 relay polls with `FOR UPDATE SKIP LOCKED` and marks rows published | Task 3 (`claimUnpublished`), Task 7 (`runRelayOnce`) |
| §14.1 the visitor's request no longer waits for anything slow | Adoption item 1 — the mechanism is Tasks 2, 3, 11; the route change is S4/S5's call site |
| §14.2 seven topics and their consumers | Task 4 (vocabulary), Task 6 (one subscription per consumer named in the table) |
| §14.3 at-least-once, idempotent consumers keyed on the event id | Task 8, proven in Task 12 |
| §14.3 ordering key is `org_id`, never global | Tasks 3, 4, 6 (`--enable-message-ordering`), 7 (`resume` on failure) |
| §14.3 dead-letter topic on every subscription, ordering/DLQ tension | Task 6, with the tension recorded in the script and the emulator's DLQ gap stated in Task 5 |
| §14.4 deletion propagation cannot be lost; ledger is truth | Task 9, its own alert in Tasks 7 and 10, its own gate case in Task 12 |
| §14.5 what stays on cron and why both exist | The "What stays on cron" section, plus Tasks 9 and 10's cron entry points |
| §14.6 raw event zone contract, ClickHouse side out of scope | Task 6's `--with-gcs-export` flag and Adoption item 2 |
| §12.4 observability: one alert per signal, one channel | Task 10 |
| §12.6 rate limiting, the relay's share | Task 7's `perOrgCeiling` — stated honestly as fairness, since the LLM cost ceiling is not the relay's mechanism |
| Data model §5a table definition, retention, relay-role exception, cross-tenant audit | Tasks 1, 7, 10 |
| Data model §0 conventions, §1 tenancy primitives | Every migration; the two index-convention and PK-convention exceptions are named in place |
| Build sequence: S5a precedes S6a | Preconditions and Adoption item 2 |

**2. Placeholder scan**

No "TBD", "implement later", "add error handling", "similar to Task N", or code step without code. Three spots were rewritten rather than left as instructions to patch the plan's own code: Task 3's test now declares its own pool helper inline, since `relay-pool.ts` does not exist until Task 7; Task 8's `skipped: false` assertion is written plainly; and migration 042 carries `GRANT DELETE ON context.outbox_events TO outbox_relay` in the file itself, because `pruneOutbox` runs as that role and migration 041 grants only `SELECT` and `UPDATE`.

One duplication is deliberate and named where it occurs: the seven topic strings appear in `topics.ts`, in migration 040's CHECK, and in `infra/pubsub/create-topics.sh`. A shell script cannot import TypeScript and a CHECK constraint cannot import either, so two tests hold them together — `topics.db.test.ts` compares the union to the catalogue, and Task 6 Step 3 diffs the script against the union.

**3. Type consistency**

- `Scope` is `{ kind: "platform" | "org"; orgId: string }` in both apps and is the first parameter of `enqueueEvent`, `claimUnpublished`, `markPublished`, `markFailed`, `listEventsForOrg`, `consumeOnce` and `withTenantTransaction`.
- `OutboxRow` is declared once, in `ads-agent/lib/events/envelope.ts` (Task 4), and imported by `lib/db/outbox.ts` (Task 3) and `lib/events/relay.ts` (Task 7). The import direction is events → nothing, db → events, relay → both: no cycle.
- `Publisher` is `{ publish, resume, close }` in Task 5, and the fakes in Tasks 7 and 12 implement exactly those three members.
- `RelayTick` is `{ claimed, published, failed, deferred, deletionFailures }` in Task 7, and Task 12 reads only those fields.
- `OutboxHealth`'s six fields in Task 10 match `context.outbox_health`'s five columns plus `deadTuples` from `pg_stat_user_tables`, and `healthAlerts` reads only those.
- `ReconcileResult` is `{ republished, stalled }` in Task 9 and is read as such in Tasks 9 and 12.
- Topic strings are identical in `topics.ts`, migration 040's CHECK, `infra/pubsub/create-topics.sh`, and the listings app's narrower `ListingsOutboxTopic` union — the last is a subset, asserted by the database CHECK rather than by TypeScript, and Task 6 Step 3 diffs the script against the vocabulary.
