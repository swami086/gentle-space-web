# S8 Context Graph + S8a Artifact Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the context graph as node and edge **tables** in ClickHouse with per-tenant DuckDB snapshots under backpressure and IAM isolation (S8), and the self-hosted Garage artifact store with its Postgres index, erasure path and two divergence sweeps (S8a).

**Architecture:** Two independent subsystems that share nothing but the S3 signer. **S8a** puts payload bytes in Garage and queryable metadata in `context.artifacts`, writing bytes-then-row so a crash leaves reclaimable residue rather than a row pointing at nothing; erasure deletes bytes, *proves* they are gone with a `HEAD`, then tombstones the row and the deletion ledger in one transaction. **S8** derives `graph_node` and `graph_edge` in ClickHouse under a new `snapshot_id` per rebuild, exports one DuckDB file per tenant into a per-tenant Garage bucket readable only by that tenant's own access key, and gates rebuilds behind a slot-based concurrency ceiling with a coalescing debounce. Traversals are hand-written bounded-hop SQL behind named functions — there is no graph engine and no Cypher.

**Tech Stack:** PostgreSQL 18 (`uuidv7()`, RLS `FORCE`), ClickHouse (MergeTree + row policies, HTTP interface), DuckDB CLI, Garage v2 (S3 API + admin API v2), TypeScript, `pg`, Vitest. **No new npm dependencies:** SigV4 is `node:crypto`, both HTTP clients are `fetch`, and the DuckDB CLI is invoked with `execFile` — arguments as a list, shell disabled.

## Preconditions

| Step | Required before | Why |
|---|---|---|
| **S2** — database consolidation on PG18 | **all of S8a** | `context.artifacts` needs the `context` schema and `uuidv7()`. The artifact store is standalone infrastructure with no dependency on the graph or the agents (build sequence, "What can run in parallel"), so it needs nothing later than S2. |
| **S6** — ClickHouse mirror and CDC | **all of S8** | The graph is a curated projection derived from the CDC-fed mirror (datastore §6.3). No mirror, nothing to project. |
| **S3** — `Scope` and RLS | both | Every data-layer function here takes `Scope` first and every table carries a forced RLS policy. |

**S6 must have delivered these exact ClickHouse objects**, because the graph build reads them by name. If any is missing or differently named, stop and escalate rather than renaming inside this plan:

- CDC mirror tables `gentle_space.listings`, `gentle_space.corridors`, `gentle_space.listing_corridors`, `gentle_space.campaigns`, `gentle_space.enquiries`, `gentle_space.enquiry_requirements`, `gentle_space.enquiry_activities`, `gentle_space.contacts`
- the migration runner and the ClickHouse users, from `docs/superpowers/plans/2026-08-12-s6-s6a-clickhouse-portal-ingestion.md` Task 1: `lib/clickhouse/migrate.ts` exporting `applyMigrations`, the CLI `scripts/clickhouse/migrate.ts`, `lib/clickhouse/client.ts` exporting `chQuery`/`chExec`/`clickhouseConfig`, and the `etl_writer` / `tenant_reader` users in `infra/clickhouse/users.d/etl.xml`. **This plan writes no ClickHouse migration runner of its own** and adds only migration files under `infra/clickhouse/migrations/`.
- the custom-settings prefix that makes `getSetting('SQL_current_tenant_id')` legal, from S6/S6a's `infra/clickhouse/config.d/custom-settings.xml`. ClickHouse rejects unknown custom settings unless the prefix is declared, so the server config must contain:

```xml
<clickhouse>
    <custom_settings_prefixes>SQL_</custom_settings_prefixes>
</clickhouse>
```

**The `gentle_space` database is created by this plan**, in migration `010_graph_database`, because S6/S6a's `000_databases` creates only `analytics` and `raw`. If S6 turns out to have created `gentle_space` for its mirror tables under one of its own numbers, `010` is still correct and harmless — `CREATE DATABASE IF NOT EXISTS` is a no-op, and the runner's ledger means it is attempted exactly once either way. Do not delete `010` on that basis; a migration whose object already exists is fine, a database nobody owns is not.

## Global Constraints

Every task inherits these. Copied verbatim into every reviewer dispatch.

- **Every SQL object is schema-qualified.** The deployed role has `search_path = "ag_catalog, $user, public"`; an unqualified `CREATE TABLE` lands inside the AGE extension's schema.
- **Every schema change is a numbered up/down migration containing an explicit `ALTER`.** `ads-agent/lib/db/migrate.ts` re-runs `schema.sql`, and `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table, so anything expressed inside a `CREATE TABLE` body never reaches a provisioned database.
- **That rule is about the practice, not about PostgreSQL, so it binds ClickHouse identically.** Every ClickHouse object — database, table, row policy, materialised view, dictionary — is a numbered up/down pair in `infra/clickhouse/migrations/`, applied by S6/S6a's runner. No re-appliable DDL file and no second runner in either engine. A later column change is a new number with an `ALTER TABLE`, never an edit inside an existing migration.
- **`id UUID PRIMARY KEY DEFAULT uuidv7()`** on every new table (native in PostgreSQL 18), **`org_id UUID NOT NULL`** on every domain table, every index leads with `org_id`, and `TIMESTAMPTZ` never `TIMESTAMP`.
- **`set_config('app.current_tenant_id', $1, true)`** — the third argument is mandatory. Both apps use `pg.Pool`; without transaction scoping the setting persists on the connection and the next request inherits the previous tenant.
- **`ENABLE` *and* `FORCE ROW LEVEL SECURITY`** on every tenant table. Table owners ignore RLS unless it is forced.
- **Policies carry `WITH CHECK` as well as `USING`.** `USING` alone permits writing rows under another tenant's `org_id`.
- **Suppression columns, never `DELETE`.** DPDP Rule 8(3) imposes a one-year retention floor even after account deletion; erasure is suppression followed by scheduled hard delete.
- **Wrong tenant returns `404`, never `403`.** A 403 confirms the row exists.
- **`Scope` is the first and required parameter** of every data-layer function, so a missed call site is a TypeScript compile error rather than a silent full-table read.
- **No new dependencies** without asking.
- Tests are Vitest, colocated as `*.test.ts`, run with `npx vitest run` from the owning app directory.

### Additional constraints this plan's specs impose

- **The context graph is tables, not a graph engine** (datastore §6.1, UD6, revised 2026-08-12). No Cypher, no `CREATE PROPERTY GRAPH`, no `GRAPH_TABLE`. Traversals are SQL joins behind named functions (§9 mitigation).
- **Apache AGE is untouched.** AGE stays pinned in `docker/Dockerfile.postgres` and scoped to the existing listings-search boost in `lib/graph/age.ts`, `lib/graph/score.ts`, `lib/graph/rebuild.ts` and `scripts/check-graph-boost.ts` (root app, UD9). **No task in this plan may open any file under the root app's `lib/graph/`.** The new code lives in `ads-agent/lib/context-graph/` — a deliberately different directory in a different app, because conflating the two graphs is the easy mistake here.
- **Bytes to the object store first, then the Postgres row** (data model §8a). The reverse order leaves a row pointing at nothing, indistinguishable from corruption.
- **The `org_id` segment of a storage key comes from the server-resolved tenant, never from a request parameter** (datastore §13.1). A code path that builds a key without the tenant helper is the object store's equivalent of a missing `scopeClause`.
- **The artifact store never holds a copy of something already stored** (dataflow review A-3). No enquiry message bodies, no listing descriptions.
- **`evidence` holds identifiers only** (dataflow review A-4). Anything referencing an artifact carries `context.artifacts.id` as text, never prose and never a foreign key.
- **Snapshot storage is a tenancy boundary at the credential layer** (datastore §12.3), not only at the application layer.
- **Rebuild backpressure has numbers:** concurrency ceiling **2**, debounce window **300 s**, priority to tenants with a user active in the last **24 h**, generations kept **2** (datastore §12.2).
- **Every node and edge derived from an enquirer carries subject provenance** so erasure can prune it (datastore §11.2, validation F-18) — the `subject_ref` column on `graph_node`.
- **No cloud credentials in tests.** Garage runs locally from compose; ClickHouse comes from S6's local compose stack; DuckDB is a local binary.

## Migration numbers owned by this plan

### PostgreSQL — `ads-agent/lib/db/migrations/`

This plan owns **080–099** exclusively and uses six of them. Numbers outside the range are owned by other plans and must not be touched.

| # | Migration | Task | Reversible |
|---|---|---|---|
| 080 | `080_context_artifacts` | 2 | drop table |
| 081 | `081_deletion_ledger_objectstore` | 12 | drop tables |
| 082 | `082_artifact_sweep_state` | 13 | drop tables |
| 085 | `085_graph_manifest_backpressure` | 5 | drop columns and tables |
| 086 | `086_graph_snapshots_leases` | 8 | drop tables |
| 087 | `087_snapshot_tenant_storage` | 11 | drop table |

083, 084 and 088–099 stay free. Two tasks in the same wave never claim the same number.

### ClickHouse — `infra/clickhouse/migrations/`

**Every ClickHouse object this plan creates is a numbered, reversible migration too.** There is no re-appliable schema file anywhere in this plan, in either engine. The rule from §0 of the data model is about the *practice*, not about PostgreSQL: an object created by re-running a whole DDL file can never be altered afterwards, because the second edit silently skips any database that already has the object. ClickHouse is not exempt.

This plan owns **010–019** exclusively and uses five of them. S6/S6a owns `000`–`007` (`000_databases`, `001_enquiry_fact`, `002_portal_events`, `003_portal_event_ingest`, `004_portal_event_mv`, `005_portal_events_policy`, `006_portal_event_daily`, `007_search_performed_daily`) and must not be touched; `008`–`009` stay free for S6/S6a follow-ups.

| # | Migration | Task | Object | Reversible |
|---|---|---|---|---|
| 010 | `010_graph_database.{up,down}.sql` | 4 | database `gentle_space` | drop database |
| 011 | `011_graph_node.{up,down}.sql` | 4 | table `gentle_space.graph_node` | drop table |
| 012 | `012_graph_edge.{up,down}.sql` | 4 | table `gentle_space.graph_edge` | drop table |
| 013 | `013_graph_node_policy.{up,down}.sql` | 4 | row policy `graph_node_tenant` | drop policy |
| 014 | `014_graph_edge_policy.{up,down}.sql` | 4 | row policy `graph_edge_tenant` | drop policy |

015–019 stay free. **Why the database gets its own number rather than sitting at the top of `011_graph_node.up.sql`:** S6/S6a's `000_databases` creates `analytics` and `raw`, not `gentle_space`, so this plan has to create it — and a `CREATE DATABASE` bundled into the `graph_node` migration would have no honest `down`. Dropping the database in `011_graph_node.down.sql` would destroy `012`'s table; not dropping it would make the pair asymmetric. One object, one number, one real reverse.

**Row policies get numbers separate from their tables** because that is what a later policy change needs: `013` and `014` can be rolled back and re-applied without touching a table that holds data. S6/S6a set the same precedent with `005_portal_events_policy`.

## Interfaces consumed from earlier plans — import, never redefine

From `docs/superpowers/plans/2026-08-12-s1-s3-foundation.md`, in `ads-agent/lib/db/scope-sql.ts`:

```ts
export type Scope =
  | { kind: "platform"; orgId: string }   // Gentle Space staff; may read across orgs
  | { kind: "org"; orgId: string };       // external customer; hard-bounded to orgId

// Platform scope yields TRUE with no params; org scope yields `org_id = $n`.
export function scopeClause(scope: Scope, column?: string): { sql: string; params: unknown[] };
```

SQL: `public.set_tenant(uuid)` and `public.current_tenant()`. Schemas `listings`, `adsagent`, `context`, `public`, `derived`; roles `listings_rw`, `adsagent_rw`, `context_rw`, `shared_rw`, `derived_rw`, `agent_ro`. `public.lifecycle_state` and `public.org_ref` exist.

From `docs/superpowers/plans/2026-08-12-s5a-event-backbone.md` — the transactional outbox and its single enqueue helper, called with the *same* `PoolClient` as the domain write so the event cannot exist without its row:

```ts
// ads-agent/lib/events/topics.ts
export type OutboxTopic =
  | "enquiry.received" | "enquiry.activity_logged" | "graph.tenant_stale"
  | "agent.task_requested" | "reminder.due" | "deletion.requested" | "portal.event";

// ads-agent/lib/db/tx.ts -- "the only way a domain write and its event share a
// transaction". Org scope calls public.set_tenant; platform scope deliberately
// leaves the tenant unset, which is what a cross-tenant reader needs.
export function withTenantTransaction<T>(
  scope: Scope, fn: (client: PoolClient) => Promise<T>, pool?: Pool,
): Promise<T>;

// ads-agent/lib/db/outbox.ts
export type OutboxEventInput = { topic: OutboxTopic; payload: Record<string, unknown> };
export function enqueueEvent(
  scope: Scope, client: PoolClient, event: OutboxEventInput,
): Promise<string>;   // returns the event id; throws on platform scope
```

This plan calls `enqueueEvent` in exactly two places — the tenant-stale mark in Task 5 and the deletion-propagation write in Task 12 — and both go through `withTenantTransaction` under **org** scope, because `enqueueEvent` refuses platform scope by design. Every other transaction in this plan is worker-side and carries no event, so it uses `withTenantTransaction` under platform scope to leave the tenant unset for cross-tenant reads. Do not add a wrapper around either helper.

## Environment variables introduced

Add to `ads-agent/.env.local` and `ads-agent/.env.example`. Every value below is a local-development default that needs no cloud account.

```
GARAGE_S3_ENDPOINT=http://127.0.0.1:3900
GARAGE_REGION=garage
GARAGE_ADMIN_ENDPOINT=http://127.0.0.1:3903
GARAGE_ADMIN_TOKEN=dev-admin-token-change-me
ARTIFACT_ACCESS_KEY_ID=<printed by scripts/garage/bootstrap.sh>
ARTIFACT_SECRET_ACCESS_KEY=<printed by scripts/garage/bootstrap.sh>
ARTIFACT_BUCKET=gs-artifacts
ARTIFACT_ORPHAN_GRACE_SECONDS=3600
SNAPSHOT_STAGING_BUCKET=gs-graph-staging
SNAPSHOT_MASTER_KEY=<64 hex chars; openssl rand -hex 32>
SNAPSHOT_TTL_SECONDS=604800
SNAPSHOT_LEASE_SECONDS=300
CLICKHOUSE_URL=http://127.0.0.1:8123
# etl_writer, not default: the row policies created by migrations 013 and 014 are
# TO ALL EXCEPT etl_writer, matching S6/S6a's convention. The graph builder writes
# and prunes across tenants, so it has to be the excepted user. Password value comes
# from S6/S6a's infra/clickhouse/users.d/etl.xml.
CLICKHOUSE_USER=etl_writer
CLICKHOUSE_PASSWORD=etl
CLICKHOUSE_DATABASE=gentle_space
GRAPH_REBUILD_CEILING=2
GRAPH_REBUILD_DEBOUNCE_SECONDS=300
GRAPH_REBUILD_LEASE_SECONDS=900
DUCKDB_BIN=./.bin/duckdb
```

---

## File structure

Every file this plan creates or modifies, and what each is responsible for.

**S8a — artifact store**

| File | Responsibility |
|---|---|
| `docker-compose.garage.yml` | single-node Garage service, local volumes, S3 on 3900 and admin on 3903 |
| `docker/garage.toml` | Garage config: `replication_factor = 1`, sqlite metadata, `s3_region = garage` |
| `scripts/garage/bootstrap.sh` | layout assign/apply, create `gs-artifacts` and `gs-graph-staging`, create the server key, print credentials |
| `scripts/garage/bootstrap.test.ts` | static assertions that compose + config + bootstrap agree on ports, region and bucket names |
| `ads-agent/lib/db/migrations/080_context_artifacts.{up,down}.sql` | `context.artifacts`, indexes, forced RLS, the key-carries-tenant CHECK |
| `ads-agent/lib/db/migrations/migration-assertions.ts` | shared test helper: read a migration, assert tenant-table hardening |
| `ads-agent/lib/artifacts/key.ts` | the tenant key helper — the only way a storage key is ever built |
| `ads-agent/lib/objectstore/sigv4.ts` | AWS SigV4 request signing over `node:crypto` |
| `ads-agent/lib/objectstore/client.ts` | `ObjectStore`: put/get/head/remove/list against any S3-compatible endpoint |
| `ads-agent/lib/objectstore/garage-admin.ts` | Garage admin API v2: create bucket, create key, grant, delete |
| `ads-agent/lib/artifacts/store.ts` | `putArtifact` / `getArtifact` / `listArtifactsForSubject`, bytes-first write order |
| `ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.{up,down}.sql` | `context.deletion_requests`, `context.deletion_propagations`, `objectstore` vocabulary |
| `ads-agent/lib/artifacts/erase.ts` | per-subject and per-tenant erasure, with byte-absence proof |
| `ads-agent/lib/db/migrations/082_artifact_sweep_state.{up,down}.sql` | `context.artifact_sweep_runs`, `context.artifact_dangling_flags` |
| `ads-agent/lib/artifacts/sweeps.ts` | orphan sweep (deletes) and dangling sweep (flags, never deletes) |
| `ads-agent/scripts/artifact-sweeps.ts` | cron entry point for both sweeps |
| `ads-agent/lib/artifacts/erasure.integration.test.ts` | the S8a gate: write, read, erase, prove no bytes remain |

**S8 — context graph**

| File | Responsibility |
|---|---|
| `ads-agent/lib/context-graph/clickhouse.ts` | ClickHouse HTTP client, tenant setting, bound query parameters |
| `infra/clickhouse/migrations/010_graph_database.{up,down}.sql` | database `gentle_space` |
| `infra/clickhouse/migrations/011_graph_node.{up,down}.sql` | table `gentle_space.graph_node` |
| `infra/clickhouse/migrations/012_graph_edge.{up,down}.sql` | table `gentle_space.graph_edge` |
| `infra/clickhouse/migrations/013_graph_node_policy.{up,down}.sql` | row policy `graph_node_tenant` |
| `infra/clickhouse/migrations/014_graph_edge_policy.{up,down}.sql` | row policy `graph_edge_tenant` |
| `lib/clickhouse/graph-schema.test.ts` | asserts `010`–`014` apply cleanly, are idempotent, and are each reversible |
| `ads-agent/lib/db/migrations/085_graph_manifest_backpressure.{up,down}.sql` | `context.graph_manifests` columns, `context.rebuild_slots` |
| `ads-agent/lib/context-graph/backpressure.ts` | `markTenantStale`, `claimRebuild`, `finishRebuild`, `failRebuild` |
| `ads-agent/lib/context-graph/build.ts` | node/edge derivation statements plus the pgvector similarity hop |
| `ads-agent/lib/context-graph/traverse.ts` | the named traversals: `convertingCorridors`, `substituteSpaces`, `corridorAncestors` |
| `ads-agent/lib/db/migrations/086_graph_snapshots_leases.{up,down}.sql` | `context.graph_snapshots`, `context.snapshot_leases` |
| `ads-agent/lib/context-graph/snapshot-lease.ts` | record, lease, and generation-based collection |
| `ads-agent/lib/db/migrations/087_snapshot_tenant_storage.{up,down}.sql` | `context.snapshot_storage` — per-tenant bucket, reader key, sealed data key |
| `ads-agent/lib/context-graph/envelope.ts` | AES-256-GCM seal/open under `SNAPSHOT_MASTER_KEY` |
| `ads-agent/lib/context-graph/snapshot-iam.ts` | provision per-tenant bucket + read-only key, reader credentials, key destruction |
| `ads-agent/lib/context-graph/snapshot-export.ts` | ClickHouse → Parquet → DuckDB file → per-tenant bucket |
| `ads-agent/scripts/graph-rebuild-worker.ts` | the debounced rebuild worker loop |
| `scripts/install-duckdb.sh` | fetch the official DuckDB CLI into `./.bin`, so no npm dependency is added |
| `ads-agent/lib/context-graph/backpressure.storm.test.ts` | S8 gate: a rebuild storm stays bounded |
| `ads-agent/lib/context-graph/snapshot-iam.integration.test.ts` | S8 gate: tenant A's key cannot read tenant B's bucket |
| `ads-agent/lib/context-graph/traverse.integration.test.ts` | S8 gate: the first traversal query answers correctly |

---

## Parallel execution model

`superpowers:subagent-driven-development` lists "dispatch multiple implementation subagents in parallel" under **Never**, because agents sharing a working tree corrupt each other. Real parallelism therefore means **one git worktree and one branch per agent**, dispatched as the `best-of-n-runner` subagent type, with an explicit fan-in merge task closing each wave. Ceiling of **8 concurrent implementation subagents**; the widest wave here is 5.

This plan parallelises unusually well because the two subsystems genuinely share nothing. The proof is the file lists: **no file appears in two tasks of the same wave, and no two tasks in a wave claim the same migration number.**

| Wave | Tasks | Width | Why that width |
|---|---|---|---|
| **W1** | 1, 2, 3, 4, 5 | **5** | Five root nodes of the dependency graph. Disjoint file sets: T1 `docker-compose.garage.yml` + `docker/garage.toml` + `scripts/garage/*`; T2 `migrations/080*` + `migrations/migration-assertions.ts` + `lib/artifacts/key.ts`; T3 `lib/objectstore/sigv4.ts`; T4 `ads-agent/lib/context-graph/clickhouse.ts` + `infra/clickhouse/migrations/010_*`–`014_*` + `lib/clickhouse/graph-schema.test.ts`; T5 `migrations/085*` + `lib/context-graph/backpressure.ts`. PostgreSQL migration numbers 080 and 085 are distinct, and T4 is the only task in this plan that writes a ClickHouse migration, so its `010`–`014` cannot collide with anything. T4 is the only W1 task that touches the root app or `infra/clickhouse/`. |
| **W1-fan-in** | merge | 1 | one worktree; resolve `ads-agent/.env.example`, the only file two of the five agents both append to |
| **W2** | 6, 7, 8 | **3** | T6 `lib/objectstore/client.ts` needs T3's signer. T7 `lib/context-graph/build.ts` needs T4's client. T8 `migrations/086*` + `lib/context-graph/snapshot-lease.ts` needs T5's `context.graph_manifests`. Three disjoint file sets; only T8 claims a migration number. |
| **W2-fan-in** | merge | 1 | fan-in gate |
| **W3** | 9, 10, 11 | **3** | T9 `lib/artifacts/store.ts` needs T2 + T6. T10 `lib/context-graph/traverse.ts` needs T4 + T7. T11 `lib/objectstore/garage-admin.ts` + `lib/context-graph/envelope.ts` + `lib/context-graph/snapshot-iam.ts` + `migrations/087*` needs T1 + T6. Disjoint; only T11 claims a migration number. |
| **W3-fan-in** | merge | 1 | fan-in gate |
| **W4** | 12, 13, 14 | **3** | T12 `migrations/081*` + `lib/artifacts/erase.ts` needs T9. T13 `migrations/082*` + `lib/artifacts/sweeps.ts` + `scripts/artifact-sweeps.ts` needs T9. T14 `lib/context-graph/snapshot-export.ts` + `scripts/graph-rebuild-worker.ts` + `scripts/install-duckdb.sh` needs T7 + T8 + T11. T12 and T13 both *import from* `lib/artifacts/store.ts` but neither modifies it; T12 claims 081 and T13 claims 082, so no number collision. |
| **W5** | 15 | 1 | fan-in merge of W4 plus the **S8a gate** — needs every artifact module in one tree |
| **W6** | 16 | 1 | the **S8 gates** — traversal, IAM isolation, storm bound, AGE non-regression. Sequential after W5 because they run against one live stack. |
| **W7** | 17 | 1 | final adversarial review over the whole branch |

**Why no wider.** W2–W4 are capped at 3 by the dependency graph, not by preference: every W2 task consumes a W1 output, and the artifact chain (T2 → T6 → T9 → T12/T13) and the snapshot chain (T4 → T7 → T14) are each genuinely serial. Dispatching 8 would mean starting tasks whose imports do not yet exist.

**Per-task skills and model.** `**Model:** composer-2.5-fast` when this plan already contains the code to write (mechanical transcription plus running tests); `**Model:** inherit` when the task needs judgement — live-stack debugging, deciding what a failing integration test means, or reviewing. Those are the only two slugs.

---

# S8a — the artifact store

Standalone infrastructure. Nothing below depends on the graph or on agents.

## Task 1: Garage runs locally, with buckets and keys

**Files:**
- Create: `docker-compose.garage.yml`
- Create: `docker/garage.toml`
- Create: `scripts/garage/bootstrap.sh`
- Test: `scripts/garage/bootstrap.test.ts`
- Modify: `ads-agent/.env.example` (append the `GARAGE_*` and `ARTIFACT_*` block from "Environment variables introduced")

**Skills:** `senior-devops`, `docker-expert`
**Model:** composer-2.5-fast

**Interfaces:**
- Consumes: nothing.
- Produces: an S3 endpoint at `http://127.0.0.1:3900` in region `garage`, an admin endpoint at `http://127.0.0.1:3903` authenticated by `Bearer $GARAGE_ADMIN_TOKEN`, buckets `gs-artifacts` and `gs-graph-staging`, and a server key with read+write+owner on both. Tasks 6, 9 and 11 all target this endpoint.

**Context:** Garage is a single Rust binary that treats single-node deployment as a first-class case rather than a degraded mode (datastore §13.1) — which is why it was chosen over SeaweedFS's three processes. MinIO is not an option: the open-source repository was archived on 13 February 2026, so adopting it means adopting a permanently unpatched network service. Garage is AGPL-3.0; unmodified upstream used as internal infrastructure satisfies the network clause, and brokers interact with the portal, never with Garage's S3 API.

Pin **v2.x**: admin API v2 arrived in Garage v2.0.0 and `replication_factor` replaced `replication_mode` in v1.0. Task 11's admin calls are v2 shapes and will 404 against a v1 binary.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/garage/bootstrap.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("garage local stack", () => {
  it("pins a v2 image, because task 11 calls admin API v2", () => {
    expect(read("docker-compose.garage.yml")).toMatch(/image:\s*dxflrs\/garage:v2\./);
  });

  it("exposes the S3 and admin ports the app expects", () => {
    const cfg = read("docker/garage.toml");
    expect(cfg).toContain('api_bind_addr = "[::]:3900"');
    expect(cfg).toContain('api_bind_addr = "[::]:3903"');
  });

  it("mounts the config and persists both metadata and data", () => {
    const compose = read("docker-compose.garage.yml");
    expect(compose).toContain("docker/garage.toml:/etc/garage.toml");
    expect(compose).toContain("garage_meta:/var/lib/garage/meta");
    expect(compose).toContain("garage_data:/var/lib/garage/data");
  });

  it("declares single-node replication and the region the signer signs for", () => {
    const cfg = read("docker/garage.toml");
    expect(cfg).toContain("replication_factor = 1");
    expect(cfg).toContain('s3_region = "garage"');
    expect(cfg).toMatch(/\[admin\][\s\S]*admin_token/);
  });

  it("bootstraps exactly the two buckets the app names", () => {
    const sh = read("scripts/garage/bootstrap.sh");
    expect(sh).toContain("bucket create gs-artifacts");
    expect(sh).toContain("bucket create gs-graph-staging");
    expect(sh).toContain("layout apply");
    expect(sh).toContain("key create");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/garage/bootstrap.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../docker-compose.garage.yml'`

- [ ] **Step 3: Write the config and compose file**

```toml
# docker/garage.toml
# Single-node development configuration. Production values (rpc_secret,
# admin_token) come from the deployment secret store, not from this file.
metadata_dir = "/var/lib/garage/meta"
data_dir     = "/var/lib/garage/data"
db_engine    = "sqlite"

replication_factor = 1

rpc_bind_addr   = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
# Development only. Regenerate with: openssl rand -hex 32
rpc_secret = "4f3a1c8e9b2d7f60a51e8c4d3b9f7a2e6c1d8b5f0a3e7c9d2b4f6a8e0c1d3b5f"

[s3_api]
# The signer in ads-agent/lib/objectstore/sigv4.ts signs for exactly this region.
s3_region     = "garage"
api_bind_addr = "[::]:3900"
root_domain   = ".s3.garage.localhost"

[admin]
api_bind_addr = "[::]:3903"
admin_token   = "dev-admin-token-change-me"
metrics_token = "dev-metrics-token-change-me"
```

```yaml
# docker-compose.garage.yml
services:
  garage:
    image: dxflrs/garage:v2.1.0
    container_name: gentle-space-garage
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./docker/garage.toml:/etc/garage.toml:ro
      - garage_meta:/var/lib/garage/meta
      - garage_data:/var/lib/garage/data

volumes:
  garage_meta:
  garage_data:
```

`network_mode: host` keeps the RPC public address, the S3 endpoint and the admin endpoint in one address space, which avoids Garage's usual first-run failure where `rpc_public_addr` is unreachable from inside the container network. The ports therefore come from `garage.toml` rather than from a compose `ports:` list, which is what the port test above asserts.

- [ ] **Step 4: Write the bootstrap script**

```bash
#!/usr/bin/env bash
# scripts/garage/bootstrap.sh
# Idempotent: safe to re-run against an already-bootstrapped cluster.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.garage.yml}"
KEY_NAME="${KEY_NAME:-gs-server}"
g() { docker compose -f "$COMPOSE_FILE" exec -T garage /garage "$@"; }

echo "==> waiting for garage to answer"
for _ in $(seq 1 30); do
  if g status >/dev/null 2>&1; then break; fi
  sleep 1
done

NODE_ID="$(g status | awk '/^[0-9a-f]{16}/ { print $1; exit }')"
if [ -z "$NODE_ID" ]; then
  echo "could not read a node id from 'garage status'" >&2
  exit 1
fi
echo "==> node ${NODE_ID}"

# A node with no assigned capacity accepts no writes. Re-assigning an already
# assigned node is a no-op, so this stays idempotent.
g layout assign -z dc1 -c 10G "$NODE_ID" || true
LAYOUT_VERSION="$(g layout show | awk '/Current cluster layout version/ { print $NF }')"
g layout apply --version "$(( ${LAYOUT_VERSION:-0} + 1 ))" || true

echo "==> buckets"
g bucket create gs-artifacts     || true
g bucket create gs-graph-staging || true

echo "==> server key"
if ! g key info "$KEY_NAME" >/dev/null 2>&1; then
  g key create "$KEY_NAME"
fi
# create-bucket permission is what lets task 11 provision per-tenant snapshot
# buckets through the admin API without a second credential.
g key allow --create-bucket "$KEY_NAME" || true
g bucket allow --read --write --owner gs-artifacts     --key "$KEY_NAME"
g bucket allow --read --write --owner gs-graph-staging --key "$KEY_NAME"

echo
echo "==> put these in ads-agent/.env.local"
g key info "$KEY_NAME" --show-secret \
  | awk '/Key ID/ { print "ARTIFACT_ACCESS_KEY_ID=" $NF }
         /Secret key/ { print "ARTIFACT_SECRET_ACCESS_KEY=" $NF }'
```

- [ ] **Step 5: Bring it up and verify by hand**

```bash
chmod +x scripts/garage/bootstrap.sh
docker compose -f docker-compose.garage.yml up -d
./scripts/garage/bootstrap.sh
```

Expected: `==> put these in ads-agent/.env.local` followed by two `KEY=value` lines. Then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3903/health
curl -s -H 'Authorization: Bearer dev-admin-token-change-me' \
  'http://127.0.0.1:3903/v2/ListBuckets'
```

Expected: `200`, then a JSON array whose `globalAliases` include `gs-artifacts` and `gs-graph-staging`.

- [ ] **Step 6: Append the env block and commit**

Append the `GARAGE_*`, `ARTIFACT_*` and `SNAPSHOT_*` lines from "Environment variables introduced" to `ads-agent/.env.example`, leaving the two secret values as `<printed by scripts/garage/bootstrap.sh>`.

Run: `npx vitest run scripts/garage/bootstrap.test.ts`
Expected: PASS (5 tests)

```bash
git add docker-compose.garage.yml docker/garage.toml scripts/garage/ ads-agent/.env.example
git commit -m "feat(objectstore): run Garage locally with artifact and staging buckets

Self-hosted S3 replaces Firestore (datastore §13.1). Pinned to v2.x because
the per-tenant snapshot provisioning in S8 calls admin API v2, which does not
exist on v1 binaries."
```

## Task 2: `context.artifacts` and the tenant key helper

**Files:**
- Create: `ads-agent/lib/db/migrations/080_context_artifacts.up.sql`
- Create: `ads-agent/lib/db/migrations/080_context_artifacts.down.sql`
- Create: `ads-agent/lib/db/migrations/migration-assertions.ts`
- Create: `ads-agent/lib/db/migrations/080_context_artifacts.test.ts`
- Create: `ads-agent/lib/artifacts/key.ts`
- Create: `ads-agent/lib/artifacts/key.test.ts`

**Skills:** `postgres-pro`, `database-designer`
**Model:** composer-2.5-fast

**Interfaces:**
- Consumes: `type Scope` from `ads-agent/lib/db/scope-sql.ts`.
- Produces:
  - `context.artifacts` per data model §8a, with forced RLS and a CHECK that makes a mis-prefixed key unstorable.
  - `ads-agent/lib/artifacts/key.ts` exporting `ARTIFACT_CONTENT_TYPES`, `type ArtifactContentType`, `tenantPrefix(scope: Scope): string`, `artifactStorageKey(scope: Scope, contentType: ArtifactContentType, artifactId: string): string`, `orgIdFromKey(key: string): string | null`. Tasks 9, 12 and 15 import these.
  - `ads-agent/lib/db/migrations/migration-assertions.ts` exporting `readMigration(name: string): string` and `assertTenantTableHardening(sql: string, qualifiedTable: string): void`. Tasks 5, 8, 11, 12 and 13 import both.

**Context:** The split between object store and Postgres is not a preference. An object store has no query API — only `GET` by key and prefix listing — and erasure has to answer *"every artifact mentioning this person"*. That question needs an index, and the index has to commit in the same transaction as the deletion ledger.

The `artifacts_key_carries_tenant` CHECK below is the load-bearing part. Datastore §13.1 says "a code path that builds a key without the tenant helper is the object store's equivalent of a missing `scopeClause`" and that the accessor checks the prefix on every read. A CHECK constraint makes the bad key unstorable in the first place, which is strictly stronger than checking on read.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/artifacts/key.test.ts
import { describe, it, expect } from "vitest";
import {
  ARTIFACT_CONTENT_TYPES, artifactStorageKey, orgIdFromKey, tenantPrefix,
} from "./key";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const ID = "22222222-2222-2222-2222-222222222222";
const scope: Scope = { kind: "org", orgId: ORG };

describe("artifactStorageKey", () => {
  it("builds artifacts/{org_id}/{content_type}/{id}", () => {
    expect(artifactStorageKey(scope, "draft", ID)).toBe(`artifacts/${ORG}/draft/${ID}`);
  });

  it("covers exactly the five content types the CHECK constraint allows", () => {
    expect([...ARTIFACT_CONTENT_TYPES]).toEqual([
      "talking_points", "draft", "context_pack", "trace_payload", "call_recording",
    ]);
  });

  it("refuses an org id that is not a uuid, so a request param cannot become a prefix", () => {
    expect(() => artifactStorageKey({ kind: "org", orgId: "../other" }, "draft", ID)).toThrow(/uuid/);
  });

  it("refuses an artifact id that is not a uuid", () => {
    expect(() => artifactStorageKey(scope, "draft", "../../etc/passwd")).toThrow(/uuid/);
  });

  it("refuses a content type outside the vocabulary", () => {
    expect(() => artifactStorageKey(scope, "audio" as never, ID)).toThrow(/content type/);
  });
});

describe("orgIdFromKey", () => {
  it("recovers the tenant from a key it built", () => {
    expect(orgIdFromKey(artifactStorageKey(scope, "context_pack", ID))).toBe(ORG);
  });

  it("returns null for a traversal attempt", () => {
    expect(orgIdFromKey("artifacts/../draft/x")).toBeNull();
  });

  it("returns null for a key with no tenant segment", () => {
    expect(orgIdFromKey("artifacts/draft/x")).toBeNull();
  });
});

describe("tenantPrefix", () => {
  it("is the prefix a tenant-offboarding delete targets", () => {
    expect(tenantPrefix(scope)).toBe(`artifacts/${ORG}/`);
  });
});
```

```ts
// ads-agent/lib/db/migrations/080_context_artifacts.test.ts
import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("080_context_artifacts.up.sql");

describe("080_context_artifacts", () => {
  it("hardens the table: enabled, forced, USING and WITH CHECK", () => {
    expect(() => assertTenantTableHardening(up, "context.artifacts")).not.toThrow();
  });

  it("uses uuidv7 and TIMESTAMPTZ throughout", () => {
    expect(up).toContain("DEFAULT uuidv7()");
    expect(up).not.toMatch(/TIMESTAMP(?!TZ)/);
  });

  it("makes a mis-prefixed storage key unstorable", () => {
    expect(up).toContain("artifacts_key_carries_tenant");
    expect(up).toContain("storage_key = 'artifacts/' || org_id::text");
  });

  it("indexes subject_refs for per-subject erasure", () => {
    expect(up).toMatch(/USING GIN \(subject_refs\)/);
  });

  it("leads its btree indexes with org_id", () => {
    for (const match of up.matchAll(/CREATE INDEX[^;]*?\(([^)]*)\)/g)) {
      if (match[0].includes("GIN")) continue;
      expect(match[1].trim(), match[0]).toMatch(/^org_id/);
    }
  });

  it("has a down migration that drops what the up created", () => {
    const down = readMigration("080_context_artifacts.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.artifacts");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/artifacts/key.test.ts lib/db/migrations/080_context_artifacts.test.ts`
Expected: FAIL — `Failed to resolve import "./key"` and `Failed to resolve import "./migration-assertions"`

- [ ] **Step 3: Write the shared migration assertions helper**

```ts
// ads-agent/lib/db/migrations/migration-assertions.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readMigration(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

/**
 * Throws unless the migration enables RLS, forces it, and creates a policy with
 * both USING and WITH CHECK. ENABLE without FORCE is ignored for table owners,
 * and USING without WITH CHECK permits writing another tenant's org_id.
 */
export function assertTenantTableHardening(sql: string, qualifiedTable: string): void {
  const t = qualifiedTable.replace(/\./g, "\\.");
  const checks: Array<[string, RegExp]> = [
    ["ENABLE ROW LEVEL SECURITY",
      new RegExp(`ALTER\\s+TABLE\\s+${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i")],
    ["FORCE ROW LEVEL SECURITY",
      new RegExp(`ALTER\\s+TABLE\\s+${t}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i")],
    ["a policy on the table",
      new RegExp(`CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+${t}`, "i")],
    ["USING (org_id = public.current_tenant())",
      /USING\s*\(\s*org_id\s*=\s*public\.current_tenant\(\)\s*\)/i],
    ["WITH CHECK (org_id = public.current_tenant())",
      /WITH\s+CHECK\s*\(\s*org_id\s*=\s*public\.current_tenant\(\)\s*\)/i],
  ];
  const missing = checks.filter(([, re]) => !re.test(sql)).map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(`${qualifiedTable} is not hardened; missing: ${missing.join(", ")}`);
  }
}
```

- [ ] **Step 4: Write the key helper**

```ts
// ads-agent/lib/artifacts/key.ts
import type { Scope } from "../db/scope-sql";

/** Exactly the vocabulary of context.artifacts.content_type (data model §8a). */
export const ARTIFACT_CONTENT_TYPES = [
  "talking_points",
  "draft",
  "context_pack",
  "trace_payload",
  "call_recording",
] as const;

export type ArtifactContentType = (typeof ARTIFACT_CONTENT_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The prefix a tenant-offboarding delete targets: artifacts/{org_id}/ */
export function tenantPrefix(scope: Scope): string {
  if (!UUID.test(scope.orgId)) {
    throw new Error(`tenantPrefix: orgId is not a uuid: ${scope.orgId}`);
  }
  return `artifacts/${scope.orgId}/`;
}

/**
 * The only way a storage key is ever built. The org segment comes from the
 * server-resolved scope, never from a request parameter (datastore §13.1).
 */
export function artifactStorageKey(
  scope: Scope,
  contentType: ArtifactContentType,
  artifactId: string,
): string {
  if (!(ARTIFACT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new Error(`artifactStorageKey: unknown content type: ${contentType}`);
  }
  if (!UUID.test(artifactId)) {
    throw new Error(`artifactStorageKey: artifactId is not a uuid: ${artifactId}`);
  }
  return `${tenantPrefix(scope)}${contentType}/${artifactId}`;
}

/** The tenant a key claims, or null if it does not claim one properly. */
export function orgIdFromKey(key: string): string | null {
  const match = /^artifacts\/([^/]+)\//.exec(key);
  if (!match || !UUID.test(match[1])) return null;
  return match[1];
}
```

- [ ] **Step 5: Write migration 080**

```sql
-- ads-agent/lib/db/migrations/080_context_artifacts.up.sql
-- context.artifacts: the queryable index over payload bytes held in Garage.
-- Data model §8a. Every column is asserted with an explicit ALTER because
-- CREATE TABLE IF NOT EXISTS is a no-op against an existing table.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.artifacts (
  id      UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id  UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.artifacts
  ADD COLUMN IF NOT EXISTS storage_key  TEXT,
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS media_type   TEXT NOT NULL DEFAULT 'application/json',
  ADD COLUMN IF NOT EXISTS byte_size    BIGINT,
  -- sha256 of the bytes: detects silent corruption and divergence between stores.
  ADD COLUMN IF NOT EXISTS checksum     TEXT,
  ADD COLUMN IF NOT EXISTS subject_refs UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS erase_after  TIMESTAMPTZ,
  -- Set when the bytes are gone. The row survives as a tombstone so a dangling
  -- reference renders "content erased" instead of an unexplained 404.
  ADD COLUMN IF NOT EXISTS erased_at    TIMESTAMPTZ;

ALTER TABLE context.artifacts
  ALTER COLUMN storage_key  SET NOT NULL,
  ALTER COLUMN content_type SET NOT NULL,
  ALTER COLUMN byte_size    SET NOT NULL,
  ALTER COLUMN checksum     SET NOT NULL,
  ALTER COLUMN erase_after  SET NOT NULL;

ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_storage_key_unique;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_storage_key_unique UNIQUE (storage_key);

ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_content_type_check;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_content_type_check CHECK (content_type IN
    ('talking_points','draft','context_pack','trace_payload','call_recording'));

-- A key built without the tenant helper is the object store's missing
-- scopeClause. This makes such a key unstorable rather than merely detectable.
ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_key_carries_tenant;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_key_carries_tenant CHECK (
    storage_key = 'artifacts/' || org_id::text || '/' || content_type || '/' || id::text);

-- Per-subject erasure: "every artifact mentioning this person". A GIN
-- containment index cannot lead with org_id without btree_gin, which would be a
-- new extension; data model §8a specifies this exact index, and RLS still bounds
-- the rows the query can see.
CREATE INDEX IF NOT EXISTS artifacts_subject_refs_idx
  ON context.artifacts USING GIN (subject_refs);

-- Retention sweep. Leads with org_id per the tenant-index rule, which means the
-- sweep iterates tenants -- correct anyway, since erasure is a per-tenant duty.
CREATE INDEX IF NOT EXISTS artifacts_retention_idx
  ON context.artifacts (org_id, erase_after) WHERE erased_at IS NULL;

CREATE INDEX IF NOT EXISTS artifacts_org_kind_created_idx
  ON context.artifacts (org_id, content_type, created_at DESC);

ALTER TABLE context.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.artifacts FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.artifacts;
CREATE POLICY tenant_isolation ON context.artifacts
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- The two sweeps and the rebuild worker read across tenants by design, exactly
-- as the outbox relay does (data model §5a). A named policy for a named role,
-- never BYPASSRLS, so the exception is visible in pg_policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.artifacts TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifacts;
CREATE POLICY maintenance_cross_tenant ON context.artifacts
  TO context_maintenance
  USING (true) WITH CHECK (true);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/080_context_artifacts.down.sql
BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifacts;
DROP POLICY IF EXISTS tenant_isolation ON context.artifacts;
DROP TABLE IF EXISTS context.artifacts;
-- context_maintenance is left in place: migrations 081-087 also grant on it, so
-- dropping it here would break their down path.
COMMIT;
```

- [ ] **Step 6: Run tests, apply the migration, commit**

Run: `cd ads-agent && npx vitest run lib/artifacts/key.test.ts lib/db/migrations/080_context_artifacts.test.ts`
Expected: PASS (14 tests)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ads-agent/lib/db/migrations/080_context_artifacts.up.sql
psql "$DATABASE_URL" -c "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'context.artifacts'::regclass"
```

Expected: `t | t`. Then prove the CHECK bites:

```bash
psql "$DATABASE_URL" -c "INSERT INTO context.artifacts (org_id, storage_key, content_type, byte_size, checksum, erase_after) VALUES ('11111111-1111-1111-1111-111111111111','artifacts/other/draft/x','draft',1,'x', now())"
```

Expected: `ERROR: new row for relation "artifacts" violates check constraint "artifacts_key_carries_tenant"`

```bash
git add ads-agent/lib/db/migrations/ ads-agent/lib/artifacts/
git commit -m "feat(artifacts): context.artifacts index and the tenant key helper

Bytes live in Garage; this is the queryable metadata erasure needs, since an
object store answers only GET-by-key and prefix listing. A CHECK constraint
makes a key whose prefix disagrees with the row's org_id unstorable."
```

## Task 3: AWS SigV4 request signing

**Files:**
- Create: `ads-agent/lib/objectstore/sigv4.ts`
- Create: `ads-agent/lib/objectstore/sigv4.test.ts`

**Skills:** `typescript-pro`, `security-engineer`
**Model:** composer-2.5-fast

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type S3Credentials = {
  endpoint: string; region: string; accessKeyId: string; secretAccessKey: string;
};
export type S3RequestSpec = {
  method: "GET" | "PUT" | "HEAD" | "DELETE" | "POST";
  bucket: string;
  key?: string;                         // raw, un-encoded
  query?: Record<string, string>;
  body?: Uint8Array;
};
export type SignedRequest = { url: string; headers: Record<string, string> };
export function uriEncode(value: string, encodeSlash: boolean): string;
export function signS3Request(
  spec: S3RequestSpec, creds: S3Credentials, now?: Date,
): SignedRequest;
```

Task 6 wraps this; Task 11 reuses it with per-tenant credentials.

**Context:** Reaching an S3 endpoint needs SigV4, and adding an AWS SDK would be a new dependency for one signing function. This is roughly sixty lines over `node:crypto`, which is the lazier trade.

Two traps to write around. First, **double encoding**: `spec.key` is the raw key and the canonical URI encodes it exactly once, which is why this function takes bucket and key separately instead of a pre-built URL. Second, **the `host` header must include the port** — Garage listens on 3900, and signing `127.0.0.1` while sending `127.0.0.1:3900` produces `SignatureDoesNotMatch` with no hint as to why.

The golden values in the test below were computed from this exact algorithm. They are a known-answer check: any refactor that changes canonicalisation breaks them.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/objectstore/sigv4.test.ts
import { describe, it, expect } from "vitest";
import { signS3Request, uriEncode, type S3Credentials } from "./sigv4";

const creds: S3Credentials = {
  endpoint: "http://127.0.0.1:3900",
  region: "garage",
  accessKeyId: "GKtestaccesskey",
  secretAccessKey: "testsecretkey",
};
const AT = new Date("2026-08-12T08:30:00.000Z");
const KEY =
  "artifacts/11111111-1111-1111-1111-111111111111/draft/22222222-2222-2222-2222-222222222222";

describe("uriEncode", () => {
  it("leaves unreserved characters alone", () => {
    expect(uriEncode("aZ0-._~", true)).toBe("aZ0-._~");
  });
  it("keeps slashes in a path and encodes them in a query value", () => {
    expect(uriEncode("a/b", false)).toBe("a/b");
    expect(uriEncode("a/b", true)).toBe("a%2Fb");
  });
  it("percent-encodes per UTF-8 byte", () => {
    expect(uriEncode("é", true)).toBe("%C3%A9");
  });
});

describe("signS3Request", () => {
  it("signs a GET with the documented canonical form", () => {
    const signed = signS3Request({ method: "GET", bucket: "gs-artifacts", key: KEY }, creds, AT);
    expect(signed.url).toBe(`http://127.0.0.1:3900/gs-artifacts/${KEY}`);
    expect(signed.headers["x-amz-date"]).toBe("20260812T083000Z");
    expect(signed.headers["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(signed.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=GKtestaccesskey/20260812/garage/s3/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        "Signature=d41bc96ced9cec7acf644a51e0aa95faa7b7a2b60f4e94419bf697fe02e60a78",
    );
  });

  it("signs the payload hash, so the body changes the signature", () => {
    const signed = signS3Request(
      { method: "PUT", bucket: "gs-artifacts", key: KEY, body: new TextEncoder().encode("hello") },
      creds,
      AT,
    );
    expect(signed.headers["x-amz-content-sha256"]).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(signed.headers.Authorization).toContain(
      "Signature=a8f17e081ff5365ab9afcd27741f3fe0929b238afdd0a08c96950f4fb23424bd",
    );
  });

  it("canonicalises a sorted, encoded query string", () => {
    const signed = signS3Request(
      {
        method: "GET",
        bucket: "gs-artifacts",
        query: { "list-type": "2", prefix: "artifacts/11111111-1111-1111-1111-111111111111/" },
      },
      creds,
      AT,
    );
    expect(signed.url).toBe(
      "http://127.0.0.1:3900/gs-artifacts?list-type=2&prefix=artifacts%2F11111111-1111-1111-1111-111111111111%2F",
    );
    expect(signed.headers.Authorization).toContain(
      "Signature=5a1ea5912128b4448edba31ff9ce5a1812373ca8b0a410533b31351d30556245",
    );
  });

  it("signs the host including the port, which is what Garage receives", () => {
    const signed = signS3Request({ method: "GET", bucket: "gs-artifacts", key: KEY }, creds, AT);
    expect(signed.headers.host).toBe("127.0.0.1:3900");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/objectstore/sigv4.test.ts`
Expected: FAIL — `Failed to resolve import "./sigv4"`

- [ ] **Step 3: Write the signer**

```ts
// ads-agent/lib/objectstore/sigv4.ts
import { createHash, createHmac } from "node:crypto";

export type S3Credentials = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type S3RequestSpec = {
  method: "GET" | "PUT" | "HEAD" | "DELETE" | "POST";
  bucket: string;
  /** Raw, un-encoded object key. Encoding happens here, exactly once. */
  key?: string;
  query?: Record<string, string>;
  body?: Uint8Array;
};

export type SignedRequest = { url: string; headers: Record<string, string> };

const UNRESERVED = /[A-Za-z0-9\-._~]/;

export function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (UNRESERVED.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

export function signS3Request(
  spec: S3RequestSpec,
  creds: S3Credentials,
  now: Date = new Date(),
): SignedRequest {
  const body = spec.body ?? new Uint8Array();
  const payloadHash = sha256Hex(body);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = uriEncode(
    "/" + spec.bucket + (spec.key ? "/" + spec.key : ""),
    false,
  );

  const query = spec.query ?? {};
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k, true)}=${uriEncode(query[k], true)}`)
    .join("&");

  // The port matters: signing the bare host while sending host:port yields
  // SignatureDoesNotMatch with no diagnostic.
  const headers: Record<string, string> = {
    host: new URL(creds.endpoint).host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((k) => `${k}:${headers[k].trim()}\n`).join("");

  const canonicalRequest = [
    spec.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac("AWS4" + creds.secretAccessKey, dateStamp), creds.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    url:
      creds.endpoint.replace(/\/$/, "") +
      canonicalUri +
      (canonicalQuery ? "?" + canonicalQuery : ""),
    headers: {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
```

- [ ] **Step 4: Run tests and commit**

Run: `cd ads-agent && npx vitest run lib/objectstore/sigv4.test.ts`
Expected: PASS (7 tests)

```bash
git add ads-agent/lib/objectstore/
git commit -m "feat(objectstore): sign S3 requests with SigV4 over node:crypto

Sixty lines against an AWS SDK dependency for one signing function. The golden
signatures in the test are a known-answer check on canonicalisation."
```

## Task 4: ClickHouse client and the graph node/edge migrations

**Files:**
- Create: `ads-agent/lib/context-graph/clickhouse.ts`
- Create: `ads-agent/lib/context-graph/clickhouse.test.ts`
- Create: `infra/clickhouse/migrations/010_graph_database.up.sql`
- Create: `infra/clickhouse/migrations/010_graph_database.down.sql`
- Create: `infra/clickhouse/migrations/011_graph_node.up.sql`
- Create: `infra/clickhouse/migrations/011_graph_node.down.sql`
- Create: `infra/clickhouse/migrations/012_graph_edge.up.sql`
- Create: `infra/clickhouse/migrations/012_graph_edge.down.sql`
- Create: `infra/clickhouse/migrations/013_graph_node_policy.up.sql`
- Create: `infra/clickhouse/migrations/013_graph_node_policy.down.sql`
- Create: `infra/clickhouse/migrations/014_graph_edge_policy.up.sql`
- Create: `infra/clickhouse/migrations/014_graph_edge_policy.down.sql`
- Create: `lib/clickhouse/graph-schema.test.ts`
- Modify: `ads-agent/.env.example` (append the `CLICKHOUSE_*` block from "Environment variables introduced")

**Skills:** `senior-data-engineer`, `sql-pro`
**Model:** composer-2.5-fast

**Interfaces:**
- Consumes, **all from `docs/superpowers/plans/2026-08-12-s6-s6a-clickhouse-portal-ingestion.md` Task 1** — this task writes no migration runner of its own:
  - `applyMigrations(options?: { dir?: string; config?: ClickHouseConfig }): Promise<string[]>` from `lib/clickhouse/migrate.ts`, returning the versions newly applied. It creates the `default._ch_migrations` ledger, keys it on `versionOf(file) = file.slice(0, 3)`, and skips any version already recorded — which is exactly why an edit to an applied migration must become a *new* number rather than an edit in place.
  - `DEFAULT_MIGRATIONS_DIR` from `lib/clickhouse/migrate.ts` = `path.join(process.cwd(), "infra/clickhouse/migrations")`.
  - `chQuery` / `chExec` / `clickhouseConfig` from `lib/clickhouse/client.ts` (the root app's client, used only by the root-app test in this task).
  - CLI entry point `scripts/clickhouse/migrate.ts`, invoked `npx tsx scripts/clickhouse/migrate.ts`, printing `clickhouse: applied <versions>` or `clickhouse: up to date`.
  - The `SQL_` custom-settings prefix, declared in `infra/clickhouse/config.d/custom-settings.xml`, and the `etl_writer` / `tenant_reader` users from `infra/clickhouse/users.d/etl.xml`. The `tenant` profile defaults `SQL_current_tenant_id` to the zero UUID, so an unset tenant matches no row.
  - The `analytics` and `raw` databases from `infra/clickhouse/migrations/000_databases.up.sql`. This task does **not** touch that file; it creates `gentle_space` under its own number.
- Produces:

```ts
export type ChCredentials = { url: string; user: string; password: string; database: string };
export function chFromEnv(): ChCredentials;
export type ChOptions = {
  orgId?: string; params?: Record<string, string>;
  settings?: Record<string, string>; creds?: ChCredentials;
};
export function chQuery<T>(sql: string, opts?: ChOptions): Promise<T[]>;
export function chCommand(sql: string, opts?: ChOptions): Promise<void>;
```

Plus, via migrations `010`–`014`, the database `gentle_space`, the tables `gentle_space.graph_node` and `gentle_space.graph_edge`, and the row policies `graph_node_tenant` and `graph_edge_tenant`. Tasks 7, 10, 14 and 16 import `chQuery` / `chCommand`.

**Context:** **This task does not touch Apache AGE.** AGE stays where it is, serving the listings-search boost through the root app's `lib/graph/age.ts`. The tables created here are the *context graph* — a different graph, in a different engine, in a different app, following GitLab Orbit's model of node and edge tables queried with SQL (datastore §6.1, UD6). Two representations is a knowingly accepted cost (datastore §9).

One polymorphic edge table, because a relationship kind spans several node-kind pairs — the property that made Orbit's own edge table load-bearing across eleven kind-triples. Edge properties are typed columns, not JSON, per UD14: ClickHouse's own guidance is to use normal columns when the structure is known.

**Why five numbered migrations rather than one DDL file.** An earlier draft of this task created `gentle_space.graph_node` and `gentle_space.graph_edge` by re-running a single checked-in DDL file through a bespoke apply script. That is the same defect as re-running `schema.sql`, which data model §0 exists to abolish, and the engine makes no difference: `CREATE TABLE IF NOT EXISTS` is a no-op against a database that already has the table, so the second time anyone edits a column inside that file the edit lands on a fresh database and silently never lands on a provisioned one. The rule this plan states in its own constraints — *anything expressed inside a `CREATE TABLE` body never reaches a provisioned database* — applies to ClickHouse exactly as it applies to PostgreSQL. So every object here is a numbered up/down pair in `infra/clickhouse/migrations/`, and a column change becomes `015_*` with an `ALTER TABLE`, never an edit to `011`.

**And no second runner.** S6/S6a already built one, with a ledger, ordering, `${ENV_VAR}` substitution and a `.local`/`.cloud` variant filter. This task reuses it unchanged and adds only migration files plus a test. Writing a parallel runner for the same directory would be the worse failure of the two.

**Two alignments to S6/S6a's conventions**, both forced by reusing its runner and users:

- The policy filter is `toUUIDOrZero(getSetting('SQL_current_tenant_id'))`, not `toUUID(...)`. `toUUID` raises on an unset or empty setting; `toUUIDOrZero` yields the zero UUID, which matches no row. Combined with the `tenant` profile's zero-UUID default, an unset tenant sees nothing instead of seeing an error — fail closed, and identical to `001_enquiry_fact`.
- The policies are `TO ALL EXCEPT etl_writer`, not `TO ALL`. `etl_writer` is the user the runner authenticates as, and the same user the graph builder (Task 7), the snapshot exporter (Task 14) and the subject-level prune all use to write and delete across tenants. Under `TO ALL` the writer would be filtered by its own policy and every cross-tenant maintenance statement would silently match nothing. Tenant-scoped reads go through `tenant_reader`, which *is* covered.

The `SQL_` prefix these filters depend on is declared by S6/S6a's `infra/clickhouse/config.d/custom-settings.xml`; ClickHouse rejects unknown custom settings, so if that file is not mounted the row-policy assertions in Step 1's test fail loudly with `Unknown setting`. That check now lives in a test rather than in an apply script, which is where it belongs.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/context-graph/clickhouse.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { chCommand, chQuery, type ChCredentials } from "./clickhouse";

const creds: ChCredentials = {
  url: "http://ch.test:8123", user: "u", password: "p", database: "gentle_space",
};

function stubFetch(status: number, body: string) {
  const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("chQuery", () => {
  it("parses JSONEachRow into objects", async () => {
    stubFetch(200, '{"a":1}\n{"a":2}\n');
    await expect(chQuery<{ a: number }>("SELECT 1", { creds })).resolves.toEqual([
      { a: 1 }, { a: 2 },
    ]);
  });

  it("sends the tenant as the custom setting the row policy reads", async () => {
    const fetchFn = stubFetch(200, "");
    await chQuery("SELECT 1", { creds, orgId: "11111111-1111-1111-1111-111111111111" });
    const url = new URL(fetchFn.mock.calls[0][0].toString());
    expect(url.searchParams.get("SQL_current_tenant_id")).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(url.searchParams.get("default_format")).toBe("JSONEachRow");
    expect(url.searchParams.get("database")).toBe("gentle_space");
  });

  it("binds parameters as param_* rather than interpolating them", async () => {
    const fetchFn = stubFetch(200, "");
    await chQuery("SELECT {x:String}", { creds, params: { x: "'; DROP TABLE t; --" } });
    const url = new URL(fetchFn.mock.calls[0][0].toString());
    expect(url.searchParams.get("param_x")).toBe("'; DROP TABLE t; --");
    expect(fetchFn.mock.calls[0][1].body).toBe("SELECT {x:String}");
  });

  it("sends credentials as headers, never in the query string", async () => {
    const fetchFn = stubFetch(200, "");
    await chQuery("SELECT 1", { creds });
    expect(fetchFn.mock.calls[0][1].headers["X-ClickHouse-Key"]).toBe("p");
    expect(fetchFn.mock.calls[0][0].toString()).not.toContain("password");
  });

  it("throws with the server's message on a non-2xx", async () => {
    stubFetch(400, "Code: 47. Unknown identifier");
    await expect(chQuery("SELECT nope", { creds })).rejects.toThrow(/Code: 47/);
  });
});

describe("chCommand", () => {
  it("resolves on success and does not parse a body", async () => {
    stubFetch(200, "");
    await expect(
      chCommand("CREATE TABLE t (a UInt8) ENGINE = Memory", { creds }),
    ).resolves.toBeUndefined();
  });
});
```

The second test lives in the **root app**, beside S6/S6a's `lib/clickhouse/analytics.test.ts`, because it imports that plan's runner and client. `ads-agent` never imports across the app boundary — the constraint S6/S6a states and this plan restates — so a migration test that calls `applyMigrations` cannot live under `ads-agent/`.

It asserts the migrations *landed*, by interrogating `system.tables`, `system.columns` and `system.row_policies` on the live server, rather than asserting the contents of a file. A file-text assertion passes even when the migration never reached a database, which is the failure mode this whole restructuring exists to prevent.

```ts
// lib/clickhouse/graph-schema.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { applyMigrations, DEFAULT_MIGRATIONS_DIR } from "./migrate";
import { chExec, chQuery } from "./client";

/** The ClickHouse migration numbers this plan owns. 015-019 stay free. */
const OWNED = ["010", "011", "012", "013", "014"];

const files = readdirSync(DEFAULT_MIGRATIONS_DIR);
const ownedUps = files.filter((f) => OWNED.includes(f.slice(0, 3)) && f.endsWith(".up.sql"));

beforeAll(async () => {
  await applyMigrations();
}, 60_000);

describe("migrations 010-014 on disk", () => {
  it("gives every owned .up.sql a real matching .down.sql", () => {
    expect(ownedUps.sort()).toEqual([
      "010_graph_database.up.sql",
      "011_graph_node.up.sql",
      "012_graph_edge.up.sql",
      "013_graph_node_policy.up.sql",
      "014_graph_edge_policy.up.sql",
    ]);
    for (const up of ownedUps) {
      const down = up.replace(/\.up\.sql$/, ".down.sql");
      expect(files).toContain(down);
      // A file that exists but says nothing is not a reverse.
      const body = readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, down), "utf8");
      expect(body).toMatch(/^\s*DROP\s+/im);
    }
  });

  it("claims no number outside 010-019 and none of S6/S6a's 000-007", () => {
    const graphVersions = files
      .filter((f) => f.includes("_graph_") && f.endsWith(".up.sql"))
      .map((f) => Number(f.slice(0, 3)));
    expect(graphVersions.length).toBe(5);
    for (const v of graphVersions) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(19);
    }
  });

  it("needs no env substitution, so it cannot fail on a missing variable", () => {
    for (const up of ownedUps) {
      expect(readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, up), "utf8")).not.toMatch(/\$\{/);
    }
  });
});

describe("migrations 010-014 applied", () => {
  it("records every owned version in the runner's ledger", async () => {
    const rows = await chQuery<{ version: string }>(
      "SELECT version FROM default._ch_migrations FINAL ORDER BY version",
    );
    const applied = rows.map((r) => r.version);
    for (const version of OWNED) expect(applied).toContain(version);
  });

  it("is idempotent -- a second run applies nothing", async () => {
    await expect(applyMigrations()).resolves.toEqual([]);
  });

  it("orders both tables with the tenant leading", async () => {
    const rows = await chQuery<{ name: string; sorting_key: string }>(
      "SELECT name, sorting_key FROM system.tables " +
        "WHERE database = 'gentle_space' AND name LIKE 'graph\\_%' ORDER BY name",
    );
    expect(rows).toEqual([
      {
        name: "graph_edge",
        sorting_key: "org_id, snapshot_id, source_kind, relationship_kind, source_id",
      },
      { name: "graph_node", sorting_key: "org_id, snapshot_id, node_kind, node_id" },
    ]);
  });

  it("is tables, not a graph engine", async () => {
    const rows = await chQuery<{ engine: string }>(
      "SELECT DISTINCT engine FROM system.tables " +
        "WHERE database = 'gentle_space' AND name LIKE 'graph\\_%'",
    );
    expect(rows).toEqual([{ engine: "MergeTree" }]);
  });

  it("carries subject provenance on nodes so erasure can prune", async () => {
    const rows = await chQuery<{ type: string }>(
      "SELECT type FROM system.columns WHERE database = 'gentle_space' " +
        "AND table = 'graph_node' AND name = 'subject_ref'",
    );
    expect(rows).toEqual([{ type: "Nullable(String)" }]);
  });

  it("types edge properties as columns rather than JSON", async () => {
    const rows = await chQuery<{ name: string; type: string }>(
      "SELECT name, type FROM system.columns WHERE database = 'gentle_space' " +
        "AND table = 'graph_edge' AND name IN ('meters', 'weight', 'confidence') ORDER BY name",
    );
    expect(rows).toEqual([
      { name: "confidence", type: "Nullable(Float32)" },
      { name: "meters", type: "Nullable(UInt32)" },
      { name: "weight", type: "Nullable(Float32)" },
    ]);
  });

  it("puts a fail-closed tenant row policy on both tables", async () => {
    const rows = await chQuery<{
      short_name: string;
      select_filter: string;
      apply_to_all: number;
      apply_to_except: string[];
    }>(
      "SELECT short_name, select_filter, apply_to_all, apply_to_except " +
        "FROM system.row_policies WHERE database = 'gentle_space' ORDER BY short_name",
    );
    expect(rows.map((r) => r.short_name)).toEqual(["graph_edge_tenant", "graph_node_tenant"]);
    for (const row of rows) {
      // toUUIDOrZero, not toUUID: an unset tenant must match no row, not raise.
      expect(row.select_filter).toContain("toUUIDOrZero(getSetting('SQL_current_tenant_id'))");
      expect(row.apply_to_all).toBe(1);
      expect(row.apply_to_except).toEqual(["etl_writer"]);
    }
  });

  it("has a down migration that really reverses, proven on 014", async () => {
    const dir = DEFAULT_MIGRATIONS_DIR;
    const count = async () =>
      (
        await chQuery<{ c: string }>(
          "SELECT toString(count()) AS c FROM system.row_policies " +
            "WHERE database = 'gentle_space' AND short_name = 'graph_edge_tenant'",
        )
      )[0].c;

    expect(await count()).toBe("1");
    await chExec(readFileSync(path.join(dir, "014_graph_edge_policy.down.sql"), "utf8"));
    expect(await count()).toBe("0");
    await chExec(readFileSync(path.join(dir, "014_graph_edge_policy.up.sql"), "utf8"));
    expect(await count()).toBe("1");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd ads-agent && npx vitest run lib/context-graph/
```
Expected: FAIL — `Failed to resolve import "./clickhouse"`.

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl
npx vitest run lib/clickhouse/graph-schema.test.ts
```
Expected: FAIL — `expected [] to deeply equal [ '010_graph_database.up.sql', … ]`, because `infra/clickhouse/migrations/` holds only S6/S6a's `000`–`007`.

- [ ] **Step 3: Write the ClickHouse client**

```ts
// ads-agent/lib/context-graph/clickhouse.ts
export type ChCredentials = {
  url: string;
  user: string;
  password: string;
  database: string;
};

export type ChOptions = {
  /** Tenant context, mirroring public.set_tenant in Postgres. */
  orgId?: string;
  /** Bound query parameters, referenced in SQL as {name:Type}. */
  params?: Record<string, string>;
  settings?: Record<string, string>;
  creds?: ChCredentials;
};

export function chFromEnv(): ChCredentials {
  return {
    url: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
    user: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "gentle_space",
  };
}

async function send(sql: string, opts: ChOptions): Promise<string> {
  const creds = opts.creds ?? chFromEnv();
  const url = new URL(creds.url);
  url.searchParams.set("database", creds.database);
  url.searchParams.set("default_format", "JSONEachRow");
  if (opts.orgId) url.searchParams.set("SQL_current_tenant_id", opts.orgId);
  for (const [k, v] of Object.entries(opts.settings ?? {})) url.searchParams.set(k, v);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(`param_${k}`, v);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-ClickHouse-User": creds.user,
      "X-ClickHouse-Key": creds.password,
      "content-type": "text/plain; charset=utf-8",
    },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text}`);
  return text;
}

export async function chQuery<T>(sql: string, opts: ChOptions = {}): Promise<T[]> {
  const text = await send(sql, opts);
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function chCommand(sql: string, opts: ChOptions = {}): Promise<void> {
  await send(sql, opts);
}
```

- [ ] **Step 4: Write migrations `010`–`014`**

Five files, five reverses. The runner applies them in filename order, so `010` creating the database always precedes `011` and `012` creating tables inside it, and the policies land last.

```sql
-- infra/clickhouse/migrations/010_graph_database.up.sql
-- The context graph gets its own database. S6/S6a's 000_databases creates
-- analytics and raw for the CDC mirror and the raw zone; keeping the graph
-- separate means a graph rebuild can never truncate a mirror table.
CREATE DATABASE IF NOT EXISTS gentle_space;
```

```sql
-- infra/clickhouse/migrations/010_graph_database.down.sql
DROP DATABASE IF EXISTS gentle_space;
```

```sql
-- infra/clickhouse/migrations/011_graph_node.up.sql
-- The context graph as tables (datastore §6.1, UD6, data model §7).
-- This is NOT Apache AGE. AGE remains scoped to the listings-search boost in
-- the root app's lib/graph/age.ts and is untouched by this migration.
CREATE TABLE IF NOT EXISTS gentle_space.graph_node
(
  org_id      UUID,
  snapshot_id UUID,
  node_id     UUID,
  -- Space|Corridor|Person|Enquiry|Requirement|Campaign|Call|Outcome
  node_kind   LowCardinality(String),
  label       String,
  -- Provenance, so erasure can prune a node derived from one person
  -- (datastore §11.2, validation F-18). EDPB Opinion 28/2024 holds that
  -- artefacts derived from personal data are not automatically anonymous.
  subject_ref Nullable(String),
  props       JSON
)
ENGINE = MergeTree
ORDER BY (org_id, snapshot_id, node_kind, node_id);
```

```sql
-- infra/clickhouse/migrations/011_graph_node.down.sql
DROP TABLE IF EXISTS gentle_space.graph_node;
```

```sql
-- infra/clickhouse/migrations/012_graph_edge.up.sql
CREATE TABLE IF NOT EXISTS gentle_space.graph_edge
(
  org_id            UUID,
  snapshot_id       UUID,
  source_id         UUID,
  source_kind       LowCardinality(String),
  relationship_kind LowCardinality(String),
  target_id         UUID,
  target_kind       LowCardinality(String),
  -- Typed property columns per UD14; a relationship kind spans several
  -- node-kind pairs, which is why there is one polymorphic edge table.
  meters     Nullable(UInt32),    -- NEAR
  weight     Nullable(Float32),   -- SIMILAR_TO
  confidence Nullable(Float32),   -- GENERATED (attribution is inferred)
  props      JSON                 -- only genuinely dynamic extras
)
ENGINE = MergeTree
ORDER BY (org_id, snapshot_id, source_kind, relationship_kind, source_id);
```

```sql
-- infra/clickhouse/migrations/012_graph_edge.down.sql
DROP TABLE IF EXISTS gentle_space.graph_edge;
```

The policies get their own numbers so a later filter change is a new migration
against an existing table, not an edit to `011` or `012` that would never land.

```sql
-- infra/clickhouse/migrations/013_graph_node_policy.up.sql
-- RLS is the infrastructure safety net; application filtering stays the front
-- line. Every traversal function passes org_id explicitly as well.
-- toUUIDOrZero, not toUUID: an unset setting must match no row rather than
-- raise. TO ALL EXCEPT etl_writer, because etl_writer is the cross-tenant
-- builder and would otherwise be filtered by its own policy.
CREATE ROW POLICY IF NOT EXISTS graph_node_tenant ON gentle_space.graph_node
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
```

```sql
-- infra/clickhouse/migrations/013_graph_node_policy.down.sql
DROP ROW POLICY IF EXISTS graph_node_tenant ON gentle_space.graph_node;
```

```sql
-- infra/clickhouse/migrations/014_graph_edge_policy.up.sql
CREATE ROW POLICY IF NOT EXISTS graph_edge_tenant ON gentle_space.graph_edge
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;
```

```sql
-- infra/clickhouse/migrations/014_graph_edge_policy.down.sql
DROP ROW POLICY IF EXISTS graph_edge_tenant ON gentle_space.graph_edge;
```

- [ ] **Step 5: Apply with S6/S6a's runner and watch both suites pass**

The runner is `scripts/clickhouse/migrate.ts` from S6/S6a Task 1. Nothing new is written here; `010`–`014` are simply the next unapplied versions in the directory it already reads.

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl
npx tsx scripts/clickhouse/migrate.ts
```
Expected: `clickhouse: applied 010, 011, 012, 013, 014`

```bash
npx tsx scripts/clickhouse/migrate.ts
```
Expected: `clickhouse: up to date` — the ledger holds, which is the whole reason these are migrations.

```bash
npx vitest run lib/clickhouse/graph-schema.test.ts
```
Expected: PASS, 11 tests.

```bash
cd ads-agent && npx vitest run lib/context-graph/
```
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

Append the `CLICKHOUSE_*` block from "Environment variables introduced" to `ads-agent/.env.example`.

```bash
git add ads-agent/lib/context-graph/ infra/clickhouse/migrations/01*_graph_* lib/clickhouse/graph-schema.test.ts ads-agent/.env.example
git commit -m "feat(context-graph): node and edge tables in ClickHouse

The graph is tables, not a graph engine (UD6, revised 2026-08-12): one typed
node table, one polymorphic edge table, queried with SQL. Apache AGE is
untouched and stays scoped to the listings-search boost.

Five numbered reversible migrations (010-014) applied by S6/S6a's existing
runner, not a re-appliable DDL file: CREATE TABLE IF NOT EXISTS is a no-op
against a provisioned database, so a whole-file apply means the second edit
to a column never lands. Policies carry their own numbers so a filter change
is an ALTER under 015+ rather than an invisible edit to 011."
```

## Task 5: Rebuild backpressure — slots, debounce, priority

**Files:**
- Create: `ads-agent/lib/db/migrations/085_graph_manifest_backpressure.up.sql`
- Create: `ads-agent/lib/db/migrations/085_graph_manifest_backpressure.down.sql`
- Create: `ads-agent/lib/db/migrations/085_graph_manifest_backpressure.test.ts`
- Create: `ads-agent/lib/context-graph/backpressure.ts`
- Create: `ads-agent/lib/context-graph/backpressure.test.ts`

**Skills:** `postgres-pro`, `senior-data-engineer`
**Model:** inherit — the ceiling has a race the obvious implementation does not close, and the reasoning has to be got right rather than transcribed.

**Interfaces:**
- Consumes: `type Scope` from `../db/scope-sql`; `withTenantTransaction` from `../db/tx` and `enqueueEvent` from `../db/outbox` (both S5a); `readMigration`, `assertTenantTableHardening` from `../db/migrations/migration-assertions` (Task 2).
- Produces:

```ts
export const REBUILD_CEILING: number;            // 2
export const REBUILD_DEBOUNCE_SECONDS: number;   // 300
export const REBUILD_LEASE_SECONDS: number;      // 900
export type RebuildClaim = {
  orgId: string; slotNo: number; snapshotId: string; generation: number;
};
export function markTenantStale(scope: Scope, opts: { byUser: boolean }): Promise<void>;
export function claimRebuild(): Promise<RebuildClaim | null>;
export function finishRebuild(claim: RebuildClaim, result: {
  sourceWatermark: Date; cdcLagSeconds: number;
}): Promise<void>;
export function failRebuild(claim: RebuildClaim, message: string): Promise<void>;
```

Plus `context.graph_manifests` (columns added) and `context.rebuild_slots` (seeded to the ceiling). Tasks 8, 14 and 16 use all of it.

**Context:** On-demand rebuilds have no ceiling as specified: a bulk listings sync marks every tenant stale at once and stampedes (datastore §12.2). Three controls, with the spec's numbers: ceiling 2, debounce 300 s, priority to tenants with a user active in the last 24 h.

Two decisions worth stating, because the obvious implementations are wrong.

**The ceiling is a slots table, not a count.** §12.2 says the ceiling is "enforced by claiming rows in `graph_manifests` with `FOR UPDATE SKIP LOCKED`", and the manifest claim does use that. But a ceiling expressed as `WHERE (SELECT count(*) ... WHERE status = 'building') < 2` is not race-safe: two transactions can both read 1 and both proceed. Two race-free options exist — a session-scoped advisory lock, or a slots table with a lease. The slots table wins because a rebuild spans several transactions and can crash mid-build: an advisory lock would need the worker to keep one pooled connection pinned for the whole build, while a lease expires on its own. Seeded rows *are* the ceiling, so changing it is an `INSERT`.

**The debounce coalesces rather than deferring.** `stale_since` is set with `COALESCE(existing, now())`, so the first mark starts the clock and later marks inside the window do not push it back. Refreshing it on every mark would mean a bulk import that touches a tenant every second never becomes eligible at all.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/migrations/085_graph_manifest_backpressure.test.ts
import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("085_graph_manifest_backpressure.up.sql");

describe("085_graph_manifest_backpressure", () => {
  it("hardens the manifest table", () => {
    expect(() => assertTenantTableHardening(up, "context.graph_manifests")).not.toThrow();
  });

  it("adds every column as an explicit ALTER, since the table may pre-exist", () => {
    for (const col of [
      "cdc_lag_seconds", "source_watermark", "last_user_activity_at", "generation", "attempts",
    ]) {
      expect(up, col).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it("seeds the concurrency ceiling as rows, so the ceiling is 2", () => {
    expect(up).toContain("context.rebuild_slots");
    expect(up).toMatch(/INSERT INTO context\.rebuild_slots[\s\S]*VALUES \(1\), \(2\)/);
  });

  it("uses TIMESTAMPTZ throughout", () => {
    expect(up).not.toMatch(/TIMESTAMP(?!TZ)/);
  });

  it("has a down that removes both the columns and the slots table", () => {
    const down = readMigration("085_graph_manifest_backpressure.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.rebuild_slots");
    expect(down).toContain("DROP COLUMN IF EXISTS cdc_lag_seconds");
  });
});
```

```ts
// ads-agent/lib/context-graph/backpressure.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const enqueueEvent = vi.fn().mockResolvedValue("evt");

vi.mock("../db/client", () => ({
  getPool: () => ({
    query,
    connect: async () => ({ query: clientQuery, release }),
  }),
}));
vi.mock("../db/outbox", () => ({ enqueueEvent }));
// The real withTenantTransaction opens its own transaction; the fake hands the
// callback the same client the pool mock returns, so SQL assertions still work.
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (
    _scope: unknown,
    fn: (client: { query: typeof clientQuery }) => Promise<unknown>,
  ) => fn({ query: clientQuery }),
}));

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  enqueueEvent.mockClear();
});

describe("markTenantStale", () => {
  it("coalesces stale_since so a bulk import cannot push the clock forward", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { markTenantStale } = await import("./backpressure");
    await markTenantStale({ kind: "org", orgId: ORG }, { byUser: true });

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("COALESCE(context.graph_manifests.stale_since, now())");
  });

  it("enqueues graph.tenant_stale on the same client as the manifest write", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { markTenantStale } = await import("./backpressure");
    await markTenantStale({ kind: "org", orgId: ORG }, { byUser: false });

    expect(enqueueEvent).toHaveBeenCalledWith(
      { kind: "org", orgId: ORG },
      expect.objectContaining({ query: clientQuery }),
      { topic: "graph.tenant_stale", payload: { byUser: false } },
    );
  });
});

describe("claimRebuild", () => {
  it("claims a slot and a manifest row with FOR UPDATE SKIP LOCKED", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                  // BEGIN
      .mockResolvedValueOnce({ rows: [{ slot_no: 1 }], rowCount: 1 })    // slot
      .mockResolvedValueOnce({                                           // manifest
        rows: [{ org_id: ORG, building_id: SNAP, generation: "7" }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });                     // bind + COMMIT

    const { claimRebuild } = await import("./backpressure");
    await expect(claimRebuild()).resolves.toEqual({
      orgId: ORG, slotNo: 1, snapshotId: SNAP, generation: 7,
    });

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql.match(/FOR UPDATE SKIP LOCKED/g)).toHaveLength(2);
  });

  it("returns null and takes no slot when every slot is leased", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // no free slot
      .mockResolvedValue({ rows: [], rowCount: 0 });      // ROLLBACK
    const { claimRebuild } = await import("./backpressure");
    await expect(claimRebuild()).resolves.toBeNull();
    expect(clientQuery.mock.calls.some((c) => String(c[0]).includes("ROLLBACK"))).toBe(true);
  });

  it("releases the slot when a slot was free but no tenant was due", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                  // BEGIN
      .mockResolvedValueOnce({ rows: [{ slot_no: 2 }], rowCount: 1 })    // slot
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                  // nothing due
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const { claimRebuild } = await import("./backpressure");
    await expect(claimRebuild()).resolves.toBeNull();

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("SET org_id = NULL, leased_until = NULL");
  });

  it("filters by the debounce window and orders by recent user activity", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ slot_no: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const { claimRebuild, REBUILD_DEBOUNCE_SECONDS } = await import("./backpressure");
    await claimRebuild();

    const manifestCall = clientQuery.mock.calls.find((c) =>
      String(c[0]).includes("context.graph_manifests m"));
    expect(String(manifestCall![0])).toContain(
      "stale_since <= now() - ($1 || ' seconds')::interval",
    );
    expect(String(manifestCall![0])).toContain(
      "ORDER BY (last_user_activity_at >= now() - interval '1 day') DESC NULLS LAST",
    );
    expect(manifestCall![1]).toEqual([String(REBUILD_DEBOUNCE_SECONDS)]);
    expect(REBUILD_DEBOUNCE_SECONDS).toBe(300);
  });
});

describe("finishRebuild", () => {
  it("clears staleness, records lag, and frees the slot", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { finishRebuild } = await import("./backpressure");
    await finishRebuild(
      { orgId: ORG, slotNo: 1, snapshotId: SNAP, generation: 7 },
      { sourceWatermark: new Date("2026-08-12T08:00:00Z"), cdcLagSeconds: 12 },
    );
    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("status = 'ready'");
    expect(sql).toContain("stale_since = NULL");
    expect(sql).toContain("cdc_lag_seconds");
    expect(sql).toContain("SET org_id = NULL, leased_until = NULL");
  });
});

describe("failRebuild", () => {
  it("records the error and frees the slot, so a failure cannot hold the ceiling", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { failRebuild } = await import("./backpressure");
    await failRebuild(
      { orgId: ORG, slotNo: 2, snapshotId: SNAP, generation: 7 },
      "clickhouse unreachable",
    );
    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("status = 'error'");
    expect(sql).toContain("SET org_id = NULL, leased_until = NULL");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/context-graph/backpressure.test.ts lib/db/migrations/085_graph_manifest_backpressure.test.ts`
Expected: FAIL — `Failed to resolve import "./backpressure"` and `ENOENT ... 085_graph_manifest_backpressure.up.sql`

- [ ] **Step 3: Write migration 085**

```sql
-- ads-agent/lib/db/migrations/085_graph_manifest_backpressure.up.sql
-- Rebuild backpressure and the snapshot control plane (datastore §12.2).
-- The manifest describes the graph but must not live in it (datastore §3.2).
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.graph_manifests (
  org_id UUID PRIMARY KEY REFERENCES public.orgs(id)
);

ALTER TABLE context.graph_manifests
  ADD COLUMN IF NOT EXISTS status                TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS snapshot_id           UUID,
  ADD COLUMN IF NOT EXISTS building_id           UUID,
  ADD COLUMN IF NOT EXISTS last_built_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_since           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message         TEXT,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- §12.1: an agent cannot obtain data without also obtaining its age.
  ADD COLUMN IF NOT EXISTS cdc_lag_seconds       INTEGER,
  ADD COLUMN IF NOT EXISTS source_watermark      TIMESTAMPTZ,
  -- §12.2 priority: tenants with a user active today build first.
  ADD COLUMN IF NOT EXISTS last_user_activity_at TIMESTAMPTZ,
  -- §12.2 generation-based collection.
  ADD COLUMN IF NOT EXISTS generation            BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempts              INTEGER NOT NULL DEFAULT 0;

ALTER TABLE context.graph_manifests DROP CONSTRAINT IF EXISTS graph_manifests_status_check;
ALTER TABLE context.graph_manifests
  ADD CONSTRAINT graph_manifests_status_check
  CHECK (status IN ('pending','building','ready','error'));

-- The worker's only claim query. Partial index stays small no matter how many
-- tenants exist. org_id already has the primary-key index.
CREATE INDEX IF NOT EXISTS graph_manifests_claimable_idx
  ON context.graph_manifests (stale_since) WHERE status = 'pending';

ALTER TABLE context.graph_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.graph_manifests FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.graph_manifests;
CREATE POLICY tenant_isolation ON context.graph_manifests
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.graph_manifests TO context_maintenance;

-- The rebuild worker publishes everyone's rebuilds, exactly as the outbox relay
-- publishes everyone's events. A named policy for a named role, not BYPASSRLS.
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_manifests;
CREATE POLICY maintenance_cross_tenant ON context.graph_manifests
  TO context_maintenance
  USING (true) WITH CHECK (true);

-- The concurrency ceiling. Deliberately NOT a tenant table and deliberately not
-- RLS-protected: it holds no tenant data beyond the org id of an in-flight
-- build, and its whole purpose is to be contended across tenants. A count-based
-- ceiling is not race-safe; a lease-bearing slot survives a worker crash, which
-- a session advisory lock would not without pinning a connection per build.
CREATE TABLE IF NOT EXISTS context.rebuild_slots (
  slot_no      INTEGER PRIMARY KEY,
  org_id       UUID,
  leased_until TIMESTAMPTZ
);

-- These rows ARE the ceiling of 2 (datastore §12.2 default).
INSERT INTO context.rebuild_slots (slot_no) VALUES (1), (2)
  ON CONFLICT (slot_no) DO NOTHING;

GRANT SELECT, UPDATE ON context.rebuild_slots TO context_maintenance;

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/085_graph_manifest_backpressure.down.sql
BEGIN;
DROP TABLE IF EXISTS context.rebuild_slots;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_manifests;
DROP POLICY IF EXISTS tenant_isolation ON context.graph_manifests;
DROP INDEX IF EXISTS context.graph_manifests_claimable_idx;
-- Only the columns this migration added. status/snapshot_id/building_id/
-- last_built_at/stale_since/error_message/updated_at come from data model §5 and
-- may have been created by an earlier migration.
ALTER TABLE context.graph_manifests
  DROP COLUMN IF EXISTS cdc_lag_seconds,
  DROP COLUMN IF EXISTS source_watermark,
  DROP COLUMN IF EXISTS last_user_activity_at,
  DROP COLUMN IF EXISTS generation,
  DROP COLUMN IF EXISTS attempts;
COMMIT;
```

- [ ] **Step 4: Write `backpressure.ts`**

```ts
// ads-agent/lib/context-graph/backpressure.ts
import { getPool } from "../db/client";
import { enqueueEvent } from "../db/outbox";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";

/** Datastore §12.2 defaults. The slots table is seeded to REBUILD_CEILING. */
export const REBUILD_CEILING = Number(process.env.GRAPH_REBUILD_CEILING ?? 2);
export const REBUILD_DEBOUNCE_SECONDS = Number(
  process.env.GRAPH_REBUILD_DEBOUNCE_SECONDS ?? 300,
);
export const REBUILD_LEASE_SECONDS = Number(process.env.GRAPH_REBUILD_LEASE_SECONDS ?? 900);

export type RebuildClaim = {
  orgId: string;
  slotNo: number;
  snapshotId: string;
  generation: number;
};

const FREE_SLOT = `UPDATE context.rebuild_slots
                      SET org_id = NULL, leased_until = NULL
                    WHERE slot_no = $1`;

export async function markTenantStale(scope: Scope, opts: { byUser: boolean }): Promise<void> {
  // withTenantTransaction is the only way a domain write and its event share a
  // transaction (S5a). Org scope, because enqueueEvent refuses platform scope.
  await withTenantTransaction({ kind: "org", orgId: scope.orgId }, async (client) => {
    await client.query(
      `INSERT INTO context.graph_manifests
         (org_id, status, stale_since, last_user_activity_at, updated_at)
       VALUES ($1, 'pending', now(), CASE WHEN $2 THEN now() ELSE NULL END, now())
       ON CONFLICT (org_id) DO UPDATE SET
         status = CASE WHEN context.graph_manifests.status = 'building'
                       THEN 'building' ELSE 'pending' END,
         -- The first mark starts the debounce clock. Refreshing it on every mark
         -- would mean a bulk import never becomes eligible at all.
         stale_since = COALESCE(context.graph_manifests.stale_since, now()),
         last_user_activity_at = CASE WHEN $2 THEN now()
                                      ELSE context.graph_manifests.last_user_activity_at END,
         updated_at = now()`,
      [scope.orgId, opts.byUser],
    );
    await enqueueEvent({ kind: "org", orgId: scope.orgId }, client, {
      topic: "graph.tenant_stale",
      payload: { byUser: opts.byUser },
    });
  });
}

export async function claimRebuild(): Promise<RebuildClaim | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const slot = await client.query<{ slot_no: number }>(
      `UPDATE context.rebuild_slots
          SET leased_until = now() + ($1 || ' seconds')::interval
        WHERE slot_no = (
                SELECT slot_no FROM context.rebuild_slots
                 WHERE org_id IS NULL OR leased_until IS NULL OR leased_until < now()
                 ORDER BY slot_no
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED)
        RETURNING slot_no`,
      [String(REBUILD_LEASE_SECONDS)],
    );
    if (slot.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const slotNo = slot.rows[0].slot_no;

    const manifest = await client.query<{
      org_id: string; building_id: string; generation: string;
    }>(
      `UPDATE context.graph_manifests m
          SET status = 'building', building_id = uuidv7(),
              generation = m.generation + 1, attempts = m.attempts + 1, updated_at = now()
        WHERE m.org_id = (
                SELECT org_id FROM context.graph_manifests
                 WHERE status = 'pending'
                   AND stale_since IS NOT NULL
                   AND stale_since <= now() - ($1 || ' seconds')::interval
                 ORDER BY (last_user_activity_at >= now() - interval '1 day') DESC NULLS LAST,
                          stale_since ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED)
        RETURNING m.org_id, m.building_id, m.generation`,
      [String(REBUILD_DEBOUNCE_SECONDS)],
    );
    if (manifest.rowCount === 0) {
      // Nothing due. Give the slot straight back rather than holding the
      // ceiling against no work for a whole lease period.
      await client.query(FREE_SLOT, [slotNo]);
      await client.query("COMMIT");
      return null;
    }

    await client.query(`UPDATE context.rebuild_slots SET org_id = $1 WHERE slot_no = $2`, [
      manifest.rows[0].org_id,
      slotNo,
    ]);
    await client.query("COMMIT");

    return {
      orgId: manifest.rows[0].org_id,
      slotNo,
      snapshotId: manifest.rows[0].building_id,
      generation: Number(manifest.rows[0].generation),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function finishRebuild(
  claim: RebuildClaim,
  result: { sourceWatermark: Date; cdcLagSeconds: number },
): Promise<void> {
  // Platform scope: the worker is a deliberate cross-tenant actor, and setting a
  // tenant would restrict it by RLS to the very row it is trying to update
  // through the context_maintenance policy. No event, so no enqueue.
  await withTenantTransaction({ kind: "platform", orgId: claim.orgId }, async (client) => {
    await client.query(
      `UPDATE context.graph_manifests
          SET status = 'ready', snapshot_id = $2, building_id = NULL,
              last_built_at = now(), stale_since = NULL, error_message = NULL,
              source_watermark = $3, cdc_lag_seconds = $4, attempts = 0, updated_at = now()
        WHERE org_id = $1`,
      [claim.orgId, claim.snapshotId, result.sourceWatermark, result.cdcLagSeconds],
    );
    await client.query(FREE_SLOT, [claim.slotNo]);
  });
}

export async function failRebuild(claim: RebuildClaim, message: string): Promise<void> {
  await withTenantTransaction({ kind: "platform", orgId: claim.orgId }, async (client) => {
    await client.query(
      `UPDATE context.graph_manifests
          SET status = 'error', building_id = NULL, error_message = $2, updated_at = now()
        WHERE org_id = $1`,
      [claim.orgId, message.slice(0, 2000)],
    );
    // A failed build must not hold the ceiling until its lease expires.
    await client.query(FREE_SLOT, [claim.slotNo]);
  });
}
```

- [ ] **Step 5: Run tests, apply the migration, commit**

Run: `cd ads-agent && npx vitest run lib/context-graph/backpressure.test.ts lib/db/migrations/085_graph_manifest_backpressure.test.ts`
Expected: PASS (12 tests)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ads-agent/lib/db/migrations/085_graph_manifest_backpressure.up.sql
psql "$DATABASE_URL" -c "SELECT count(*) AS ceiling FROM context.rebuild_slots"
```

Expected: `ceiling | 2`

```bash
git add ads-agent/lib/db/migrations/ ads-agent/lib/context-graph/backpressure.ts ads-agent/lib/context-graph/backpressure.test.ts
git commit -m "feat(context-graph): bound rebuilds with slots, debounce and priority

Ceiling 2, debounce 300s, priority to tenants with a user active today
(datastore §12.2). The ceiling is a lease-bearing slots table rather than a
count subquery, which two concurrent claims can both satisfy."
```

---

# Wave 1 fan-in

**Skills:** `code-reviewer`
**Model:** inherit

- [ ] Merge branches for Tasks 1–5 into the integration branch, in that order.
- [ ] The only expected conflict is `ads-agent/.env.example`, which Tasks 1 and 4 both append to. Keep both blocks; the full expected contents are in "Environment variables introduced". No task in this wave touches `ads-agent/package.json`, and Task 4 is the only one that touches `infra/clickhouse/migrations/` or the root app, so neither can conflict.
- [ ] Run: `cd ads-agent && npx vitest run`, then `npx vitest run` from the repo root. Expected: green in both.
- [ ] Commit the merge.

---

## Task 6: The object store client

**Files:**
- Create: `ads-agent/lib/objectstore/client.ts`
- Create: `ads-agent/lib/objectstore/client.test.ts`

**Skills:** `typescript-pro`, `senior-backend`
**Model:** composer-2.5-fast

**Interfaces:**
- Consumes: `signS3Request`, `type S3Credentials`, `type S3RequestSpec` from `./sigv4` (Task 3).
- Produces:

```ts
export type ObjectSummary = { key: string; byteSize: number; lastModified: Date };
export class ObjectStore {
  constructor(creds: S3Credentials);
  static fromEnv(): ObjectStore;                                 // server key from ARTIFACT_*
  put(bucket: string, key: string, body: Uint8Array, mediaType: string): Promise<void>;
  get(bucket: string, key: string): Promise<Uint8Array | null>;  // null on 404
  head(bucket: string, key: string): Promise<ObjectSummary | null>;
  remove(bucket: string, key: string): Promise<void>;            // idempotent
  list(bucket: string, prefix: string): AsyncGenerator<ObjectSummary>;
}
```

Tasks 9, 11, 12, 13, 14, 15 and 16 all take an `ObjectStore` as an injectable dependency.

**Context:** Access is server-side only, through one accessor holding the credentials (datastore §13.1). No presigned URLs in the first cut: a presigned URL is a bearer token that escapes tenant checks for its lifetime, and the volume here does not justify that exposure.

`list` is an async generator because prefix listing is the *only* enumeration an object store offers, the orphan sweep has to walk all of it, and a `ListObjectsV2` response caps at 1000 keys. Returning an array would mean holding every key in memory and hiding the pagination bug until the bucket crossed a thousand objects.

`head` is what makes erasure provable rather than hopeful, so it distinguishes 404 from every other failure instead of collapsing both to `null`.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/objectstore/client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { ObjectStore } from "./client";
import type { S3Credentials } from "./sigv4";

const creds: S3Credentials = {
  endpoint: "http://127.0.0.1:3900",
  region: "garage",
  accessKeyId: "GK",
  secretAccessKey: "S",
};
const store = new ObjectStore(creds);

afterEach(() => vi.unstubAllGlobals());

function page(keys: string[], nextToken?: string): string {
  return `<?xml version="1.0"?><ListBucketResult>
    ${keys
      .map(
        (k) =>
          `<Contents><Key>${k}</Key><Size>7</Size>` +
          `<LastModified>2026-08-12T08:00:00.000Z</LastModified></Contents>`,
      )
      .join("")}
    <IsTruncated>${nextToken ? "true" : "false"}</IsTruncated>
    ${nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : ""}
  </ListBucketResult>`;
}

describe("ObjectStore.put", () => {
  it("PUTs the body with a signed Authorization header", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchFn);
    await store.put(
      "gs-artifacts", "artifacts/a/draft/b", new TextEncoder().encode("hello"), "text/plain",
    );

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3900/gs-artifacts/artifacts/a/draft/b");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toContain("AWS4-HMAC-SHA256");
    expect(init.headers["content-type"]).toBe("text/plain");
  });

  it("throws with the status and body on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => "AccessDenied",
    }));
    await expect(store.put("b", "k", new Uint8Array(), "application/json")).rejects.toThrow(
      /403.*AccessDenied/,
    );
  });
});

describe("ObjectStore.get", () => {
  it("returns the bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => new TextEncoder().encode("hi").buffer,
    }));
    const body = await store.get("b", "k");
    expect(new TextDecoder().decode(body!)).toBe("hi");
  });

  it("returns null on 404 rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => "",
    }));
    await expect(store.get("b", "k")).resolves.toBeNull();
  });
});

describe("ObjectStore.head", () => {
  it("returns size and last-modified", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({
        "content-length": "42", "last-modified": "Wed, 12 Aug 2026 08:00:00 GMT",
      }),
    }));
    await expect(store.head("b", "k")).resolves.toEqual({
      key: "k", byteSize: 42, lastModified: new Date("Wed, 12 Aug 2026 08:00:00 GMT"),
    });
  });

  it("returns null on 404, which is what proves an erasure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => "",
    }));
    await expect(store.head("b", "k")).resolves.toBeNull();
  });

  it("throws on 403 rather than reporting absence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => "",
    }));
    await expect(store.head("b", "k")).rejects.toThrow(/403/);
  });
});

describe("ObjectStore.remove", () => {
  it("treats a missing key as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => "",
    }));
    await expect(store.remove("b", "k")).resolves.toBeUndefined();
  });
});

describe("ObjectStore.list", () => {
  it("follows the continuation token across pages", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => page(["a", "b"], "TOKEN-1"),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => page(["c"]) });
    vi.stubGlobal("fetch", fetchFn);

    const keys: string[] = [];
    for await (const obj of store.list("gs-artifacts", "artifacts/")) keys.push(obj.key);

    expect(keys).toEqual(["a", "b", "c"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][0]).toContain("continuation-token=TOKEN-1");
  });

  it("parses size and timestamp from each entry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => page(["only"]),
    }));
    for await (const obj of store.list("b", "p")) {
      expect(obj).toEqual({
        key: "only", byteSize: 7, lastModified: new Date("2026-08-12T08:00:00.000Z"),
      });
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/objectstore/client.test.ts`
Expected: FAIL — `Failed to resolve import "./client"`

- [ ] **Step 3: Write the client**

```ts
// ads-agent/lib/objectstore/client.ts
import { signS3Request, type S3Credentials, type S3RequestSpec } from "./sigv4";

export type ObjectSummary = { key: string; byteSize: number; lastModified: Date };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The single server-side accessor for the object store. Access is server-side
 * only (datastore §13.1) -- no presigned URLs, because a presigned URL is a
 * bearer token that escapes tenant checks for its whole lifetime.
 */
export class ObjectStore {
  constructor(private readonly creds: S3Credentials) {}

  static fromEnv(): ObjectStore {
    return new ObjectStore({
      endpoint: requireEnv("GARAGE_S3_ENDPOINT"),
      region: process.env.GARAGE_REGION ?? "garage",
      accessKeyId: requireEnv("ARTIFACT_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("ARTIFACT_SECRET_ACCESS_KEY"),
    });
  }

  private async send(
    spec: S3RequestSpec,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const { url, headers } = signS3Request(spec, this.creds);
    return fetch(url, {
      method: spec.method,
      headers: { ...headers, ...extraHeaders },
      body: spec.body ? Buffer.from(spec.body) : undefined,
    });
  }

  async put(bucket: string, key: string, body: Uint8Array, mediaType: string): Promise<void> {
    const res = await this.send(
      { method: "PUT", bucket, key, body },
      { "content-type": mediaType },
    );
    if (!res.ok) {
      throw new Error(`PUT ${bucket}/${key} failed: ${res.status} ${await res.text()}`);
    }
  }

  async get(bucket: string, key: string): Promise<Uint8Array | null> {
    const res = await this.send({ method: "GET", bucket, key });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${bucket}/${key} failed: ${res.status} ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * null means provably absent. Any other failure throws, so an erasure check
   * can never mistake "forbidden" for "gone".
   */
  async head(bucket: string, key: string): Promise<ObjectSummary | null> {
    const res = await this.send({ method: "HEAD", bucket, key });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HEAD ${bucket}/${key} failed: ${res.status}`);
    return {
      key,
      byteSize: Number(res.headers.get("content-length") ?? 0),
      lastModified: new Date(res.headers.get("last-modified") ?? Date.now()),
    };
  }

  async remove(bucket: string, key: string): Promise<void> {
    const res = await this.send({ method: "DELETE", bucket, key });
    // S3 DELETE is idempotent: a missing key is a successful delete.
    if (![200, 202, 204, 404].includes(res.status)) {
      throw new Error(`DELETE ${bucket}/${key} failed: ${res.status} ${await res.text()}`);
    }
  }

  /**
   * Prefix listing is the only enumeration an object store offers, and a
   * ListObjectsV2 response caps at 1000 keys -- hence a generator that follows
   * the continuation token rather than an array that silently truncates.
   */
  async *list(bucket: string, prefix: string): AsyncGenerator<ObjectSummary> {
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;

      const res = await this.send({ method: "GET", bucket, query });
      if (!res.ok) throw new Error(`LIST ${bucket} failed: ${res.status} ${await res.text()}`);
      const xml = await res.text();

      for (const entry of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        // Keys are built by artifactStorageKey from UUIDs and a fixed enum, so
        // they can never contain XML entities needing unescaping.
        yield {
          key: /<Key>([\s\S]*?)<\/Key>/.exec(entry[1])![1],
          byteSize: Number(/<Size>(\d+)<\/Size>/.exec(entry[1])![1]),
          lastModified: new Date(/<LastModified>([\s\S]*?)<\/LastModified>/.exec(entry[1])![1]),
        };
      }

      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
        : undefined;
    } while (token);
  }
}
```

- [ ] **Step 4: Run tests and prove it against live Garage**

Run: `cd ads-agent && npx vitest run lib/objectstore/client.test.ts`
Expected: PASS (10 tests)

```bash
cd ads-agent && npx tsx --env-file=.env.local -e '
import { ObjectStore } from "./lib/objectstore/client";
const s = ObjectStore.fromEnv();
const key = "smoke/hello.txt";
await s.put("gs-artifacts", key, new TextEncoder().encode("hello"), "text/plain");
console.log("get:", new TextDecoder().decode((await s.get("gs-artifacts", key))!));
console.log("head:", await s.head("gs-artifacts", key));
await s.remove("gs-artifacts", key);
console.log("head after remove:", await s.head("gs-artifacts", key));
'
```

Expected: `get: hello`, a head object with `byteSize: 5`, then `head after remove: null`. This is the first live proof that the signer is correct.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/objectstore/client.ts ads-agent/lib/objectstore/client.test.ts
git commit -m "feat(objectstore): one server-side accessor over the S3 API

list() is a generator because ListObjectsV2 caps at 1000 keys and the orphan
sweep must walk everything; head() distinguishes 404 from 403 because erasure
must never mistake forbidden for gone."
```

## Task 7: Derive the graph — nodes, edges, and the similarity hop

**Files:**
- Create: `ads-agent/lib/context-graph/build.ts`
- Create: `ads-agent/lib/context-graph/build.test.ts`

**Skills:** `senior-data-engineer`, `sql-pro`
**Model:** inherit — the node/edge coverage decisions and the pgvector hop are judgement calls, not transcription.

**Interfaces:**
- Consumes: `chQuery`, `chCommand` from `./clickhouse` (Task 4); `getPool` from `../db/client`.
- Produces:

```ts
export const NODE_KINDS: readonly string[];          // 8 kinds
export const RELATIONSHIP_KINDS: readonly string[];  // 9 kinds
export function graphBuildStatements(orgId: string, snapshotId: string): string[];
export type BuildResult = {
  snapshotId: string; nodeCount: number; edgeCount: number;
  sourceWatermark: Date; cdcLagSeconds: number;
};
export function buildGraphSnapshot(orgId: string, snapshotId: string): Promise<BuildResult>;
export function buildSimilarityEdges(orgId: string, snapshotId: string, opts?: {
  perSpace?: number; minWeight?: number;
}): Promise<number>;
```

Task 14 calls `buildGraphSnapshot`; Task 10 queries what it wrote.

**Context:** The graph is a curated projection rebuilt under a new `snapshot_id` and swapped atomically (UD7, §6.2), never mutated in place — which is also what makes snapshots diffable.

**What is built, and what is not.** Data model §8 lists ten node kinds and eleven relationships. Two pairs are unbuildable from anything any spec defines, and pretending otherwise would ship empty tables that look populated:

- **`POI` and `NEAR`** need OpenStreetMap proximity data. §8 says explicitly that `NEAR` is sourced from OpenStreetMap rather than Google Places, but no spec defines an OSM ingestion, a POI table, or a schema for one. Excluded, and reported as a spec gap.
- **`Organisation` and `WORKS_FOR`** need an employer reference on a person. `adsagent.contacts` is defined by S4 and no spec gives it an employer column. Excluded for the same reason.

That leaves 8 node kinds and 9 relationships, which is enough to answer two of the three questions §6 names.

**`SIMILAR_TO` resolves datastore open question 6** ("do analytical embeddings get duplicated into ClickHouse, or does the graph reference Postgres for similarity?"). This plan takes the second option: similarity is computed in Postgres where pgvector already lives, and only the resulting pairs — space, space, weight — cross into ClickHouse. Copying embedding vectors into a columnar store to compute a cosine distance the operational store already computes would be work for its own sake.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/context-graph/build.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NODE_KINDS, RELATIONSHIP_KINDS, graphBuildStatements } from "./build";

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";

describe("graph coverage", () => {
  it("builds the eight node kinds whose source data exists", () => {
    expect([...NODE_KINDS]).toEqual([
      "Space", "Corridor", "Person", "Enquiry", "Requirement", "Campaign", "Call", "Outcome",
    ]);
  });

  it("builds the nine relationships whose source data exists", () => {
    expect([...RELATIONSHIP_KINDS]).toEqual([
      "PART_OF", "LOCATED_IN", "ENQUIRED_ABOUT", "HAS_REQUIREMENT",
      "TARGETS", "GENERATED", "ABOUT", "RESULTED_IN", "SIMILAR_TO",
    ]);
  });

  it("excludes POI/NEAR and Organisation/WORKS_FOR, which have no defined source", () => {
    expect(NODE_KINDS).not.toContain("POI");
    expect(NODE_KINDS).not.toContain("Organisation");
    expect(RELATIONSHIP_KINDS).not.toContain("NEAR");
    expect(RELATIONSHIP_KINDS).not.toContain("WORKS_FOR");
  });
});

describe("graphBuildStatements", () => {
  const statements = graphBuildStatements(ORG, SNAP);

  it("emits one statement per node kind plus one per non-similarity edge kind", () => {
    // SIMILAR_TO is written by buildSimilarityEdges, which reads Postgres.
    expect(statements).toHaveLength(NODE_KINDS.length + RELATIONSHIP_KINDS.length - 1);
  });

  it("scopes every statement to the tenant and the snapshot", () => {
    for (const sql of statements) {
      expect(sql, sql.slice(0, 90)).toContain(`toUUID('${ORG}')`);
      expect(sql, sql.slice(0, 90)).toContain(`toUUID('${SNAP}')`);
      expect(sql, sql.slice(0, 90)).toMatch(/WHERE org_id = toUUID/);
    }
  });

  it("writes only into the graph tables, never into a mirror table", () => {
    for (const sql of statements) {
      expect(sql.trimStart()).toMatch(/^INSERT INTO gentle_space\.graph_(node|edge)/);
    }
  });

  it("carries subject provenance on every person-derived node", () => {
    const person = statements.find((s) => s.includes("'Person'"))!;
    const enquiry = statements.find((s) => s.includes("'Enquiry'"))!;
    expect(person).toContain("subject_ref");
    expect(person).toContain("toString(id)");
    expect(enquiry).toContain("toString(contact_id)");
  });

  it("names a corridor hierarchy edge as PART_OF between two corridors", () => {
    const partOf = statements.find((s) => s.includes("'PART_OF'"))!;
    expect(partOf).toContain("'Corridor', 'PART_OF'");
    expect(partOf).toContain("parent_id");
  });

  it("gives GENERATED a confidence, because attribution is inferred", () => {
    const generated = statements.find((s) => s.includes("'GENERATED'"))!;
    expect(generated).toMatch(/0\.5/);
  });
});

describe("buildSimilarityEdges", () => {
  const chCommand = vi.fn();
  const query = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    chCommand.mockReset();
    query.mockReset();
    vi.doMock("./clickhouse", () => ({ chCommand, chQuery: vi.fn() }));
    vi.doMock("../db/client", () => ({ getPool: () => ({ query }) }));
  });

  it("computes similarity in Postgres and ships only the pairs to ClickHouse", async () => {
    query.mockResolvedValue({
      rows: [{
        source_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        target_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        weight: 0.91,
      }],
    });
    const { buildSimilarityEdges } = await import("./build");
    await expect(buildSimilarityEdges(ORG, SNAP)).resolves.toBe(1);

    // The cosine operator runs in Postgres; no vector leaves it.
    expect(String(query.mock.calls[0][0])).toContain("<=>");
    expect(chCommand.mock.calls[0][0]).toContain("'SIMILAR_TO'");
    expect(chCommand.mock.calls[0][0]).not.toContain("embedding");
  });

  it("writes nothing when a tenant has no similar pairs", async () => {
    query.mockResolvedValue({ rows: [] });
    const { buildSimilarityEdges } = await import("./build");
    await expect(buildSimilarityEdges(ORG, SNAP)).resolves.toBe(0);
    expect(chCommand).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/context-graph/build.test.ts`
Expected: FAIL — `Failed to resolve import "./build"`

- [ ] **Step 3: Write the build module**

```ts
// ads-agent/lib/context-graph/build.ts
import { getPool } from "../db/client";
import { chCommand, chQuery } from "./clickhouse";

/**
 * Data model §8 lists ten node kinds and eleven relationships. Two pairs are
 * excluded because no spec defines a source for them, and an empty table that
 * looks populated is worse than an absent one:
 *   - POI / NEAR               : needs an OpenStreetMap ingestion no spec defines.
 *   - Organisation / WORKS_FOR  : needs an employer column adsagent.contacts
 *                                 does not have.
 */
export const NODE_KINDS = [
  "Space", "Corridor", "Person", "Enquiry", "Requirement", "Campaign", "Call", "Outcome",
] as const;

export const RELATIONSHIP_KINDS = [
  "PART_OF", "LOCATED_IN", "ENQUIRED_ABOUT", "HAS_REQUIREMENT",
  "TARGETS", "GENERATED", "ABOUT", "RESULTED_IN", "SIMILAR_TO",
] as const;

const G = "gentle_space";

/**
 * One INSERT per kind, all scoped to one tenant and one snapshot. A rebuild
 * lands as a new snapshot and swaps atomically (§6.2), so nothing here mutates
 * or deletes an existing row.
 */
export function graphBuildStatements(orgId: string, snapshotId: string): string[] {
  const org = `toUUID('${orgId}')`;
  const snap = `toUUID('${snapshotId}')`;

  const node = (
    kind: string, idExpr: string, labelExpr: string, subjectExpr: string,
    propsExpr: string, from: string, where: string,
  ) => `INSERT INTO ${G}.graph_node
  (org_id, snapshot_id, node_id, node_kind, label, subject_ref, props)
SELECT ${org}, ${snap}, ${idExpr}, '${kind}', ${labelExpr}, ${subjectExpr}, ${propsExpr}
  FROM ${from}
 WHERE org_id = ${org} AND ${where}`;

  const edge = (
    sourceKind: string, kind: string, targetKind: string,
    sourceExpr: string, targetExpr: string, props: string, from: string, where: string,
  ) => `INSERT INTO ${G}.graph_edge
  (org_id, snapshot_id, source_id, source_kind, relationship_kind, target_id, target_kind,
   meters, weight, confidence, props)
SELECT ${org}, ${snap}, ${sourceExpr}, '${sourceKind}', '${kind}', ${targetExpr}, '${targetKind}',
       ${props}
  FROM ${from}
 WHERE org_id = ${org} AND ${where}`;

  return [
    // --- nodes -----------------------------------------------------------
    node("Space", "id", "title", "NULL",
      `toJSONString(map('area', area, 'city', city))`,
      `${G}.listings`, "is_active = 1"),
    node("Corridor", "id", "display_name", "NULL",
      `toJSONString(map('slug', slug))`,
      `${G}.corridors`, "1 = 1"),
    // A Person node and everything downstream of an enquirer carries
    // provenance, so erasure can prune it (datastore §11.2, validation F-18).
    node("Person", "id", "full_name", "toString(id)", "'{}'",
      `${G}.contacts`, "1 = 1"),
    node("Enquiry", "id", "reply_state", "toString(contact_id)",
      `toJSONString(map('reply_state', reply_state))`,
      `${G}.enquiries`, "lifecycle = 'active'"),
    node("Requirement", "enquiry_id", "'requirement'", "NULL",
      `toJSONString(map('desks_min', toString(desks_min), 'desks_max', toString(desks_max)))`,
      `${G}.enquiry_requirements`, "1 = 1"),
    node("Campaign", "id", "name", "NULL",
      `toJSONString(map('status', status))`,
      `${G}.campaigns`, "1 = 1"),
    node("Call", "id", "call_outcome", "NULL",
      `toJSONString(map('seconds', toString(call_seconds)))`,
      `${G}.enquiry_activities`, "kind = 'call'"),
    // An Outcome node exists only for a closed enquiry; its label is what the
    // conversion traversal counts.
    node("Outcome", "id", `if(reply_state = 'closed', 'won', 'open')`,
      "toString(contact_id)", "'{}'",
      `${G}.enquiries`, "reply_state = 'closed' AND lifecycle = 'active'"),

    // --- edges -----------------------------------------------------------
    // Hierarchy as edges, not materialised paths (§6.2, data model §4).
    edge("Corridor", "PART_OF", "Corridor", "id", "parent_id",
      "NULL, NULL, NULL, '{}'", `${G}.corridors`, "parent_id IS NOT NULL"),
    edge("Space", "LOCATED_IN", "Corridor", "listing_id", "corridor_id",
      "NULL, NULL, confidence, '{}'", `${G}.listing_corridors`, "1 = 1"),
    edge("Person", "ENQUIRED_ABOUT", "Space", "contact_id", "listing_id",
      "NULL, NULL, NULL, '{}'", `${G}.enquiries`,
      "contact_id IS NOT NULL AND listing_id IS NOT NULL AND lifecycle = 'active'"),
    edge("Enquiry", "HAS_REQUIREMENT", "Requirement", "enquiry_id", "enquiry_id",
      "NULL, NULL, NULL, '{}'", `${G}.enquiry_requirements`, "1 = 1"),
    edge("Campaign", "TARGETS", "Corridor", "id", "corridor_id",
      "NULL, NULL, NULL, '{}'", `${G}.campaigns`, "corridor_id IS NOT NULL"),
    // Attribution is inferred, never measured, so the edge carries a confidence
    // rather than pretending to be a fact (data model §8, §4).
    edge("Campaign", "GENERATED", "Enquiry", "campaign_id", "id",
      "NULL, NULL, 0.5, '{}'", `${G}.enquiries`,
      "campaign_id IS NOT NULL AND lifecycle = 'active'"),
    edge("Call", "ABOUT", "Enquiry", "id", "enquiry_id",
      "NULL, NULL, NULL, '{}'", `${G}.enquiry_activities`, "kind = 'call'"),
    edge("Enquiry", "RESULTED_IN", "Outcome", "id", "id",
      "NULL, NULL, NULL, '{}'", `${G}.enquiries`,
      "reply_state = 'closed' AND lifecycle = 'active'"),
  ];
}

export type BuildResult = {
  snapshotId: string;
  nodeCount: number;
  edgeCount: number;
  sourceWatermark: Date;
  cdcLagSeconds: number;
};

export async function buildGraphSnapshot(
  orgId: string,
  snapshotId: string,
): Promise<BuildResult> {
  for (const statement of graphBuildStatements(orgId, snapshotId)) {
    await chCommand(statement, { orgId });
  }
  await buildSimilarityEdges(orgId, snapshotId);

  const [counts] = await chQuery<{ nodes: string; edges: string; watermark: string | null }>(
    `SELECT
       toString((SELECT count() FROM ${G}.graph_node
                  WHERE org_id = toUUID({org:String})
                    AND snapshot_id = toUUID({snap:String}))) AS nodes,
       toString((SELECT count() FROM ${G}.graph_edge
                  WHERE org_id = toUUID({org:String})
                    AND snapshot_id = toUUID({snap:String}))) AS edges,
       toString((SELECT max(last_activity_at) FROM ${G}.enquiries
                  WHERE org_id = toUUID({org:String}))) AS watermark`,
    { orgId, params: { org: orgId, snap: snapshotId } },
  );

  // §12.1: the build records the lag it observed, so a context pack can carry
  // its own age and an agent can refuse to act on stale data.
  const sourceWatermark = counts.watermark
    ? new Date(counts.watermark.replace(" ", "T") + "Z")
    : new Date(0);
  const cdcLagSeconds = Math.max(
    0,
    Math.round((Date.now() - sourceWatermark.getTime()) / 1000),
  );

  return {
    snapshotId,
    nodeCount: Number(counts.nodes),
    edgeCount: Number(counts.edges),
    sourceWatermark,
    cdcLagSeconds,
  };
}

/**
 * SIMILAR_TO is vector-derived, and pgvector lives in Postgres. This resolves
 * datastore open question 6 in favour of "the graph references Postgres for
 * similarity": only the resulting pairs cross into ClickHouse, never the
 * embeddings themselves.
 *
 * listings.listings is shared reference data rather than a tenant table -- like
 * public.corridors -- so this query carries no scopeClause; orgId enters only as
 * the tenant stamp on the emitted edges. If listings later becomes tenant-scoped,
 * this query gains a scopeClause and the type checker will say so.
 */
export async function buildSimilarityEdges(
  orgId: string,
  snapshotId: string,
  opts: { perSpace?: number; minWeight?: number } = {},
): Promise<number> {
  const perSpace = opts.perSpace ?? 5;
  const minWeight = opts.minWeight ?? 0.75;

  const { rows } = await getPool().query<{
    source_id: string; target_id: string; weight: number;
  }>(
    `SELECT source_id, target_id, weight
       FROM (
         SELECT a.id AS source_id,
                b.id AS target_id,
                1 - (a.structured_embedding <=> b.structured_embedding) AS weight,
                row_number() OVER (
                  PARTITION BY a.id
                  ORDER BY a.structured_embedding <=> b.structured_embedding
                ) AS rn
           FROM listings.listings a
           JOIN listings.listings b
             ON b.id <> a.id
            AND b.is_active
            AND b.structured_embedding IS NOT NULL
          WHERE a.is_active
            AND a.structured_embedding IS NOT NULL
       ) ranked
      WHERE rn <= $1 AND weight >= $2`,
    [perSpace, minWeight],
  );

  if (rows.length === 0) return 0;

  const values = rows
    .map(
      (r) =>
        `(toUUID('${orgId}'), toUUID('${snapshotId}'), toUUID('${r.source_id}'), 'Space',` +
        ` 'SIMILAR_TO', toUUID('${r.target_id}'), 'Space', NULL,` +
        ` ${r.weight.toFixed(6)}, NULL, '{}')`,
    )
    .join(",\n");

  await chCommand(
    `INSERT INTO ${G}.graph_edge
       (org_id, snapshot_id, source_id, source_kind, relationship_kind, target_id, target_kind,
        meters, weight, confidence, props)
     VALUES\n${values}`,
    { orgId },
  );
  return rows.length;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `cd ads-agent && npx vitest run lib/context-graph/build.test.ts`
Expected: PASS (11 tests)

```bash
git add ads-agent/lib/context-graph/build.ts ads-agent/lib/context-graph/build.test.ts
git commit -m "feat(context-graph): derive nodes and edges under a new snapshot_id

Eight node kinds and nine relationships -- POI/NEAR and
Organisation/WORKS_FOR are excluded because no spec defines a source for them.
SIMILAR_TO is computed in Postgres where pgvector lives, resolving datastore
open question 6 without duplicating embeddings into ClickHouse."
```

## Task 8: Snapshot records, leases, and generation collection

**Files:**
- Create: `ads-agent/lib/db/migrations/086_graph_snapshots_leases.up.sql`
- Create: `ads-agent/lib/db/migrations/086_graph_snapshots_leases.down.sql`
- Create: `ads-agent/lib/db/migrations/086_graph_snapshots_leases.test.ts`
- Create: `ads-agent/lib/context-graph/snapshot-lease.ts`
- Create: `ads-agent/lib/context-graph/snapshot-lease.test.ts`

**Skills:** `postgres-pro`, `gdpr-dsgvo-expert`
**Model:** inherit — `expires_at` is a compliance control, and deciding what happens when the *current* generation expires is a judgement call the spec leaves open.

**Interfaces:**
- Consumes: `scopeClause`, `type Scope` from `../db/scope-sql`; `getPool` from `../db/client`; `readMigration`, `assertTenantTableHardening` from `../db/migrations/migration-assertions`; `ObjectStore` from `../objectstore/client` (Task 6).
- Produces:

```ts
export const SNAPSHOT_TTL_SECONDS: number;        // 604800
export const SNAPSHOT_LEASE_SECONDS: number;      // 300
export const SNAPSHOT_GENERATIONS_KEPT: number;   // 2
export type SnapshotRecord = {
  orgId: string; snapshotId: string; generation: number;
  bucket: string; storageKey: string; byteSize: number; checksum: string;
  sourceWatermark: Date; cdcLagSeconds: number;
};
export function recordSnapshot(scope: Scope, record: SnapshotRecord): Promise<void>;
export function takeLease(scope: Scope, snapshotId: string, holder: string): Promise<string>;
export function releaseLease(scope: Scope, leaseId: string): Promise<void>;
export function collectSnapshots(store?: ObjectStore): Promise<{
  collected: Array<{ orgId: string; snapshotId: string; bucket: string; storageKey: string }>;
  blockedByLease: number;
  currentGenerationExpired: string[];
}>;
```

Task 14 calls `recordSnapshot` and `collectSnapshots`.

**Context:** "Old snapshots are garbage-collected once no reader holds them" never said how that is known. §12.2 replaces it with generations plus leases: keep the current and previous snapshot per tenant, take a lease before opening a file, and collect only snapshots older than the previous generation with no live lease.

Two rules the spec sets up but does not resolve, decided here.

**`expires_at` outranks generation.** Snapshots are "the largest exposure in the whole design: immutable per-tenant files that outlive deletion by construction" (§11.2), and data model §9 calls `expires_at` a compliance control rather than housekeeping. So an expired snapshot is collected **even when it is the current generation**. When that happens the manifest goes back to `pending` with `stale_since = now()` and `snapshot_id = NULL`, so the tenant gets a fresh file rather than silently losing context; the returned `currentGenerationExpired` list is what an alert watches.

**A live lease still blocks collection**, which is in tension with the above. It is bounded rather than unresolved: leases last 300 s, so an expired snapshot leaves within one lease window, and `blockedByLease` is a counted metric so a leak is visible instead of quiet.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/migrations/086_graph_snapshots_leases.test.ts
import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("086_graph_snapshots_leases.up.sql");

describe("086_graph_snapshots_leases", () => {
  it("hardens both tenant tables", () => {
    expect(() => assertTenantTableHardening(up, "context.graph_snapshots")).not.toThrow();
    expect(() => assertTenantTableHardening(up, "context.snapshot_leases")).not.toThrow();
  });

  it("carries the compliance columns from data model §9", () => {
    for (const col of ["expires_at", "source_watermark", "cdc_lag_seconds", "generation"]) {
      expect(up, col).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it("leads every btree index with org_id", () => {
    for (const match of up.matchAll(/CREATE INDEX[^;]*?\(([^)]*)\)/g)) {
      expect(match[1].trim(), match[0]).toMatch(/^org_id/);
    }
  });

  it("makes (org_id, snapshot_id) unique so a generation cannot be recorded twice", () => {
    expect(up).toContain("UNIQUE (org_id, snapshot_id)");
  });

  it("has a down that drops both tables", () => {
    const down = readMigration("086_graph_snapshots_leases.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.snapshot_leases");
    expect(down).toContain("DROP TABLE IF EXISTS context.graph_snapshots");
  });
});
```

```ts
// ads-agent/lib/context-graph/snapshot-lease.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";
const scope = { kind: "org", orgId: ORG } as Scope;

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));

const removed: string[] = [];
const store = {
  remove: async (_bucket: string, key: string) => { removed.push(key); },
  put: vi.fn(), get: vi.fn(), head: vi.fn(), list: vi.fn(),
};

beforeEach(() => { query.mockReset(); removed.length = 0; });

describe("recordSnapshot", () => {
  it("stores the TTL as an interval and upserts on (org_id, snapshot_id)", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { recordSnapshot, SNAPSHOT_TTL_SECONDS } = await import("./snapshot-lease");
    await recordSnapshot(scope, {
      orgId: ORG, snapshotId: SNAP, generation: 3, bucket: "gs-snap", storageKey: "s.duckdb.enc",
      byteSize: 10, checksum: "c", sourceWatermark: new Date(), cdcLagSeconds: 4,
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("ON CONFLICT (org_id, snapshot_id)");
    expect(sql).toContain("now() + ($8 || ' seconds')::interval");
    expect(query.mock.calls[0][1]).toContain(String(SNAPSHOT_TTL_SECONDS));
  });
});

describe("takeLease", () => {
  it("returns a lease id with an expiry", async () => {
    query.mockResolvedValue({ rows: [{ id: "lease-1" }], rowCount: 1 });
    const { takeLease, SNAPSHOT_LEASE_SECONDS } = await import("./snapshot-lease");
    await expect(takeLease(scope, SNAP, "web-1")).resolves.toBe("lease-1");
    expect(String(query.mock.calls[0][0])).toContain("expires_at");
    expect(query.mock.calls[0][1]).toContain(String(SNAPSHOT_LEASE_SECONDS));
  });
});

describe("collectSnapshots", () => {
  it("collects generations past the keep count and deletes their bytes", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: "r1", org_id: ORG, snapshot_id: SNAP, bucket: "gs-snap",
          storage_key: "old.duckdb.enc", is_current: false,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ blocked: "0" }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const { collectSnapshots, SNAPSHOT_GENERATIONS_KEPT } = await import("./snapshot-lease");
    const out = await collectSnapshots(store as never);

    expect(SNAPSHOT_GENERATIONS_KEPT).toBe(2);
    expect(removed).toEqual(["old.duckdb.enc"]);
    expect(out.collected).toHaveLength(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("row_number() OVER (PARTITION BY");
    expect(sql).toContain("expires_at < now()");
    expect(sql).toContain("NOT EXISTS");
  });

  it("re-marks the tenant stale when the CURRENT generation expired", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: "r1", org_id: ORG, snapshot_id: SNAP, bucket: "gs-snap",
          storage_key: "cur.duckdb.enc", is_current: true,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ blocked: "0" }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const { collectSnapshots } = await import("./snapshot-lease");
    const out = await collectSnapshots(store as never);

    expect(out.currentGenerationExpired).toEqual([ORG]);
    const sql = query.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("snapshot_id = NULL");
  });

  it("counts snapshots a live lease is holding rather than deleting them", async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ blocked: "3" }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { collectSnapshots } = await import("./snapshot-lease");
    const out = await collectSnapshots(store as never);
    expect(out.blockedByLease).toBe(3);
    expect(removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/context-graph/snapshot-lease.test.ts lib/db/migrations/086_graph_snapshots_leases.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshot-lease"` and `ENOENT ... 086_graph_snapshots_leases.up.sql`

- [ ] **Step 3: Write migration 086**

```sql
-- ads-agent/lib/db/migrations/086_graph_snapshots_leases.up.sql
-- Per-tenant DuckDB snapshot inventory and reader leases.
-- Data model §9, datastore §12.2 generation-based collection.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.graph_snapshots (
  id     UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.graph_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_id      UUID,
  ADD COLUMN IF NOT EXISTS generation       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bucket           TEXT,
  ADD COLUMN IF NOT EXISTS storage_key      TEXT,
  ADD COLUMN IF NOT EXISTS byte_size        BIGINT,
  ADD COLUMN IF NOT EXISTS checksum         TEXT,
  ADD COLUMN IF NOT EXISTS built_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A compliance control, not housekeeping: these files outlive deletion by
  -- construction (datastore §11.2), so every one has a hard TTL.
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ,
  -- Carries CDC lag forward so an agent can tell how stale its context is
  -- (validation F-5, datastore §12.1).
  ADD COLUMN IF NOT EXISTS source_watermark TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cdc_lag_seconds  INTEGER,
  ADD COLUMN IF NOT EXISTS collected_at     TIMESTAMPTZ;

ALTER TABLE context.graph_snapshots
  ALTER COLUMN snapshot_id SET NOT NULL,
  ALTER COLUMN bucket      SET NOT NULL,
  ALTER COLUMN storage_key SET NOT NULL,
  ALTER COLUMN expires_at  SET NOT NULL;

ALTER TABLE context.graph_snapshots DROP CONSTRAINT IF EXISTS graph_snapshots_unique;
ALTER TABLE context.graph_snapshots
  ADD CONSTRAINT graph_snapshots_unique UNIQUE (org_id, snapshot_id);

CREATE INDEX IF NOT EXISTS graph_snapshots_generation_idx
  ON context.graph_snapshots (org_id, generation DESC) WHERE collected_at IS NULL;

ALTER TABLE context.graph_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.graph_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.graph_snapshots;
CREATE POLICY tenant_isolation ON context.graph_snapshots
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE TABLE IF NOT EXISTS context.snapshot_leases (
  id     UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.snapshot_leases
  ADD COLUMN IF NOT EXISTS snapshot_id UUID,
  ADD COLUMN IF NOT EXISTS holder      TEXT,
  ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE context.snapshot_leases
  ALTER COLUMN snapshot_id SET NOT NULL,
  ALTER COLUMN holder      SET NOT NULL,
  ALTER COLUMN expires_at  SET NOT NULL;

CREATE INDEX IF NOT EXISTS snapshot_leases_live_idx
  ON context.snapshot_leases (org_id, snapshot_id, expires_at);

ALTER TABLE context.snapshot_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.snapshot_leases FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_leases;
CREATE POLICY tenant_isolation ON context.snapshot_leases
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE, DELETE ON context.graph_snapshots TO context_maintenance;
GRANT SELECT, DELETE ON context.snapshot_leases TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_snapshots;
CREATE POLICY maintenance_cross_tenant ON context.graph_snapshots
  TO context_maintenance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_leases;
CREATE POLICY maintenance_cross_tenant ON context.snapshot_leases
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/086_graph_snapshots_leases.down.sql
BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_leases;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_leases;
DROP TABLE IF EXISTS context.snapshot_leases;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.graph_snapshots;
DROP POLICY IF EXISTS tenant_isolation ON context.graph_snapshots;
DROP TABLE IF EXISTS context.graph_snapshots;
COMMIT;
```

- [ ] **Step 4: Write `snapshot-lease.ts`**

```ts
// ads-agent/lib/context-graph/snapshot-lease.ts
import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";
import type { ObjectStore } from "../objectstore/client";

export const SNAPSHOT_TTL_SECONDS = Number(process.env.SNAPSHOT_TTL_SECONDS ?? 604800);
export const SNAPSHOT_LEASE_SECONDS = Number(process.env.SNAPSHOT_LEASE_SECONDS ?? 300);
/** Current and previous, per datastore §12.2. */
export const SNAPSHOT_GENERATIONS_KEPT = 2;

export type SnapshotRecord = {
  orgId: string;
  snapshotId: string;
  generation: number;
  bucket: string;
  storageKey: string;
  byteSize: number;
  checksum: string;
  sourceWatermark: Date;
  cdcLagSeconds: number;
};

export async function recordSnapshot(scope: Scope, record: SnapshotRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO context.graph_snapshots
       (org_id, snapshot_id, generation, bucket, storage_key, byte_size, checksum,
        expires_at, source_watermark, cdc_lag_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             now() + ($8 || ' seconds')::interval, $9, $10)
     ON CONFLICT (org_id, snapshot_id) DO UPDATE SET
       generation = EXCLUDED.generation, bucket = EXCLUDED.bucket,
       storage_key = EXCLUDED.storage_key, byte_size = EXCLUDED.byte_size,
       checksum = EXCLUDED.checksum, expires_at = EXCLUDED.expires_at,
       source_watermark = EXCLUDED.source_watermark,
       cdc_lag_seconds = EXCLUDED.cdc_lag_seconds`,
    [
      scope.orgId, record.snapshotId, record.generation, record.bucket, record.storageKey,
      record.byteSize, record.checksum, String(SNAPSHOT_TTL_SECONDS),
      record.sourceWatermark, record.cdcLagSeconds,
    ],
  );
}

/**
 * A serving process takes a lease before opening a file. Collection removes only
 * snapshots with no live lease (datastore §12.2), which is what "once no reader
 * holds them" has to mean in practice.
 */
export async function takeLease(
  scope: Scope,
  snapshotId: string,
  holder: string,
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO context.snapshot_leases (org_id, snapshot_id, holder, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)
     RETURNING id`,
    [scope.orgId, snapshotId, holder, String(SNAPSHOT_LEASE_SECONDS)],
  );
  return rows[0].id;
}

export async function releaseLease(scope: Scope, leaseId: string): Promise<void> {
  const clause = scopeClause(scope);
  await getPool().query(
    `DELETE FROM context.snapshot_leases
      WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
    [...clause.params, leaseId],
  );
}

export async function collectSnapshots(store?: ObjectStore): Promise<{
  collected: Array<{ orgId: string; snapshotId: string; bucket: string; storageKey: string }>;
  blockedByLease: number;
  currentGenerationExpired: string[];
}> {
  const pool = getPool();

  const { rows } = await pool.query<{
    id: string; org_id: string; snapshot_id: string; bucket: string;
    storage_key: string; is_current: boolean;
  }>(
    `WITH ranked AS (
       SELECT s.*,
              row_number() OVER (PARTITION BY s.org_id ORDER BY s.generation DESC) AS rn
         FROM context.graph_snapshots s
        WHERE s.collected_at IS NULL
     )
     SELECT r.id, r.org_id, r.snapshot_id, r.bucket, r.storage_key, (r.rn = 1) AS is_current
       FROM ranked r
      WHERE (r.rn > $1 OR r.expires_at < now())
        AND NOT EXISTS (
              SELECT 1 FROM context.snapshot_leases l
               WHERE l.org_id = r.org_id
                 AND l.snapshot_id = r.snapshot_id
                 AND l.expires_at > now())`,
    [SNAPSHOT_GENERATIONS_KEPT],
  );

  // Counted, not silently skipped: a lease leak would otherwise keep expired
  // files alive indefinitely with nothing saying so.
  const blockedRows = await pool.query<{ blocked: string }>(
    `WITH ranked AS (
       SELECT s.*, row_number() OVER (PARTITION BY s.org_id ORDER BY s.generation DESC) AS rn
         FROM context.graph_snapshots s WHERE s.collected_at IS NULL
     )
     SELECT count(*)::text AS blocked
       FROM ranked r
      WHERE (r.rn > $1 OR r.expires_at < now())
        AND EXISTS (
              SELECT 1 FROM context.snapshot_leases l
               WHERE l.org_id = r.org_id AND l.snapshot_id = r.snapshot_id
                 AND l.expires_at > now())`,
    [SNAPSHOT_GENERATIONS_KEPT],
  );

  const collected: Array<{
    orgId: string; snapshotId: string; bucket: string; storageKey: string;
  }> = [];
  const currentGenerationExpired: string[] = [];

  for (const row of rows) {
    if (store) await store.remove(row.bucket, row.storage_key);
    await pool.query(
      `UPDATE context.graph_snapshots SET collected_at = now() WHERE id = $1`,
      [row.id],
    );
    collected.push({
      orgId: row.org_id, snapshotId: row.snapshot_id,
      bucket: row.bucket, storageKey: row.storage_key,
    });

    if (row.is_current) {
      // expires_at outranks generation, so a current-but-expired file still
      // goes. The tenant must then get a fresh one rather than silently losing
      // context, and this list is what an alert watches.
      currentGenerationExpired.push(row.org_id);
      await pool.query(
        `UPDATE context.graph_manifests
            SET status = 'pending', snapshot_id = NULL, stale_since = now(), updated_at = now()
          WHERE org_id = $1`,
        [row.org_id],
      );
    }
  }

  return {
    collected,
    blockedByLease: Number(blockedRows.rows[0]?.blocked ?? 0),
    currentGenerationExpired,
  };
}
```

- [ ] **Step 5: Run tests, apply the migration, commit**

Run: `cd ads-agent && npx vitest run lib/context-graph/snapshot-lease.test.ts lib/db/migrations/086_graph_snapshots_leases.test.ts`
Expected: PASS (11 tests)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ads-agent/lib/db/migrations/086_graph_snapshots_leases.up.sql
psql "$DATABASE_URL" -c "SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('graph_snapshots','snapshot_leases')"
```

Expected: both rows show `t`.

```bash
git add ads-agent/lib/db/migrations/ ads-agent/lib/context-graph/snapshot-lease.ts ads-agent/lib/context-graph/snapshot-lease.test.ts
git commit -m "feat(context-graph): generation-based snapshot collection with leases

Keep current and previous, take a lease before opening a file, collect only
what no live lease holds. expires_at outranks generation because these files
outlive deletion by construction (datastore §11.2), and a collected current
generation puts the tenant back to pending rather than leaving it contextless."
```

---

# Wave 2 fan-in

**Skills:** `code-reviewer`
**Model:** inherit

- [ ] Merge branches for Tasks 6, 7, 8. No file is shared between them, so no conflicts are expected.
- [ ] Run: `cd ads-agent && npx vitest run`. Expected: green.
- [ ] Commit the merge.

---

## Task 9: `putArtifact` and `getArtifact`

**Files:**
- Create: `ads-agent/lib/artifacts/store.ts`
- Create: `ads-agent/lib/artifacts/store.test.ts`

**Skills:** `senior-backend`, `typescript-pro`
**Model:** composer-2.5-fast

**Interfaces:**
- Consumes: `artifactStorageKey`, `orgIdFromKey`, `type ArtifactContentType` from `./key` (Task 2); `ObjectStore` from `../objectstore/client` (Task 6); `scopeClause`, `type Scope` from `../db/scope-sql`; `getPool` from `../db/client`.
- Produces:

```ts
export const ARTIFACT_BUCKET: string;
export const RETENTION_DAYS: Record<ArtifactContentType, number>;
export type ArtifactRow = {
  id: string; orgId: string; storageKey: string; contentType: ArtifactContentType;
  mediaType: string; byteSize: number; checksum: string; subjectRefs: string[];
  createdAt: Date; eraseAfter: Date; erasedAt: Date | null;
};
export type PutArtifactInput = {
  contentType: ArtifactContentType; body: Uint8Array;
  mediaType?: string; subjectRefs?: string[];
};
export function putArtifact(
  scope: Scope, input: PutArtifactInput, store?: ObjectStore,
): Promise<ArtifactRow>;
export function getArtifact(scope: Scope, id: string, store?: ObjectStore): Promise<
  { row: ArtifactRow; body: Uint8Array | null } | null>;
export function listArtifactsForSubject(scope: Scope, subjectRef: string): Promise<ArtifactRow[]>;
```

Tasks 12, 13 and 15 import `ARTIFACT_BUCKET` and the row type.

**Context:** Three rules from the specs shape this module.

**Bytes first, then the row** (data model §8a). A crash between the two leaves an unreferenced object, which the orphan sweep reclaims; the reverse order leaves a row pointing at nothing, which is indistinguishable from corruption.

**The id comes from Postgres, not from Node.** The storage key contains the artifact id, so the id is needed before the bytes are written — but `randomUUID()` is v4, and the global constraint is `uuidv7()` for time-ordered inserts. One extra `SELECT uuidv7()` round trip keeps both true.

**Wrong tenant reads as absent.** `getArtifact` returns `null` rather than throwing, so the caller's 404 carries no information about whether the row exists.

Retention differs by content type on purpose: §13.4 says call recordings will dominate the byte budget once voice ships and their retention should be set deliberately against the DPDP one-year floor rather than inheriting the text default.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/artifacts/store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const NEW_ID = "22222222-2222-2222-2222-222222222222";
const scope = { kind: "org", orgId: ORG } as Scope;

const calls: string[] = [];
const query = vi.fn();

vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));

function fakeStore() {
  return {
    put: vi.fn(async () => { calls.push("put"); }),
    get: vi.fn(async () => new TextEncoder().encode("payload")),
    head: vi.fn(async () => null),
    remove: vi.fn(async () => {}),
    list: vi.fn(),
  };
}

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: NEW_ID,
  org_id: ORG,
  storage_key: `artifacts/${ORG}/draft/${NEW_ID}`,
  content_type: "draft",
  media_type: "application/json",
  byte_size: 7,
  checksum: "c",
  subject_refs: [],
  created_at: new Date(),
  erase_after: new Date(),
  erased_at: null,
  ...over,
});

beforeEach(() => { calls.length = 0; query.mockReset(); });

describe("putArtifact", () => {
  it("writes bytes before the row, so a crash leaves reclaimable residue", async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("uuidv7()")) {
        calls.push("id");
        return { rows: [{ id: NEW_ID }], rowCount: 1 };
      }
      calls.push("insert");
      return { rows: [dbRow()], rowCount: 1 };
    });
    const { putArtifact } = await import("./store");
    await putArtifact(
      scope,
      { contentType: "draft", body: new TextEncoder().encode("payload") },
      fakeStore() as never,
    );
    expect(calls).toEqual(["id", "put", "insert"]);
  });

  it("takes the id from Postgres so it is a uuidv7, not a v4", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("uuidv7()")
        ? { rows: [{ id: NEW_ID }], rowCount: 1 }
        : { rows: [dbRow()], rowCount: 1 });
    const { putArtifact } = await import("./store");
    await putArtifact(scope, { contentType: "draft", body: new Uint8Array() }, fakeStore() as never);
    expect(String(query.mock.calls[0][0])).toContain("uuidv7()");
  });

  it("builds the key from the scope and checksums the bytes", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("uuidv7()")
        ? { rows: [{ id: NEW_ID }], rowCount: 1 }
        : { rows: [dbRow()], rowCount: 1 });
    const store = fakeStore();
    const { putArtifact } = await import("./store");
    await putArtifact(
      scope, { contentType: "draft", body: new TextEncoder().encode("hello") }, store as never,
    );

    expect(store.put.mock.calls[0][1]).toBe(`artifacts/${ORG}/draft/${NEW_ID}`);
    expect(query.mock.calls[1][1]).toContain(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("gives call recordings a different retention from text artifacts", async () => {
    const { RETENTION_DAYS } = await import("./store");
    expect(RETENTION_DAYS.draft).toBe(400);
    expect(RETENTION_DAYS.call_recording).toBe(366);
  });
});

describe("getArtifact", () => {
  it("returns null for another tenant's id, so the caller can 404", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const { getArtifact } = await import("./store");
    await expect(getArtifact(scope, NEW_ID, fakeStore() as never)).resolves.toBeNull();
  });

  it("returns the row with a null body for a tombstone", async () => {
    query.mockResolvedValue({ rows: [dbRow({ erased_at: new Date() })], rowCount: 1 });
    const store = fakeStore();
    const { getArtifact } = await import("./store");
    const out = await getArtifact(scope, NEW_ID, store as never);
    expect(out!.body).toBeNull();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("throws when the key's tenant segment disagrees with the row", async () => {
    query.mockResolvedValue({
      rows: [dbRow({ storage_key: "artifacts/33333333-3333-3333-3333-333333333333/draft/x" })],
      rowCount: 1,
    });
    const { getArtifact } = await import("./store");
    await expect(getArtifact(scope, NEW_ID, fakeStore() as never)).rejects.toThrow(
      /storage key tenant/,
    );
  });

  it("returns the bytes for a live artifact", async () => {
    query.mockResolvedValue({ rows: [dbRow()], rowCount: 1 });
    const { getArtifact } = await import("./store");
    const out = await getArtifact(scope, NEW_ID, fakeStore() as never);
    expect(new TextDecoder().decode(out!.body!)).toBe("payload");
  });
});

describe("listArtifactsForSubject", () => {
  it("uses array containment, which is what the GIN index serves", async () => {
    query.mockResolvedValue({ rows: [dbRow()], rowCount: 1 });
    const { listArtifactsForSubject } = await import("./store");
    await listArtifactsForSubject(scope, "44444444-4444-4444-4444-444444444444");
    expect(String(query.mock.calls[0][0])).toContain("subject_refs @> ARRAY[");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/artifacts/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store"`

- [ ] **Step 3: Write the store module**

```ts
// ads-agent/lib/artifacts/store.ts
import { createHash } from "node:crypto";
import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";
import { ObjectStore } from "../objectstore/client";
import { artifactStorageKey, orgIdFromKey, type ArtifactContentType } from "./key";

export const ARTIFACT_BUCKET = process.env.ARTIFACT_BUCKET ?? "gs-artifacts";

/**
 * Retention is bytes-bounded, not operation-bounded (datastore §13.4). Text
 * artifacts get the DPDP Rule 8(3) one-year floor plus a month of slack;
 * recordings will dominate the byte budget once voice ships, so they get the
 * floor exactly and not a day longer.
 */
export const RETENTION_DAYS: Record<ArtifactContentType, number> = {
  talking_points: 400,
  draft: 400,
  context_pack: 400,
  trace_payload: 400,
  call_recording: 366,
};

export type ArtifactRow = {
  id: string;
  orgId: string;
  storageKey: string;
  contentType: ArtifactContentType;
  mediaType: string;
  byteSize: number;
  checksum: string;
  subjectRefs: string[];
  createdAt: Date;
  eraseAfter: Date;
  erasedAt: Date | null;
};

export type PutArtifactInput = {
  contentType: ArtifactContentType;
  body: Uint8Array;
  mediaType?: string;
  /** Subject ids this payload names, so per-subject erasure can find it. */
  subjectRefs?: string[];
};

const SELECT_COLUMNS = `id, org_id, storage_key, content_type, media_type, byte_size,
  checksum, subject_refs, created_at, erase_after, erased_at`;

type DbRow = {
  id: string; org_id: string; storage_key: string; content_type: ArtifactContentType;
  media_type: string; byte_size: string | number; checksum: string;
  subject_refs: string[]; created_at: Date; erase_after: Date; erased_at: Date | null;
};

function toRow(row: DbRow): ArtifactRow {
  return {
    id: row.id,
    orgId: row.org_id,
    storageKey: row.storage_key,
    contentType: row.content_type,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    checksum: row.checksum,
    subjectRefs: row.subject_refs,
    createdAt: row.created_at,
    eraseAfter: row.erase_after,
    erasedAt: row.erased_at,
  };
}

export async function putArtifact(
  scope: Scope,
  input: PutArtifactInput,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<ArtifactRow> {
  const pool = getPool();

  // The key embeds the id, so the id is needed before the bytes. It comes from
  // Postgres to stay a time-ordered uuidv7 rather than a scattered v4.
  const { rows: idRows } = await pool.query<{ id: string }>("SELECT uuidv7() AS id");
  const id = idRows[0].id;

  const storageKey = artifactStorageKey(scope, input.contentType, id);
  const mediaType = input.mediaType ?? "application/json";
  const checksum = createHash("sha256").update(input.body).digest("hex");

  // Bytes first (data model §8a). A crash here leaves an unreferenced object,
  // which the orphan sweep reclaims; the reverse leaves a row pointing at
  // nothing, which is indistinguishable from corruption.
  await store.put(ARTIFACT_BUCKET, storageKey, input.body, mediaType);

  const { rows } = await pool.query<DbRow>(
    `INSERT INTO context.artifacts
       (id, org_id, storage_key, content_type, media_type, byte_size, checksum,
        subject_refs, erase_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], now() + ($9 || ' days')::interval)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id, scope.orgId, storageKey, input.contentType, mediaType,
      input.body.byteLength, checksum, input.subjectRefs ?? [],
      String(RETENTION_DAYS[input.contentType]),
    ],
  );
  return toRow(rows[0]);
}

export async function getArtifact(
  scope: Scope,
  id: string,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<{ row: ArtifactRow; body: Uint8Array | null } | null> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<DbRow>(
    `SELECT ${SELECT_COLUMNS} FROM context.artifacts
      WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
    [...clause.params, id],
  );
  // Absent and another tenant's look identical to the caller, so the 404 leaks
  // nothing about whether the id exists.
  if (rows.length === 0) return null;

  const row = toRow(rows[0]);

  // The accessor checks the key's tenant against the row on every read
  // (datastore §13.1). The CHECK constraint should make this impossible; if it
  // fires, something wrote around the constraint.
  if (orgIdFromKey(row.storageKey) !== row.orgId) {
    throw new Error(`artifact ${row.id}: storage key tenant does not match row org_id`);
  }

  // Tombstone: the row survives so a dangling reference renders "content
  // erased" rather than an unexplained 404.
  if (row.erasedAt) return { row, body: null };

  return { row, body: await store.get(ARTIFACT_BUCKET, row.storageKey) };
}

export async function listArtifactsForSubject(
  scope: Scope,
  subjectRef: string,
): Promise<ArtifactRow[]> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<DbRow>(
    `SELECT ${SELECT_COLUMNS} FROM context.artifacts
      WHERE ${clause.sql}
        AND subject_refs @> ARRAY[$${clause.params.length + 1}]::uuid[]
        AND erased_at IS NULL
      ORDER BY created_at DESC`,
    [...clause.params, subjectRef],
  );
  return rows.map(toRow);
}
```

- [ ] **Step 4: Run tests and commit**

Run: `cd ads-agent && npx vitest run lib/artifacts/store.test.ts`
Expected: PASS (9 tests)

```bash
git add ads-agent/lib/artifacts/store.ts ads-agent/lib/artifacts/store.test.ts
git commit -m "feat(artifacts): write bytes then the row, read tenant-scoped

Write order is the whole point: a crash between the two must leave an
unreferenced object the orphan sweep reclaims, never a row pointing at
nothing. The artifact id comes from Postgres so it stays a uuidv7."
```

## Task 10: The named traversals

**Files:**
- Create: `ads-agent/lib/context-graph/traverse.ts`
- Create: `ads-agent/lib/context-graph/traverse.test.ts`

**Skills:** `sql-pro`, `rag-architect`
**Model:** inherit — choosing which of §6's questions the edge model can actually answer is judgement.

**Interfaces:**
- Consumes: `chQuery` from `./clickhouse` (Task 4); `type Scope` from `../db/scope-sql`.
- Produces:

```ts
export type ConvertingCorridor = {
  corridorId: string; corridorLabel: string;
  enquiries: number; converted: number; conversionRate: number;
};
export type SubstituteSpace = {
  spaceId: string; label: string; weight: number; corridorId: string | null;
};
export function convertingCorridors(scope: Scope, snapshotId: string, opts?: {
  minEnquiries?: number;
}): Promise<ConvertingCorridor[]>;
export function substituteSpaces(
  scope: Scope, snapshotId: string, spaceId: string, limit?: number,
): Promise<SubstituteSpace[]>;
export function corridorAncestors(
  scope: Scope, snapshotId: string, corridorId: string,
): Promise<string[]>;
```

Task 16 runs `convertingCorridors` as the S8 gate; S9's MCP context server will call all three.

**Context:** Dropping the graph engine means traversals are SQL joins written by hand, which are more verbose than Cypher and easier to get wrong. The mitigation on record (datastore §9) is to keep them behind named functions rather than scattered across callers. This file is that boundary; nothing outside it writes graph SQL.

**Depth is bounded on purpose.** §6.1 notes SQL/PGQ has no variable-length paths — "you write every hop explicitly" — and states that our known queries fit inside that limit. `corridorAncestors` therefore walks three explicit hops rather than a recursive CTE, which also means the same shape becomes `GRAPH_TABLE` by declaration once PostgreSQL 19 SQL/PGQ is GA, instead of needing a rewrite.

`convertingCorridors` is the gate query, and its path is worth spelling out because §6's phrasing suggests a different one. §6 asks *"which corridors do enquiries that convert actually originate from"*. There is **no** `Enquiry → Space` or `Enquiry → Corridor` edge in data model §8, so the corridor is reached through the campaign: `Corridor ←TARGETS← Campaign →GENERATED→ Enquiry →RESULTED_IN→ Outcome`. Three hops, every edge in the spec, and the `confidence` on `GENERATED` is the honest reminder that attribution is inferred.

Every function passes `org_id` as an explicit predicate **and** as the ClickHouse tenant setting. Application filtering is the front line; the row policy is the backstop for developer error.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/context-graph/traverse.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const chQuery = vi.fn();
vi.mock("./clickhouse", () => ({ chQuery }));

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";
const SPACE = "33333333-3333-3333-3333-333333333333";
const CORRIDOR = "44444444-4444-4444-4444-444444444444";
const scope = { kind: "org", orgId: ORG } as Scope;

beforeEach(() => chQuery.mockReset());

describe("convertingCorridors", () => {
  it("traverses TARGETS then GENERATED then RESULTED_IN", async () => {
    chQuery.mockResolvedValue([]);
    const { convertingCorridors } = await import("./traverse");
    await convertingCorridors(scope, SNAP);
    const sql = String(chQuery.mock.calls[0][0]);
    expect(sql).toContain("'TARGETS'");
    expect(sql).toContain("'GENERATED'");
    expect(sql).toContain("'RESULTED_IN'");
  });

  it("bounds the tenant twice: as a predicate and as the row-policy setting", async () => {
    chQuery.mockResolvedValue([]);
    const { convertingCorridors } = await import("./traverse");
    await convertingCorridors(scope, SNAP);
    const [sql, opts] = chQuery.mock.calls[0];
    expect(String(sql)).toContain("org_id = toUUID({org:String})");
    expect(opts).toMatchObject({
      orgId: ORG,
      params: expect.objectContaining({ org: ORG, snap: SNAP }),
    });
  });

  it("maps rows and returns a numeric rate", async () => {
    chQuery.mockResolvedValue([
      {
        corridorId: CORRIDOR, corridorLabel: "HSR Layout",
        enquiries: "10", converted: "3", conversionRate: 0.3,
      },
    ]);
    const { convertingCorridors } = await import("./traverse");
    await expect(convertingCorridors(scope, SNAP)).resolves.toEqual([
      {
        corridorId: CORRIDOR, corridorLabel: "HSR Layout",
        enquiries: 10, converted: 3, conversionRate: 0.3,
      },
    ]);
  });

  it("applies a minimum enquiry count so one lucky enquiry is not a trend", async () => {
    chQuery.mockResolvedValue([]);
    const { convertingCorridors } = await import("./traverse");
    await convertingCorridors(scope, SNAP, { minEnquiries: 5 });
    expect(chQuery.mock.calls[0][1].params.minEnquiries).toBe("5");
  });
});

describe("substituteSpaces", () => {
  it("traverses SIMILAR_TO then LOCATED_IN and orders by weight", async () => {
    chQuery.mockResolvedValue([]);
    const { substituteSpaces } = await import("./traverse");
    await substituteSpaces(scope, SNAP, SPACE, 5);
    const sql = String(chQuery.mock.calls[0][0]);
    expect(sql).toContain("'SIMILAR_TO'");
    expect(sql).toContain("'LOCATED_IN'");
    expect(sql).toContain("ORDER BY weight DESC");
    expect(chQuery.mock.calls[0][1].params.limit).toBe("5");
  });
});

describe("corridorAncestors", () => {
  it("walks bounded explicit hops, never a recursive CTE", async () => {
    chQuery.mockResolvedValue([{ l1: "a", l2: "b", l3: null }]);
    const { corridorAncestors } = await import("./traverse");
    await expect(corridorAncestors(scope, SNAP, CORRIDOR)).resolves.toEqual(["a", "b"]);
    const sql = String(chQuery.mock.calls[0][0]);
    expect(sql).not.toMatch(/WITH\s+RECURSIVE/i);
    expect(sql.match(/'PART_OF'/g)).toHaveLength(3);
  });

  it("returns an empty list for a top-level corridor", async () => {
    chQuery.mockResolvedValue([{ l1: null, l2: null, l3: null }]);
    const { corridorAncestors } = await import("./traverse");
    await expect(corridorAncestors(scope, SNAP, CORRIDOR)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/context-graph/traverse.test.ts`
Expected: FAIL — `Failed to resolve import "./traverse"`

- [ ] **Step 3: Write the traversals**

```ts
// ads-agent/lib/context-graph/traverse.ts
import type { Scope } from "../db/scope-sql";
import { chQuery } from "./clickhouse";

/**
 * Every traversal in the system lives here. Dropping the graph engine means
 * multi-hop queries are hand-written joins; the mitigation on record
 * (datastore §9) is to keep them behind named functions rather than scattered
 * across callers. Nothing outside this file writes graph SQL.
 *
 * Depth is bounded, never variable-length, so the same shape translates to
 * SQL/PGQ GRAPH_TABLE by declaration once PostgreSQL 19 is GA (§6.1).
 */
const G = "gentle_space";
const TENANT = `org_id = toUUID({org:String}) AND snapshot_id = toUUID({snap:String})`;

export type ConvertingCorridor = {
  corridorId: string;
  corridorLabel: string;
  enquiries: number;
  converted: number;
  conversionRate: number;
};

/**
 * Which corridors do converting enquiries come from (§6)?
 *
 * There is no Enquiry->Corridor edge in data model §8, so the corridor is
 * reached through the campaign:
 *   Corridor <-TARGETS- Campaign -GENERATED-> Enquiry -RESULTED_IN-> Outcome
 * The confidence on GENERATED is the reminder that attribution is inferred.
 */
export async function convertingCorridors(
  scope: Scope,
  snapshotId: string,
  opts: { minEnquiries?: number } = {},
): Promise<ConvertingCorridor[]> {
  const rows = await chQuery<{
    corridorId: string; corridorLabel: string;
    enquiries: string; converted: string; conversionRate: number;
  }>(
    `WITH campaign_corridor AS (
       SELECT source_id AS campaign_id, target_id AS corridor_id
         FROM ${G}.graph_edge
        WHERE ${TENANT} AND relationship_kind = 'TARGETS'
          AND source_kind = 'Campaign' AND target_kind = 'Corridor'
     ),
     campaign_enquiry AS (
       SELECT source_id AS campaign_id, target_id AS enquiry_id
         FROM ${G}.graph_edge
        WHERE ${TENANT} AND relationship_kind = 'GENERATED'
          AND source_kind = 'Campaign' AND target_kind = 'Enquiry'
     ),
     enquiry_outcome AS (
       SELECT e.source_id AS enquiry_id, n.label AS outcome
         FROM ${G}.graph_edge e
         INNER JOIN ${G}.graph_node n
                 ON n.org_id = e.org_id AND n.snapshot_id = e.snapshot_id
                AND n.node_id = e.target_id AND n.node_kind = 'Outcome'
        WHERE e.${TENANT} AND e.relationship_kind = 'RESULTED_IN'
          AND e.source_kind = 'Enquiry'
     )
     SELECT toString(cc.corridor_id)                     AS corridorId,
            any(cn.label)                                AS corridorLabel,
            toString(count())                            AS enquiries,
            toString(countIf(eo.outcome = 'won'))        AS converted,
            countIf(eo.outcome = 'won') / count()        AS conversionRate
       FROM campaign_corridor cc
       INNER JOIN campaign_enquiry ce ON ce.campaign_id = cc.campaign_id
       LEFT  JOIN enquiry_outcome  eo ON eo.enquiry_id  = ce.enquiry_id
       INNER JOIN ${G}.graph_node  cn
               ON cn.${TENANT} AND cn.node_id = cc.corridor_id AND cn.node_kind = 'Corridor'
      GROUP BY cc.corridor_id
     HAVING count() >= {minEnquiries:UInt32}
      ORDER BY conversionRate DESC, count() DESC`,
    {
      // Explicit predicate AND the row-policy setting: application filtering is
      // the front line, RLS is the backstop for developer error.
      orgId: scope.orgId,
      params: {
        org: scope.orgId,
        snap: snapshotId,
        minEnquiries: String(opts.minEnquiries ?? 1),
      },
    },
  );

  return rows.map((r) => ({
    corridorId: r.corridorId,
    corridorLabel: r.corridorLabel,
    enquiries: Number(r.enquiries),
    converted: Number(r.converted),
    conversionRate: Number(r.conversionRate),
  }));
}

export type SubstituteSpace = {
  spaceId: string;
  label: string;
  weight: number;
  corridorId: string | null;
};

/**
 * Which spaces are substitutes for the one a client rejected (§6)?
 *   Space -SIMILAR_TO-> Space -LOCATED_IN-> Corridor
 */
export async function substituteSpaces(
  scope: Scope,
  snapshotId: string,
  spaceId: string,
  limit = 10,
): Promise<SubstituteSpace[]> {
  const rows = await chQuery<{
    spaceId: string; label: string; weight: number; corridorId: string | null;
  }>(
    `SELECT toString(sim.target_id)                       AS spaceId,
            n.label                                       AS label,
            sim.weight                                    AS weight,
            nullIf(toString(any(loc.target_id)), '')      AS corridorId
       FROM ${G}.graph_edge sim
       INNER JOIN ${G}.graph_node n
               ON n.${TENANT} AND n.node_id = sim.target_id AND n.node_kind = 'Space'
       LEFT  JOIN ${G}.graph_edge loc
               ON loc.org_id = sim.org_id AND loc.snapshot_id = sim.snapshot_id
              AND loc.source_id = sim.target_id AND loc.relationship_kind = 'LOCATED_IN'
      WHERE sim.${TENANT}
        AND sim.relationship_kind = 'SIMILAR_TO'
        AND sim.source_id = toUUID({space:String})
      GROUP BY sim.target_id, n.label, sim.weight
      ORDER BY weight DESC
      LIMIT {limit:UInt32}`,
    {
      orgId: scope.orgId,
      params: { org: scope.orgId, snap: snapshotId, space: spaceId, limit: String(limit) },
    },
  );

  return rows.map((r) => ({
    spaceId: r.spaceId,
    label: r.label,
    weight: Number(r.weight),
    corridorId: r.corridorId,
  }));
}

/**
 * Area within Corridor within City, walked as PART_OF edges rather than a
 * materialised path (§6.2 rejects traversal_path). Three explicit hops, which
 * is the depth the vocabulary has and the depth SQL/PGQ will permit.
 */
export async function corridorAncestors(
  scope: Scope,
  snapshotId: string,
  corridorId: string,
): Promise<string[]> {
  const [row] = await chQuery<{ l1: string | null; l2: string | null; l3: string | null }>(
    `SELECT nullIf(toString(any(h1.target_id)), '') AS l1,
            nullIf(toString(any(h2.target_id)), '') AS l2,
            nullIf(toString(any(h3.target_id)), '') AS l3
       FROM (SELECT toUUID({corridor:String}) AS start) s
       LEFT JOIN ${G}.graph_edge h1
              ON h1.${TENANT} AND h1.relationship_kind = 'PART_OF' AND h1.source_id = s.start
       LEFT JOIN ${G}.graph_edge h2
              ON h2.${TENANT} AND h2.relationship_kind = 'PART_OF' AND h2.source_id = h1.target_id
       LEFT JOIN ${G}.graph_edge h3
              ON h3.${TENANT} AND h3.relationship_kind = 'PART_OF' AND h3.source_id = h2.target_id`,
    {
      orgId: scope.orgId,
      params: { org: scope.orgId, snap: snapshotId, corridor: corridorId },
    },
  );

  return [row?.l1, row?.l2, row?.l3].filter((id): id is string => Boolean(id));
}
```

- [ ] **Step 4: Run tests and commit**

Run: `cd ads-agent && npx vitest run lib/context-graph/traverse.test.ts`
Expected: PASS (8 tests)

```bash
git add ads-agent/lib/context-graph/traverse.ts ads-agent/lib/context-graph/traverse.test.ts
git commit -m "feat(context-graph): three named traversals over the edge tables

The only place graph SQL is written, per the datastore §9 mitigation for
dropping the query language. Depth is bounded, so the same shape becomes
SQL/PGQ by declaration rather than by rewrite."
```

## Task 11: Per-tenant snapshot storage is an IAM boundary

**Files:**
- Create: `ads-agent/lib/objectstore/garage-admin.ts`
- Create: `ads-agent/lib/objectstore/garage-admin.test.ts`
- Create: `ads-agent/lib/context-graph/envelope.ts`
- Create: `ads-agent/lib/context-graph/envelope.test.ts`
- Create: `ads-agent/lib/db/migrations/087_snapshot_tenant_storage.up.sql`
- Create: `ads-agent/lib/db/migrations/087_snapshot_tenant_storage.down.sql`
- Create: `ads-agent/lib/db/migrations/087_snapshot_tenant_storage.test.ts`
- Create: `ads-agent/lib/context-graph/snapshot-iam.ts`
- Create: `ads-agent/lib/context-graph/snapshot-iam.test.ts`

**Skills:** `security-engineer`, `cloud-architect`
**Model:** inherit — the spec asks for a GCS/CMEK model and Garage's permission model does not match it; the substitution has to be reasoned, not transcribed.

**Interfaces:**
- Consumes: `type S3Credentials` from `../objectstore/sigv4`; `type Scope`, `scopeClause` from `../db/scope-sql`; `getPool`; `readMigration`, `assertTenantTableHardening`.
- Produces:

```ts
// garage-admin.ts
export type GarageAdmin = { endpoint: string; token: string };
export function garageAdminFromEnv(): GarageAdmin;
export function createBucket(admin: GarageAdmin, globalAlias: string): Promise<{ id: string }>;
export function getBucketByAlias(
  admin: GarageAdmin, globalAlias: string,
): Promise<{ id: string } | null>;
export function createKey(
  admin: GarageAdmin, name: string,
): Promise<{ accessKeyId: string; secretAccessKey: string }>;
export function allowBucketKey(
  admin: GarageAdmin, bucketId: string, accessKeyId: string,
  permissions: { read: boolean; write: boolean; owner: boolean },
): Promise<void>;
export function deleteBucket(admin: GarageAdmin, bucketId: string): Promise<void>;

// envelope.ts
export function sealSecret(plaintext: string | Uint8Array): Buffer;
export function openSecret(sealed: Uint8Array): Buffer;

// snapshot-iam.ts
export function snapshotBucketName(orgId: string): string;   // gs-snap-{org_id}
export type SnapshotStorage = { bucket: string; readerAccessKeyId: string };
export function provisionSnapshotStorage(scope: Scope): Promise<SnapshotStorage>;
export function readerCredentials(scope: Scope): Promise<S3Credentials>;
export function tenantDataKey(scope: Scope): Promise<Buffer>;
export function destroyTenantSnapshotKey(scope: Scope): Promise<void>;
```

Task 14 calls `provisionSnapshotStorage`, `snapshotBucketName` and `tenantDataKey`; Task 16 uses `readerCredentials` for the isolation test.

**Context:** §12.3 says each snapshot file holds one tenant's complete dataset, so wherever they live that storage becomes a tenant-isolation boundary alongside RLS. It names three controls: one object prefix per tenant, a serving credential scoped to that prefix rather than bucket-wide, and CMEK per tenant so destroying a key erases every snapshot at once.

**Two of the three translate to Garage; one does not, and the substitution is deliberate.**

*Prefix per tenant becomes bucket per tenant.* Garage grants permissions **per bucket** — `read`, `write`, `owner` — and has no prefix-scoped grant. A shared bucket with per-tenant prefixes would make the file boundary decorative, which is the exact failure §12.3 warns against. So each tenant gets `gs-snap-{org_id}` (44 characters, inside the 63-character DNS limit) plus its own access key holding `read` on that bucket and nothing else. The server key holds `write` on every tenant bucket so the builder can upload.

*CMEK per tenant becomes application-side envelope encryption.* Garage has no KMS integration, and no spec has chosen a key manager — data model open question 1 is still open between `pgcrypto` and GCP KMS. Rather than block on that, snapshot bytes are sealed with a per-tenant AES-256-GCM data key, and the data key itself is sealed under `SNAPSHOT_MASTER_KEY` before it goes into Postgres. Destroying the tenant's data key crypto-shreds every snapshot that tenant ever had, which is the property §11.2 wanted.

**The recorded trade-off:** the sealed data keys live in the same database as the metadata, so a full-database compromise plus the environment yields both. That is strictly weaker than KMS. The mitigation is that the master key is *not* in the database, so a database dump alone is not enough. Moving `SNAPSHOT_MASTER_KEY` into GCP KMS is a one-function change in `envelope.ts` and is the intended follow-up when data model open question 1 closes.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/objectstore/garage-admin.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  allowBucketKey, createBucket, createKey, deleteBucket, getBucketByAlias,
  type GarageAdmin,
} from "./garage-admin";

const admin: GarageAdmin = { endpoint: "http://127.0.0.1:3903", token: "T" };
const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) });

afterEach(() => vi.unstubAllGlobals());

describe("garage admin api v2", () => {
  it("creates a bucket by global alias", async () => {
    const fetchFn = ok({ id: "b1", globalAliases: ["gs-snap-x"] });
    vi.stubGlobal("fetch", fetchFn);
    await expect(createBucket(admin, "gs-snap-x")).resolves.toEqual({ id: "b1" });
    expect(fetchFn.mock.calls[0][0]).toBe("http://127.0.0.1:3903/v2/CreateBucket");
    expect(fetchFn.mock.calls[0][1].method).toBe("POST");
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe("Bearer T");
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ globalAlias: "gs-snap-x" });
  });

  it("creates a key and returns the secret, which is shown exactly once", async () => {
    vi.stubGlobal("fetch", ok({ accessKeyId: "GK1", secretAccessKey: "S1", name: "n" }));
    await expect(createKey(admin, "n")).resolves.toEqual({
      accessKeyId: "GK1", secretAccessKey: "S1",
    });
  });

  it("grants read-only, never owner, for a tenant reader", async () => {
    const fetchFn = ok({ id: "b1" });
    vi.stubGlobal("fetch", fetchFn);
    await allowBucketKey(admin, "b1", "GK1", { read: true, write: false, owner: false });
    expect(fetchFn.mock.calls[0][0]).toBe("http://127.0.0.1:3903/v2/AllowBucketKey");
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
      bucketId: "b1", accessKeyId: "GK1",
      permissions: { read: true, write: false, owner: false },
    });
  });

  it("returns null rather than throwing for an unknown alias", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => "NoSuchBucket",
    }));
    await expect(getBucketByAlias(admin, "nope")).resolves.toBeNull();
  });

  it("deletes by id as a query parameter", async () => {
    const fetchFn = ok({});
    vi.stubGlobal("fetch", fetchFn);
    await deleteBucket(admin, "b1");
    expect(fetchFn.mock.calls[0][0]).toBe("http://127.0.0.1:3903/v2/DeleteBucket?id=b1");
  });

  it("throws with the server body on any other error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => "boom",
    }));
    await expect(createBucket(admin, "x")).rejects.toThrow(/500.*boom/);
  });
});
```

```ts
// ads-agent/lib/context-graph/envelope.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { openSecret, sealSecret } from "./envelope";

beforeEach(() => {
  process.env.SNAPSHOT_MASTER_KEY = "a".repeat(64);
});

describe("envelope", () => {
  it("round-trips", () => {
    expect(openSecret(sealSecret("hello")).toString("utf8")).toBe("hello");
  });

  it("is non-deterministic, so two seals of one value differ", () => {
    expect(sealSecret("hello").equals(sealSecret("hello"))).toBe(false);
  });

  it("rejects a tampered ciphertext rather than returning garbage", () => {
    const sealed = sealSecret("hello");
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => openSecret(sealed)).toThrow();
  });

  it("refuses to run without a 32-byte master key", () => {
    process.env.SNAPSHOT_MASTER_KEY = "tooshort";
    expect(() => sealSecret("hello")).toThrow(/SNAPSHOT_MASTER_KEY/);
  });
});
```

```ts
// ads-agent/lib/db/migrations/087_snapshot_tenant_storage.test.ts
import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("087_snapshot_tenant_storage.up.sql");

describe("087_snapshot_tenant_storage", () => {
  it("hardens the table", () => {
    expect(() => assertTenantTableHardening(up, "context.snapshot_storage")).not.toThrow();
  });

  it("stores only sealed secrets, never plaintext ones", () => {
    expect(up).toContain("reader_secret_sealed BYTEA");
    expect(up).toContain("data_key_sealed      BYTEA");
    expect(up).not.toMatch(/secret_access_key\s+TEXT/i);
  });

  it("records key destruction, which is what crypto-shredding evidences", () => {
    expect(up).toContain("key_destroyed_at");
  });

  it("has a down that drops the table", () => {
    expect(readMigration("087_snapshot_tenant_storage.down.sql")).toContain(
      "DROP TABLE IF EXISTS context.snapshot_storage",
    );
  });
});
```

```ts
// ads-agent/lib/context-graph/snapshot-iam.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const scope = { kind: "org", orgId: ORG } as Scope;

const query = vi.fn();
const createBucket = vi.fn();
const getBucketByAlias = vi.fn();
const createKey = vi.fn();
const allowBucketKey = vi.fn();

vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));
vi.mock("../objectstore/garage-admin", () => ({
  garageAdminFromEnv: () => ({ endpoint: "http://127.0.0.1:3903", token: "T" }),
  createBucket, getBucketByAlias, createKey, allowBucketKey,
  deleteBucket: vi.fn(),
}));

beforeEach(() => {
  process.env.SNAPSHOT_MASTER_KEY = "a".repeat(64);
  process.env.ARTIFACT_ACCESS_KEY_ID = "GKserver";
  process.env.GARAGE_S3_ENDPOINT = "http://127.0.0.1:3900";
  query.mockReset();
  createBucket.mockReset();
  getBucketByAlias.mockReset();
  createKey.mockReset();
  allowBucketKey.mockReset();
});

describe("snapshotBucketName", () => {
  it("is one bucket per tenant, because Garage grants per bucket not per prefix", async () => {
    const { snapshotBucketName } = await import("./snapshot-iam");
    expect(snapshotBucketName(ORG)).toBe(`gs-snap-${ORG}`);
    expect(snapshotBucketName(ORG).length).toBeLessThanOrEqual(63);
  });
});

describe("provisionSnapshotStorage", () => {
  it("grants the tenant reader read-only and the server key write", async () => {
    getBucketByAlias.mockResolvedValue(null);
    createBucket.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GKtenant", secretAccessKey: "Stenant" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await expect(provisionSnapshotStorage(scope)).resolves.toEqual({
      bucket: `gs-snap-${ORG}`, readerAccessKeyId: "GKtenant",
    });

    expect(allowBucketKey).toHaveBeenCalledWith(
      expect.anything(), "b1", "GKtenant", { read: true, write: false, owner: false },
    );
    expect(allowBucketKey).toHaveBeenCalledWith(
      expect.anything(), "b1", "GKserver", { read: true, write: true, owner: false },
    );
  });

  it("persists the reader secret sealed, never in plaintext", async () => {
    getBucketByAlias.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GKtenant", secretAccessKey: "Stenant" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await provisionSnapshotStorage(scope);

    const params = query.mock.calls.at(-1)![1] as unknown[];
    expect(params.some((p) => p === "Stenant")).toBe(false);
    expect(params.some((p) => Buffer.isBuffer(p))).toBe(true);
  });

  it("is idempotent when the bucket already exists", async () => {
    getBucketByAlias.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GK", secretAccessKey: "S" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await provisionSnapshotStorage(scope);
    expect(createBucket).not.toHaveBeenCalled();
  });

  it("never rotates an existing data key, which would orphan every snapshot", async () => {
    getBucketByAlias.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GK", secretAccessKey: "S" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await provisionSnapshotStorage(scope);
    expect(String(query.mock.calls.at(-1)![0])).toContain(
      "COALESCE(context.snapshot_storage.data_key_sealed",
    );
  });
});

describe("tenantDataKey", () => {
  it("throws once the key has been destroyed, which is the erasure", async () => {
    query.mockResolvedValue({
      rows: [{ data_key_sealed: null, key_destroyed_at: new Date() }], rowCount: 1,
    });
    const { tenantDataKey } = await import("./snapshot-iam");
    await expect(tenantDataKey(scope)).rejects.toThrow(/destroyed/);
  });
});

describe("destroyTenantSnapshotKey", () => {
  it("nulls the sealed key and stamps the destruction time", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { destroyTenantSnapshotKey } = await import("./snapshot-iam");
    await destroyTenantSnapshotKey(scope);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("data_key_sealed = NULL");
    expect(sql).toContain("key_destroyed_at = now()");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/objectstore/garage-admin.test.ts lib/context-graph/envelope.test.ts lib/context-graph/snapshot-iam.test.ts lib/db/migrations/087_snapshot_tenant_storage.test.ts`
Expected: FAIL — four unresolved imports / missing files.

- [ ] **Step 3: Write the Garage admin client and the envelope**

```ts
// ads-agent/lib/objectstore/garage-admin.ts
/**
 * Garage administration API v2. Endpoints are RPC-style POSTs under /v2/,
 * authenticated with a bearer token. v1 used a different, REST-ish shape, which
 * is why docker-compose.garage.yml pins a v2.x image.
 */
export type GarageAdmin = { endpoint: string; token: string };

export function garageAdminFromEnv(): GarageAdmin {
  const endpoint = process.env.GARAGE_ADMIN_ENDPOINT;
  const token = process.env.GARAGE_ADMIN_TOKEN;
  if (!endpoint) throw new Error("GARAGE_ADMIN_ENDPOINT is not set");
  if (!token) throw new Error("GARAGE_ADMIN_TOKEN is not set");
  return { endpoint: endpoint.replace(/\/$/, ""), token };
}

async function call<T>(
  admin: GarageAdmin,
  operation: string,
  init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> },
): Promise<T | null> {
  const search = init.query ? "?" + new URLSearchParams(init.query).toString() : "";
  const res = await fetch(`${admin.endpoint}/v2/${operation}${search}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${admin.token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // 404 means "no such thing", which callers handle; anything else is a fault.
    if (res.status === 404) return null;
    throw new Error(`garage ${operation} failed: ${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : null;
}

export async function createBucket(
  admin: GarageAdmin,
  globalAlias: string,
): Promise<{ id: string }> {
  const body = await call<{ id: string }>(admin, "CreateBucket", {
    method: "POST",
    body: { globalAlias },
  });
  if (!body) throw new Error(`CreateBucket ${globalAlias} returned no body`);
  return { id: body.id };
}

export async function getBucketByAlias(
  admin: GarageAdmin,
  globalAlias: string,
): Promise<{ id: string } | null> {
  const body = await call<{ id: string }>(admin, "GetBucketInfo", {
    method: "GET",
    query: { globalAlias },
  });
  return body ? { id: body.id } : null;
}

/** The secret is returned exactly once and is never retrievable again. */
export async function createKey(
  admin: GarageAdmin,
  name: string,
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
  const body = await call<{ accessKeyId: string; secretAccessKey: string | null }>(
    admin,
    "CreateKey",
    { method: "POST", body: { name } },
  );
  if (!body?.secretAccessKey) throw new Error(`CreateKey ${name} returned no secret`);
  return { accessKeyId: body.accessKeyId, secretAccessKey: body.secretAccessKey };
}

export async function allowBucketKey(
  admin: GarageAdmin,
  bucketId: string,
  accessKeyId: string,
  permissions: { read: boolean; write: boolean; owner: boolean },
): Promise<void> {
  await call(admin, "AllowBucketKey", {
    method: "POST",
    body: { bucketId, accessKeyId, permissions },
  });
}

export async function deleteBucket(admin: GarageAdmin, bucketId: string): Promise<void> {
  await call(admin, "DeleteBucket", { method: "POST", query: { id: bucketId } });
}
```

```ts
// ads-agent/lib/context-graph/envelope.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope encryption under an environment master key.
 *
 * This is the interim stand-in for the CMEK-per-tenant control in datastore
 * §12.3, because Garage has no KMS integration and data model open question 1
 * has not yet chosen between pgcrypto and GCP KMS. Sealed values live in
 * Postgres; the master key does not, so a database dump alone does not open
 * them. Replacing the key lookup below with a KMS decrypt call is the intended
 * follow-up.
 *
 * Layout: [12-byte iv][16-byte auth tag][ciphertext]
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function masterKey(): Buffer {
  const hex = process.env.SNAPSHOT_MASTER_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("SNAPSHOT_MASTER_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function sealSecret(plaintext: string | Uint8Array): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([
    cipher.update(
      typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext),
    ),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openSecret(sealed: Uint8Array): Buffer {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  // GCM authentication means a tampered ciphertext throws here rather than
  // decrypting to plausible garbage.
  return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}
```

- [ ] **Step 4: Write migration 087 and `snapshot-iam.ts`**

```sql
-- ads-agent/lib/db/migrations/087_snapshot_tenant_storage.up.sql
-- Snapshot storage is a tenancy boundary (datastore §12.3). Garage grants
-- permissions per bucket, not per prefix, so the prefix-per-tenant rule becomes
-- one bucket per tenant with a read-only key that can reach nothing else.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.snapshot_storage (
  org_id UUID PRIMARY KEY REFERENCES public.orgs(id)
);

ALTER TABLE context.snapshot_storage
  ADD COLUMN IF NOT EXISTS bucket               TEXT,
  ADD COLUMN IF NOT EXISTS garage_bucket_id     TEXT,
  ADD COLUMN IF NOT EXISTS reader_access_key_id TEXT,
  -- Sealed under SNAPSHOT_MASTER_KEY, which lives in the environment and not in
  -- this database, so a dump alone does not open it.
  ADD COLUMN IF NOT EXISTS reader_secret_sealed BYTEA,
  -- Per-tenant data key. Destroying it crypto-shreds every snapshot this tenant
  -- ever had, which is what makes §11.2's erasure practical for immutable files.
  ADD COLUMN IF NOT EXISTS data_key_sealed      BYTEA,
  ADD COLUMN IF NOT EXISTS key_destroyed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE context.snapshot_storage ALTER COLUMN bucket SET NOT NULL;

ALTER TABLE context.snapshot_storage DROP CONSTRAINT IF EXISTS snapshot_storage_bucket_unique;
ALTER TABLE context.snapshot_storage
  ADD CONSTRAINT snapshot_storage_bucket_unique UNIQUE (bucket);

ALTER TABLE context.snapshot_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.snapshot_storage FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_storage;
CREATE POLICY tenant_isolation ON context.snapshot_storage
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.snapshot_storage TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_storage;
CREATE POLICY maintenance_cross_tenant ON context.snapshot_storage
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/087_snapshot_tenant_storage.down.sql
BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.snapshot_storage;
DROP POLICY IF EXISTS tenant_isolation ON context.snapshot_storage;
DROP TABLE IF EXISTS context.snapshot_storage;
COMMIT;
```

```ts
// ads-agent/lib/context-graph/snapshot-iam.ts
import { randomBytes } from "node:crypto";
import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";
import {
  allowBucketKey, createBucket, createKey, garageAdminFromEnv, getBucketByAlias,
} from "../objectstore/garage-admin";
import type { S3Credentials } from "../objectstore/sigv4";
import { openSecret, sealSecret } from "./envelope";

/**
 * One bucket per tenant. §12.3 asks for one prefix per tenant with a credential
 * scoped to that prefix; Garage grants read/write/owner per bucket and has no
 * prefix-scoped grant, and a shared bucket with a shared read credential would
 * make the file boundary decorative -- the exact failure §12.3 names.
 * 8 + 36 = 44 characters, inside the 63-character DNS limit.
 */
export function snapshotBucketName(orgId: string): string {
  return `gs-snap-${orgId}`;
}

export type SnapshotStorage = { bucket: string; readerAccessKeyId: string };

export async function provisionSnapshotStorage(scope: Scope): Promise<SnapshotStorage> {
  const admin = garageAdminFromEnv();
  const bucket = snapshotBucketName(scope.orgId);

  const existing = await getBucketByAlias(admin, bucket);
  const bucketId = existing ? existing.id : (await createBucket(admin, bucket)).id;

  const reader = await createKey(admin, `${bucket}-reader`);
  // Read-only, this bucket only. Never owner: an owner key could grant itself
  // access to other buckets.
  await allowBucketKey(admin, bucketId, reader.accessKeyId, {
    read: true, write: false, owner: false,
  });

  // The builder uploads with the server key, which needs write here and never
  // needs a tenant's reader credential.
  const serverKeyId = process.env.ARTIFACT_ACCESS_KEY_ID;
  if (!serverKeyId) throw new Error("ARTIFACT_ACCESS_KEY_ID is not set");
  await allowBucketKey(admin, bucketId, serverKeyId, {
    read: true, write: true, owner: false,
  });

  await getPool().query(
    `INSERT INTO context.snapshot_storage
       (org_id, bucket, garage_bucket_id, reader_access_key_id, reader_secret_sealed,
        data_key_sealed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (org_id) DO UPDATE SET
       garage_bucket_id = EXCLUDED.garage_bucket_id,
       reader_access_key_id = EXCLUDED.reader_access_key_id,
       reader_secret_sealed = EXCLUDED.reader_secret_sealed,
       -- An existing data key is never rotated here: rotating it would orphan
       -- every snapshot already sealed under it.
       data_key_sealed = COALESCE(context.snapshot_storage.data_key_sealed,
                                  EXCLUDED.data_key_sealed),
       updated_at = now()`,
    [
      scope.orgId, bucket, bucketId, reader.accessKeyId,
      sealSecret(reader.secretAccessKey), sealSecret(randomBytes(32)),
    ],
  );

  return { bucket, readerAccessKeyId: reader.accessKeyId };
}

/** The credential a serving process uses. Reaches exactly one bucket. */
export async function readerCredentials(scope: Scope): Promise<S3Credentials> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<{
    bucket: string; reader_access_key_id: string; reader_secret_sealed: Buffer | null;
  }>(
    `SELECT bucket, reader_access_key_id, reader_secret_sealed
       FROM context.snapshot_storage WHERE ${clause.sql}`,
    clause.params,
  );
  const row = rows[0];
  if (!row?.reader_secret_sealed) {
    throw new Error(`no snapshot reader credential provisioned for org ${scope.orgId}`);
  }
  return {
    endpoint: process.env.GARAGE_S3_ENDPOINT ?? "http://127.0.0.1:3900",
    region: process.env.GARAGE_REGION ?? "garage",
    accessKeyId: row.reader_access_key_id,
    secretAccessKey: openSecret(row.reader_secret_sealed).toString("utf8"),
  };
}

export async function tenantDataKey(scope: Scope): Promise<Buffer> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<{
    data_key_sealed: Buffer | null; key_destroyed_at: Date | null;
  }>(
    `SELECT data_key_sealed, key_destroyed_at
       FROM context.snapshot_storage WHERE ${clause.sql}`,
    clause.params,
  );
  const row = rows[0];
  if (row?.key_destroyed_at) {
    throw new Error(`snapshot data key for org ${scope.orgId} has been destroyed`);
  }
  if (!row?.data_key_sealed) {
    throw new Error(`no snapshot data key for org ${scope.orgId}`);
  }
  return openSecret(row.data_key_sealed);
}

/** Crypto-shredding: every snapshot for this tenant becomes unreadable at once. */
export async function destroyTenantSnapshotKey(scope: Scope): Promise<void> {
  await getPool().query(
    `UPDATE context.snapshot_storage
        SET data_key_sealed = NULL, key_destroyed_at = now(), updated_at = now()
      WHERE org_id = $1 AND key_destroyed_at IS NULL`,
    [scope.orgId],
  );
}
```

- [ ] **Step 5: Run tests, apply the migration, commit**

Run: `cd ads-agent && npx vitest run lib/objectstore/garage-admin.test.ts lib/context-graph/envelope.test.ts lib/context-graph/snapshot-iam.test.ts lib/db/migrations/087_snapshot_tenant_storage.test.ts`
Expected: PASS (19 tests)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ads-agent/lib/db/migrations/087_snapshot_tenant_storage.up.sql
psql "$DATABASE_URL" -c "\d context.snapshot_storage" | grep -E 'sealed|destroyed'
```

Expected: `reader_secret_sealed | bytea`, `data_key_sealed | bytea`, `key_destroyed_at | timestamp with time zone`.

```bash
git add ads-agent/lib/objectstore/garage-admin.ts ads-agent/lib/objectstore/garage-admin.test.ts ads-agent/lib/context-graph/envelope.ts ads-agent/lib/context-graph/envelope.test.ts ads-agent/lib/context-graph/snapshot-iam.ts ads-agent/lib/context-graph/snapshot-iam.test.ts ads-agent/lib/db/migrations/
git commit -m "feat(context-graph): per-tenant snapshot bucket, reader key, data key

Garage grants per bucket and not per prefix, so §12.3's prefix-per-tenant rule
becomes bucket-per-tenant with a read-only key that can reach nothing else.
CMEK becomes envelope encryption under an environment master key until data
model open question 1 picks a key manager."
```

---

# Wave 3 fan-in

**Skills:** `code-reviewer`
**Model:** inherit

- [ ] Merge branches for Tasks 9, 10, 11. No shared files, so no conflicts are expected.
- [ ] Run: `cd ads-agent && npx vitest run`. Expected: green.
- [ ] Commit the merge.

---

## Task 12: Erasure that proves the bytes are gone

**Files:**
- Create: `ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.up.sql`
- Create: `ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.down.sql`
- Create: `ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.test.ts`
- Create: `ads-agent/lib/artifacts/erase.ts`
- Create: `ads-agent/lib/artifacts/erase.test.ts`

**Skills:** `gdpr-dsgvo-expert`, `senior-backend`
**Model:** inherit — the ordering has a compliance consequence either way and the choice needs reasoning.

**Interfaces:**
- Consumes: `ARTIFACT_BUCKET` from `./store` (Task 9); `tenantPrefix` from `./key`; `ObjectStore` from `../objectstore/client`; `withTenantTransaction` from `../db/tx` and `enqueueEvent` from `../db/outbox` (both S5a); `scopeClause`, `type Scope`; `getPool`; `readMigration`, `assertTenantTableHardening`.
- Produces:

```ts
export type EraseResult = { erasedIds: string[]; deletedKeys: string[] };
export function eraseArtifactsForSubject(
  scope: Scope, subjectRef: string, requestId: string, store?: ObjectStore,
): Promise<EraseResult>;
export function eraseArtifactsForTenant(
  scope: Scope, requestId: string, store?: ObjectStore,
): Promise<EraseResult>;
```

Plus `context.deletion_requests` and `context.deletion_propagations`, with `objectstore` in the store vocabulary. Task 13's dangling sweep reads `deletion_requests`; Task 15 is the gate.

**Context:** *"An artifact survives a write, a read, and an erasure that leaves no bytes behind"* is the S8a gate, and "no bytes behind" is a claim that has to be *checked*, not assumed. A `DELETE` that returns 204 through a proxy that swallowed it looks identical to a successful one. So each artifact is deleted, then `HEAD` must return absent, and only then is the row tombstoned. `ObjectStore.head` throws on 403 precisely so a permissions failure can never be read as "gone".

**Why bytes are deleted before the row is tombstoned.** The alternative — tombstone first, delete after — means a crash leaves a row marked erased while its bytes are still there. That is a false claim of erasure, which is the one failure mode a regulator would care about. Deleting first means a crash leaves a row not yet marked whose object is missing: recoverable, and detectable by the dangling sweep. The sweep classifies it as `mid_erasure` rather than a bug, which is why Task 13 reads `deletion_requests`.

**The ledger and the outbox commit together.** The metadata row's `erased_at` is set in the same transaction as the `deletion_propagations` write (data model §8a), and the event goes through the outbox on the same client, because a lost `deletion.requested` message is a failed erasure obligation rather than a retry (datastore §14.4).

One deviation from data model §6.1 to note: `context.deletion_propagations` there has no `org_id`. The global constraint requires `org_id NOT NULL` on every domain table, and without it the table cannot be RLS-protected — so the column is added and backfilled from the parent request.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.test.ts
import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("081_deletion_ledger_objectstore.up.sql");

describe("081_deletion_ledger_objectstore", () => {
  it("hardens both ledger tables", () => {
    expect(() => assertTenantTableHardening(up, "context.deletion_requests")).not.toThrow();
    expect(() => assertTenantTableHardening(up, "context.deletion_propagations")).not.toThrow();
  });

  it("includes objectstore in the store vocabulary", () => {
    expect(up).toContain("'objectstore'");
    expect(up).toContain("deletion_propagations_store_check");
  });

  it("adds and backfills org_id, since §6.1 omitted it and RLS needs it", () => {
    expect(up).toContain("ADD COLUMN IF NOT EXISTS org_id");
    expect(up).toMatch(/UPDATE context\.deletion_propagations[\s\S]*SET org_id = r\.org_id/);
    expect(up).toContain("ALTER COLUMN org_id SET NOT NULL");
  });

  it("has a down that drops both tables", () => {
    const down = readMigration("081_deletion_ledger_objectstore.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.deletion_propagations");
    expect(down).toContain("DROP TABLE IF EXISTS context.deletion_requests");
  });
});
```

```ts
// ads-agent/lib/artifacts/erase.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const SUBJECT = "44444444-4444-4444-4444-444444444444";
const REQUEST = "55555555-5555-5555-5555-555555555555";
const KEY = `artifacts/${ORG}/draft/22222222-2222-2222-2222-222222222222`;
const scope = { kind: "org", orgId: ORG } as Scope;

const ops: string[] = [];
const query = vi.fn();
const clientQuery = vi.fn();
const enqueueEvent = vi.fn().mockResolvedValue("evt");

vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));
vi.mock("../db/outbox", () => ({ enqueueEvent }));
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (
    _scope: unknown,
    fn: (client: { query: typeof clientQuery }) => Promise<unknown>,
  ) => fn({ query: clientQuery }),
}));

function storeWithBytes(presentAfterDelete: boolean[]) {
  let headCall = 0;
  return {
    remove: vi.fn(async (_b: string, k: string) => { ops.push(`remove:${k}`); }),
    head: vi.fn(async (_b: string, k: string) => {
      ops.push(`head:${k}`);
      return presentAfterDelete[headCall++]
        ? { key: k, byteSize: 1, lastModified: new Date() }
        : null;
    }),
    list: async function* () {
      yield { key: KEY, byteSize: 1, lastModified: new Date() };
    },
    put: vi.fn(),
    get: vi.fn(),
  };
}

beforeEach(() => {
  ops.length = 0;
  query.mockReset();
  clientQuery.mockReset();
  enqueueEvent.mockClear();
});

describe("eraseArtifactsForSubject", () => {
  it("deletes bytes, proves absence, then tombstones -- in that order", async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("subject_refs @>")) {
        return { rows: [{ id: "a1", storage_key: KEY }], rowCount: 1 };
      }
      ops.push("tombstone");
      return { rows: [], rowCount: 1 };
    });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { eraseArtifactsForSubject } = await import("./erase");
    const out = await eraseArtifactsForSubject(
      scope, SUBJECT, REQUEST, storeWithBytes([false]) as never,
    );

    expect(ops).toEqual([`remove:${KEY}`, `head:${KEY}`, "tombstone"]);
    expect(out).toEqual({ erasedIds: ["a1"], deletedKeys: [KEY] });
  });

  it("refuses to record an erasure while the object is still there", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("subject_refs @>")
        ? { rows: [{ id: "a1", storage_key: KEY }], rowCount: 1 }
        : { rows: [], rowCount: 1 });

    const { eraseArtifactsForSubject } = await import("./erase");
    await expect(
      eraseArtifactsForSubject(scope, SUBJECT, REQUEST, storeWithBytes([true]) as never),
    ).rejects.toThrow(/still present/);
    expect(ops).not.toContain("tombstone");
  });

  it("writes the ledger and the outbox event on one client, in one transaction", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("subject_refs @>")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { eraseArtifactsForSubject } = await import("./erase");
    await eraseArtifactsForSubject(scope, SUBJECT, REQUEST, storeWithBytes([]) as never);

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("context.deletion_propagations");
    expect(sql).toContain("'objectstore'");
    expect(enqueueEvent).toHaveBeenCalledWith(
      { kind: "org", orgId: ORG },
      expect.objectContaining({ query: clientQuery }),
      expect.objectContaining({
        topic: "deletion.requested",
        payload: expect.objectContaining({ store: "objectstore", requestId: REQUEST }),
      }),
    );
  });
});

describe("eraseArtifactsForTenant", () => {
  it("prefix-deletes, verifies every key, then tombstones the whole tenant", async () => {
    query.mockResolvedValue({ rows: [{ id: "a1" }], rowCount: 1 });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { eraseArtifactsForTenant } = await import("./erase");
    const out = await eraseArtifactsForTenant(scope, REQUEST, storeWithBytes([false]) as never);

    expect(ops).toEqual([`remove:${KEY}`, `head:${KEY}`]);
    expect(out.deletedKeys).toEqual([KEY]);
    expect(String(query.mock.calls[0][0])).toContain("SET erased_at = now()");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/artifacts/erase.test.ts lib/db/migrations/081_deletion_ledger_objectstore.test.ts`
Expected: FAIL — unresolved import `./erase`, and `ENOENT ... 081_deletion_ledger_objectstore.up.sql`

- [ ] **Step 3: Write migration 081**

```sql
-- ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.up.sql
-- The deletion ledger, and the objectstore propagation row the artifact store
-- writes. Data model §6.1. Cascading FK deletes prove nothing to a regulator;
-- this table is the evidence.
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

CREATE TABLE IF NOT EXISTS context.deletion_requests (
  id     UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.deletion_requests
  ADD COLUMN IF NOT EXISTS subject_kind  TEXT,
  ADD COLUMN IF NOT EXISTS subject_ref   TEXT,
  ADD COLUMN IF NOT EXISTS requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Access blocked; user-visible "deleted".
  ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ,
  -- requested_at + the DPDP Rule 8(3) retention floor.
  ADD COLUMN IF NOT EXISTS erase_after   DATE,
  ADD COLUMN IF NOT EXISTS erased_at     TIMESTAMPTZ,
  -- Rule 14(3): grievance response within 90 days maximum.
  ADD COLUMN IF NOT EXISTS respond_by    DATE;

ALTER TABLE context.deletion_requests
  ALTER COLUMN subject_kind SET NOT NULL,
  ALTER COLUMN subject_ref  SET NOT NULL,
  ALTER COLUMN erase_after  SET NOT NULL,
  ALTER COLUMN respond_by   SET NOT NULL;

ALTER TABLE context.deletion_requests
  DROP CONSTRAINT IF EXISTS deletion_requests_subject_kind_check;
ALTER TABLE context.deletion_requests
  ADD CONSTRAINT deletion_requests_subject_kind_check
  CHECK (subject_kind IN ('enquirer','user','tenant'));

CREATE INDEX IF NOT EXISTS deletion_requests_open_idx
  ON context.deletion_requests (org_id, erase_after) WHERE erased_at IS NULL;

ALTER TABLE context.deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.deletion_requests FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_requests;
CREATE POLICY tenant_isolation ON context.deletion_requests
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE TABLE IF NOT EXISTS context.deletion_propagations (
  request_id UUID NOT NULL REFERENCES context.deletion_requests(id) ON DELETE CASCADE,
  store      TEXT NOT NULL,
  PRIMARY KEY (request_id, store)
);

-- Data model §6.1 omits org_id here. The global tenancy rule requires it on
-- every domain table, and without it this table cannot be RLS-protected, so it
-- is added and backfilled from the parent request.
ALTER TABLE context.deletion_propagations
  ADD COLUMN IF NOT EXISTS org_id     UUID,
  ADD COLUMN IF NOT EXISTS state      TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS detail     TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE context.deletion_propagations p
   SET org_id = r.org_id
  FROM context.deletion_requests r
 WHERE p.request_id = r.id AND p.org_id IS NULL;

ALTER TABLE context.deletion_propagations ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE context.deletion_propagations
  DROP CONSTRAINT IF EXISTS deletion_propagations_store_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_store_check CHECK (store IN
    ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
     'vector_index','objectstore','langfuse','clickhouse_raw'));

ALTER TABLE context.deletion_propagations
  DROP CONSTRAINT IF EXISTS deletion_propagations_state_check;
ALTER TABLE context.deletion_propagations
  ADD CONSTRAINT deletion_propagations_state_check
  CHECK (state IN ('pending','suppressed','erased','failed'));

-- The reconciling sweeper's query: anything still pending past a threshold.
CREATE INDEX IF NOT EXISTS deletion_propagations_pending_idx
  ON context.deletion_propagations (org_id, store) WHERE state = 'pending';

ALTER TABLE context.deletion_propagations ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.deletion_propagations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_propagations;
CREATE POLICY tenant_isolation ON context.deletion_propagations
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT ON context.deletion_requests TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.deletion_propagations TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_requests;
CREATE POLICY maintenance_cross_tenant ON context.deletion_requests
  TO context_maintenance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_propagations;
CREATE POLICY maintenance_cross_tenant ON context.deletion_propagations
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.down.sql
BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_propagations;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_propagations;
DROP TABLE IF EXISTS context.deletion_propagations;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.deletion_requests;
DROP POLICY IF EXISTS tenant_isolation ON context.deletion_requests;
DROP TABLE IF EXISTS context.deletion_requests;
COMMIT;
```

- [ ] **Step 4: Write `erase.ts`**

```ts
// ads-agent/lib/artifacts/erase.ts
import { getPool } from "../db/client";
import { enqueueEvent } from "../db/outbox";
import { scopeClause, type Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { ObjectStore } from "../objectstore/client";
import { tenantPrefix } from "./key";
import { ARTIFACT_BUCKET } from "./store";

export type EraseResult = { erasedIds: string[]; deletedKeys: string[] };

/**
 * Delete the bytes, then prove they are gone, then tombstone the row.
 *
 * The order is the compliance decision. Tombstoning first means a crash leaves
 * a row claiming erasure over bytes that still exist -- a false claim, which is
 * the failure a regulator would care about. Deleting first means a crash leaves
 * a row not yet tombstoned whose object is missing: recoverable, and the
 * dangling sweep classifies it as mid_erasure rather than a bug.
 *
 * ObjectStore.head returns null only on 404 and throws on 403, so a permissions
 * failure can never be mistaken for absence.
 */
async function deleteAndVerify(store: ObjectStore, key: string): Promise<void> {
  await store.remove(ARTIFACT_BUCKET, key);
  if (await store.head(ARTIFACT_BUCKET, key)) {
    throw new Error(`object ${key} still present after delete; erasure not recorded`);
  }
}

async function recordPropagation(
  scope: Scope,
  requestId: string,
  count: number,
  detail: string,
): Promise<void> {
  // The metadata row's erased_at and the ledger write commit together (data
  // model §8a), and the event rides the same client, because a lost deletion
  // event is a failed erasure obligation rather than a retry (datastore §14.4).
  // Org scope: enqueueEvent refuses platform scope by design.
  await withTenantTransaction({ kind: "org", orgId: scope.orgId }, async (client) => {
    await client.query(
      `INSERT INTO context.deletion_propagations
         (request_id, org_id, store, state, detail, updated_at)
       VALUES ($1, $2, 'objectstore', 'erased', $3, now())
       ON CONFLICT (request_id, store) DO UPDATE SET
         state = 'erased', detail = EXCLUDED.detail, updated_at = now()`,
      [requestId, scope.orgId, `${count} artifacts; ${detail}`],
    );
    await enqueueEvent({ kind: "org", orgId: scope.orgId }, client, {
      topic: "deletion.requested",
      payload: { requestId, store: "objectstore", state: "erased", artifactCount: count },
    });
  });
}

export async function eraseArtifactsForSubject(
  scope: Scope,
  subjectRef: string,
  requestId: string,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<EraseResult> {
  const pool = getPool();
  const clause = scopeClause(scope);
  const { rows } = await pool.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM context.artifacts
      WHERE ${clause.sql}
        AND subject_refs @> ARRAY[$${clause.params.length + 1}]::uuid[]
        AND erased_at IS NULL`,
    [...clause.params, subjectRef],
  );

  const erasedIds: string[] = [];
  const deletedKeys: string[] = [];
  // One artifact at a time, each tombstoned as soon as its bytes are provably
  // gone, so a crash can leave at most one row mid-erasure.
  for (const row of rows) {
    await deleteAndVerify(store, row.storage_key);
    await pool.query(`UPDATE context.artifacts SET erased_at = now() WHERE id = $1`, [row.id]);
    erasedIds.push(row.id);
    deletedKeys.push(row.storage_key);
  }

  await recordPropagation(scope, requestId, erasedIds.length, `subject=${subjectRef}`);
  return { erasedIds, deletedKeys };
}

/** Tenant offboarding: prefix delete on artifacts/{org_id}/ (§13.1). */
export async function eraseArtifactsForTenant(
  scope: Scope,
  requestId: string,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<EraseResult> {
  const prefix = tenantPrefix(scope);

  const deletedKeys: string[] = [];
  for await (const object of store.list(ARTIFACT_BUCKET, prefix)) {
    await deleteAndVerify(store, object.key);
    deletedKeys.push(object.key);
  }

  const { rows } = await getPool().query<{ id: string }>(
    `UPDATE context.artifacts SET erased_at = now()
      WHERE org_id = $1 AND erased_at IS NULL
      RETURNING id`,
    [scope.orgId],
  );

  await recordPropagation(scope, requestId, rows.length, `prefix=${prefix}`);
  return { erasedIds: rows.map((r) => r.id), deletedKeys };
}
```

- [ ] **Step 5: Run tests, apply the migration, commit**

Run: `cd ads-agent && npx vitest run lib/artifacts/erase.test.ts lib/db/migrations/081_deletion_ledger_objectstore.test.ts`
Expected: PASS (8 tests)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ads-agent/lib/db/migrations/081_deletion_ledger_objectstore.up.sql
psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conname = 'deletion_propagations_store_check'"
```

Expected: one row.

```bash
git add ads-agent/lib/artifacts/erase.ts ads-agent/lib/artifacts/erase.test.ts ads-agent/lib/db/migrations/
git commit -m "feat(artifacts): erase bytes, prove absence, then tombstone

'No bytes behind' is a claim that has to be checked: DELETE then HEAD, and the
row is only marked erased once the object is provably gone. The ledger row and
the outbox event commit together, because a lost deletion event is a compliance
failure rather than a retry."
```

## Task 13: The orphan sweep and the dangling sweep

**Files:**
- Create: `ads-agent/lib/db/migrations/082_artifact_sweep_state.up.sql`
- Create: `ads-agent/lib/db/migrations/082_artifact_sweep_state.down.sql`
- Create: `ads-agent/lib/db/migrations/082_artifact_sweep_state.test.ts`
- Create: `ads-agent/lib/artifacts/sweeps.ts`
- Create: `ads-agent/lib/artifacts/sweeps.test.ts`
- Create: `ads-agent/scripts/artifact-sweeps.ts`
- Modify: `ads-agent/package.json` (add `"artifacts:sweep": "tsx --env-file=.env.local scripts/artifact-sweeps.ts"`)

**Skills:** `senior-backend`, `observability-designer`
**Model:** inherit — the grace window and the mid-erasure classification are both judgement calls with sharp failure modes.

**Interfaces:**
- Consumes: `ARTIFACT_BUCKET` from `./store` (Task 9); `ObjectStore`; `getPool`; `readMigration`, `assertTenantTableHardening`.
- Produces:

```ts
export const ORPHAN_GRACE_SECONDS: number;   // 3600
export type OrphanSweepResult = { scanned: number; deleted: string[]; skippedYoung: number };
export type DanglingFlag = {
  artifactId: string; orgId: string; classification: "mid_erasure" | "unexplained";
};
export function orphanSweep(opts?: {
  graceSeconds?: number; now?: Date; store?: ObjectStore;
}): Promise<OrphanSweepResult>;
export function danglingSweep(opts?: { store?: ObjectStore }): Promise<DanglingFlag[]>;
```

**Context:** The two stores can diverge, which Firestore's single-system model hid. §13.1 names two sweeps and they are genuinely different operations with different consequences.

**The orphan sweep deletes.** Objects with no `context.artifacts` row are the expected residue of a crash between the two writes. It needs a **grace window**, and this is the trap: the write order is bytes-then-row, so a *young* object with no row is a write in flight, not residue. Without a window the sweep races its own writer and deletes bytes that are about to be referenced. Default 3600 s.

**The dangling sweep only flags.** A row whose object is missing "is not expected and indicates a bug or an out-of-band deletion" (§13.1). But Task 12's ordering makes exactly one dangling row an expected mid-erasure artefact, so a flat alert would cry wolf on every erasure. The sweep therefore classifies: `mid_erasure` when an unfinished `deletion_requests` row covers that artifact's subject or tenant, `unexplained` otherwise. Only `unexplained` alerts.

The classification uses `CASE` rather than `OR`, because SQL does not guarantee short-circuit evaluation and `subject_ref::uuid` would raise on a non-UUID subject reference regardless of which branch "should" have run.

Both sweeps read every tenant, so they connect as `context_maintenance` — the role whose named cross-tenant policies migrations 080–082 create.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/db/migrations/082_artifact_sweep_state.test.ts
import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("082_artifact_sweep_state.up.sql");

describe("082_artifact_sweep_state", () => {
  it("hardens the tenant-scoped flags table", () => {
    expect(() => assertTenantTableHardening(up, "context.artifact_dangling_flags")).not.toThrow();
  });

  it("classifies a dangling row as mid_erasure or unexplained", () => {
    expect(up).toContain("'mid_erasure'");
    expect(up).toContain("'unexplained'");
  });

  it("records both sweeps by name", () => {
    expect(up).toMatch(/sweep IN \('orphan','dangling'\)/);
  });

  it("has a down that drops both tables", () => {
    const down = readMigration("082_artifact_sweep_state.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.artifact_dangling_flags");
    expect(down).toContain("DROP TABLE IF EXISTS context.artifact_sweep_runs");
  });
});
```

```ts
// ads-agent/lib/artifacts/sweeps.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "11111111-1111-1111-1111-111111111111";
const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const NOW = new Date("2026-08-12T12:00:00Z");
const OLD = new Date("2026-08-12T09:00:00Z");   // 3h before NOW
const YOUNG = new Date("2026-08-12T11:59:00Z"); // 1m before NOW

function listStore(objects: Array<{ key: string; lastModified: Date }>) {
  const removed: string[] = [];
  return {
    removed,
    list: async function* () {
      for (const o of objects) yield { ...o, byteSize: 1 };
    },
    remove: async (_b: string, k: string) => { removed.push(k); },
    head: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
  };
}

beforeEach(() => query.mockReset());

describe("orphanSweep", () => {
  it("deletes an object old enough to have no row", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("storage_key = $1")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 });
    const store = listStore([{ key: "artifacts/x/draft/1", lastModified: OLD }]);

    const { orphanSweep } = await import("./sweeps");
    const out = await orphanSweep({ store: store as never, now: NOW });

    expect(out).toEqual({ scanned: 1, deleted: ["artifacts/x/draft/1"], skippedYoung: 0 });
    expect(store.removed).toEqual(["artifacts/x/draft/1"]);
  });

  it("spares a young orphan, because bytes are written before the row", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("storage_key = $1")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 });
    const store = listStore([{ key: "artifacts/x/draft/2", lastModified: YOUNG }]);

    const { orphanSweep } = await import("./sweeps");
    const out = await orphanSweep({ store: store as never, now: NOW });

    expect(out).toEqual({ scanned: 1, deleted: [], skippedYoung: 1 });
    expect(store.removed).toEqual([]);
  });

  it("leaves a referenced object alone however old it is", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("storage_key = $1")
        ? { rows: [{ one: 1 }], rowCount: 1 }
        : { rows: [], rowCount: 1 });
    const store = listStore([{ key: "artifacts/x/draft/3", lastModified: OLD }]);

    const { orphanSweep } = await import("./sweeps");
    const out = await orphanSweep({ store: store as never, now: NOW });
    expect(out.deleted).toEqual([]);
    expect(store.removed).toEqual([]);
  });

  it("defaults the grace window to an hour", async () => {
    const { ORPHAN_GRACE_SECONDS } = await import("./sweeps");
    expect(ORPHAN_GRACE_SECONDS).toBe(3600);
  });
});

describe("danglingSweep", () => {
  const store = { head: vi.fn(), list: vi.fn(), remove: vi.fn(), put: vi.fn(), get: vi.fn() };

  beforeEach(() => {
    store.head.mockReset();
    store.remove.mockReset();
  });

  it("classifies a row covered by an open deletion request as mid_erasure", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a1", org_id: ORG, storage_key: "k1", open_request: true }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 });
    store.head.mockResolvedValue(null);

    const { danglingSweep } = await import("./sweeps");
    await expect(danglingSweep({ store: store as never })).resolves.toEqual([
      { artifactId: "a1", orgId: ORG, classification: "mid_erasure" },
    ]);
  });

  it("classifies an uncovered missing object as unexplained -- the case that alerts", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a2", org_id: ORG, storage_key: "k2", open_request: false }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 });
    store.head.mockResolvedValue(null);

    const { danglingSweep } = await import("./sweeps");
    await expect(danglingSweep({ store: store as never })).resolves.toEqual([
      { artifactId: "a2", orgId: ORG, classification: "unexplained" },
    ]);
  });

  it("never deletes anything", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a3", org_id: ORG, storage_key: "k3", open_request: false }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 });
    store.head.mockResolvedValue(null);

    const { danglingSweep } = await import("./sweeps");
    await danglingSweep({ store: store as never });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("flags nothing when the object is present", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a4", org_id: ORG, storage_key: "k4", open_request: false }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 });
    store.head.mockResolvedValue({ key: "k4", byteSize: 1, lastModified: NOW });

    const { danglingSweep } = await import("./sweeps");
    await expect(danglingSweep({ store: store as never })).resolves.toEqual([]);
  });

  it("evaluates the classification with CASE, not OR", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 });
    const { danglingSweep } = await import("./sweeps");
    await danglingSweep({ store: store as never });
    expect(String(query.mock.calls[0][0])).toContain(
      "CASE WHEN r.subject_kind = 'tenant' THEN true",
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/artifacts/sweeps.test.ts lib/db/migrations/082_artifact_sweep_state.test.ts`
Expected: FAIL — unresolved import `./sweeps`, and `ENOENT ... 082_artifact_sweep_state.up.sql`

- [ ] **Step 3: Write migration 082**

```sql
-- ads-agent/lib/db/migrations/082_artifact_sweep_state.up.sql
-- Bookkeeping for the two divergence sweeps (datastore §13.1).
BEGIN;

CREATE SCHEMA IF NOT EXISTS context;

-- Cross-tenant maintenance record, deliberately not a domain table and
-- therefore deliberately not org-scoped: one sweep run covers every tenant, in
-- the same way public.corridors is shared reference data.
CREATE TABLE IF NOT EXISTS context.artifact_sweep_runs (
  id UUID PRIMARY KEY DEFAULT uuidv7()
);

ALTER TABLE context.artifact_sweep_runs
  ADD COLUMN IF NOT EXISTS sweep           TEXT,
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS finished_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS objects_scanned INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS objects_deleted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS objects_skipped INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rows_flagged    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unexplained     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE context.artifact_sweep_runs ALTER COLUMN sweep SET NOT NULL;

ALTER TABLE context.artifact_sweep_runs
  DROP CONSTRAINT IF EXISTS artifact_sweep_runs_sweep_check;
ALTER TABLE context.artifact_sweep_runs
  ADD CONSTRAINT artifact_sweep_runs_sweep_check CHECK (sweep IN ('orphan','dangling'));

CREATE TABLE IF NOT EXISTS context.artifact_dangling_flags (
  artifact_id UUID PRIMARY KEY REFERENCES context.artifacts(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES public.orgs(id)
);

ALTER TABLE context.artifact_dangling_flags
  -- mid_erasure is the expected residue of a crash mid-erasure, because bytes
  -- are deleted before the row is tombstoned. unexplained is the one that
  -- indicates a bug or an out-of-band deletion, and the only one that alerts.
  ADD COLUMN IF NOT EXISTS classification TEXT,
  ADD COLUMN IF NOT EXISTS detected_at    TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE context.artifact_dangling_flags ALTER COLUMN classification SET NOT NULL;

ALTER TABLE context.artifact_dangling_flags
  DROP CONSTRAINT IF EXISTS artifact_dangling_flags_classification_check;
ALTER TABLE context.artifact_dangling_flags
  ADD CONSTRAINT artifact_dangling_flags_classification_check
  CHECK (classification IN ('mid_erasure','unexplained'));

CREATE INDEX IF NOT EXISTS artifact_dangling_flags_alerting_idx
  ON context.artifact_dangling_flags (org_id, detected_at DESC)
  WHERE classification = 'unexplained';

ALTER TABLE context.artifact_dangling_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.artifact_dangling_flags FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON context.artifact_dangling_flags;
CREATE POLICY tenant_isolation ON context.artifact_dangling_flags
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_maintenance') THEN
    CREATE ROLE context_maintenance NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA context TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.artifact_sweep_runs      TO context_maintenance;
GRANT SELECT, INSERT, UPDATE ON context.artifact_dangling_flags  TO context_maintenance;

DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifact_dangling_flags;
CREATE POLICY maintenance_cross_tenant ON context.artifact_dangling_flags
  TO context_maintenance USING (true) WITH CHECK (true);

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/082_artifact_sweep_state.down.sql
BEGIN;
DROP POLICY IF EXISTS maintenance_cross_tenant ON context.artifact_dangling_flags;
DROP POLICY IF EXISTS tenant_isolation ON context.artifact_dangling_flags;
DROP TABLE IF EXISTS context.artifact_dangling_flags;
DROP TABLE IF EXISTS context.artifact_sweep_runs;
COMMIT;
```

- [ ] **Step 4: Write `sweeps.ts` and the cron entry point**

```ts
// ads-agent/lib/artifacts/sweeps.ts
import { getPool } from "../db/client";
import { ObjectStore } from "../objectstore/client";
import { ARTIFACT_BUCKET } from "./store";

/**
 * The write order is bytes-then-row, so a young object with no row is a write
 * in flight rather than residue. Without this window the orphan sweep races its
 * own writer and deletes bytes that are about to be referenced.
 */
export const ORPHAN_GRACE_SECONDS = Number(process.env.ARTIFACT_ORPHAN_GRACE_SECONDS ?? 3600);

export type OrphanSweepResult = { scanned: number; deleted: string[]; skippedYoung: number };

export type DanglingFlag = {
  artifactId: string;
  orgId: string;
  classification: "mid_erasure" | "unexplained";
};

async function recordRun(
  sweep: "orphan" | "dangling",
  counts: Partial<{
    objectsScanned: number; objectsDeleted: number; objectsSkipped: number;
    rowsFlagged: number; unexplained: number;
  }>,
): Promise<void> {
  await getPool().query(
    `INSERT INTO context.artifact_sweep_runs
       (sweep, finished_at, objects_scanned, objects_deleted, objects_skipped,
        rows_flagged, unexplained)
     VALUES ($1, now(), $2, $3, $4, $5, $6)`,
    [
      sweep, counts.objectsScanned ?? 0, counts.objectsDeleted ?? 0,
      counts.objectsSkipped ?? 0, counts.rowsFlagged ?? 0, counts.unexplained ?? 0,
    ],
  );
}

/**
 * Bytes with no index row: the expected residue of a crash between the two
 * writes. This sweep deletes. Connect as context_maintenance.
 */
export async function orphanSweep(
  opts: { graceSeconds?: number; now?: Date; store?: ObjectStore } = {},
): Promise<OrphanSweepResult> {
  const store = opts.store ?? ObjectStore.fromEnv();
  const graceMs = (opts.graceSeconds ?? ORPHAN_GRACE_SECONDS) * 1000;
  const now = opts.now ?? new Date();
  const pool = getPool();

  const result: OrphanSweepResult = { scanned: 0, deleted: [], skippedYoung: 0 };

  for await (const object of store.list(ARTIFACT_BUCKET, "artifacts/")) {
    result.scanned += 1;

    const { rowCount } = await pool.query(
      `SELECT 1 FROM context.artifacts WHERE storage_key = $1`,
      [object.key],
    );
    if (rowCount) continue;

    if (now.getTime() - object.lastModified.getTime() < graceMs) {
      result.skippedYoung += 1;
      continue;
    }

    await store.remove(ARTIFACT_BUCKET, object.key);
    result.deleted.push(object.key);
  }

  await recordRun("orphan", {
    objectsScanned: result.scanned,
    objectsDeleted: result.deleted.length,
    objectsSkipped: result.skippedYoung,
  });
  return result;
}

/**
 * Index rows with no bytes. This sweep flags and never deletes: §13.1 calls it
 * "not expected", indicating a bug or an out-of-band deletion. The exception is
 * a crash mid-erasure, which is expected by construction, so a row covered by
 * an unfinished deletion request is classified mid_erasure and does not alert.
 */
export async function danglingSweep(
  opts: { store?: ObjectStore } = {},
): Promise<DanglingFlag[]> {
  const store = opts.store ?? ObjectStore.fromEnv();
  const pool = getPool();

  const { rows } = await pool.query<{
    id: string; org_id: string; storage_key: string; open_request: boolean;
  }>(
    `SELECT a.id, a.org_id, a.storage_key,
            EXISTS (
              SELECT 1 FROM context.deletion_requests r
               WHERE r.org_id = a.org_id
                 AND r.erased_at IS NULL
                 -- CASE, not OR: SQL does not guarantee short-circuit
                 -- evaluation, and subject_ref::uuid would raise on a
                 -- non-UUID subject reference whichever branch "should" run.
                 AND (CASE WHEN r.subject_kind = 'tenant' THEN true
                           WHEN r.subject_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             THEN r.subject_ref::uuid = ANY (a.subject_refs)
                           ELSE false END)
            ) AS open_request
       FROM context.artifacts a
      WHERE a.erased_at IS NULL`,
  );

  const flags: DanglingFlag[] = [];
  for (const row of rows) {
    if (await store.head(ARTIFACT_BUCKET, row.storage_key)) continue;

    const classification: DanglingFlag["classification"] =
      row.open_request ? "mid_erasure" : "unexplained";
    flags.push({ artifactId: row.id, orgId: row.org_id, classification });

    await pool.query(
      `INSERT INTO context.artifact_dangling_flags
         (artifact_id, org_id, classification, detected_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (artifact_id) DO UPDATE SET
         classification = EXCLUDED.classification, detected_at = now()`,
      [row.id, row.org_id, classification],
    );
  }

  await recordRun("dangling", {
    rowsFlagged: flags.length,
    unexplained: flags.filter((f) => f.classification === "unexplained").length,
  });
  return flags;
}
```

```ts
// ads-agent/scripts/artifact-sweeps.ts
import { danglingSweep, orphanSweep } from "../lib/artifacts/sweeps";

/**
 * Cron entry point. Connect as context_maintenance: both sweeps read every
 * tenant, which is what the named cross-tenant policies in migrations 080-082
 * permit without granting BYPASSRLS.
 */
async function main(): Promise<void> {
  const orphan = await orphanSweep();
  console.log(
    `orphan sweep: scanned=${orphan.scanned} deleted=${orphan.deleted.length} ` +
      `skippedYoung=${orphan.skippedYoung}`,
  );

  const dangling = await danglingSweep();
  const unexplained = dangling.filter((f) => f.classification === "unexplained");
  console.log(`dangling sweep: flagged=${dangling.length} unexplained=${unexplained.length}`);

  // Only unexplained danglers are a signal. mid_erasure ones are the expected
  // residue of the bytes-first erasure order.
  if (unexplained.length > 0) {
    console.error("UNEXPLAINED DANGLING ARTIFACTS", unexplained);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("artifact sweeps failed", err);
  process.exit(1);
});
```

Add to `ads-agent/package.json` scripts: `"artifacts:sweep": "tsx --env-file=.env.local scripts/artifact-sweeps.ts"`.

- [ ] **Step 5: Run tests, apply the migration, commit**

Run: `cd ads-agent && npx vitest run lib/artifacts/sweeps.test.ts lib/db/migrations/082_artifact_sweep_state.test.ts`
Expected: PASS (14 tests)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ads-agent/lib/db/migrations/082_artifact_sweep_state.up.sql
cd ads-agent && npm run artifacts:sweep
```

Expected: `orphan sweep: scanned=0 deleted=0 skippedYoung=0` and `dangling sweep: flagged=0 unexplained=0`, exit code 0.

```bash
git add ads-agent/lib/artifacts/sweeps.ts ads-agent/lib/artifacts/sweeps.test.ts ads-agent/scripts/artifact-sweeps.ts ads-agent/lib/db/migrations/ ads-agent/package.json
git commit -m "feat(artifacts): orphan sweep deletes, dangling sweep flags

Two different sweeps for two different divergences. The orphan sweep needs a
grace window or it races its own writer, since bytes are written before the
row. The dangling sweep classifies mid_erasure separately from unexplained, so
the bytes-first erasure order does not make it cry wolf."
```

## Task 14: Export one DuckDB snapshot per tenant

**Files:**
- Create: `ads-agent/lib/context-graph/snapshot-export.ts`
- Create: `ads-agent/lib/context-graph/snapshot-export.test.ts`
- Create: `ads-agent/scripts/graph-rebuild-worker.ts`
- Create: `scripts/install-duckdb.sh`
- Modify: `ads-agent/package.json` (add `"graph:worker": "tsx --env-file=.env.local scripts/graph-rebuild-worker.ts"`)

**Skills:** `senior-data-engineer`, `senior-devops`
**Model:** inherit — the DuckDB delivery mechanism is a dependency decision, and the ClickHouse `s3()` export needs live iteration.

**Interfaces:**
- Consumes: `chCommand` from `./clickhouse`; `buildGraphSnapshot` from `./build`; `SNAPSHOT_TTL_SECONDS`, `recordSnapshot`, `collectSnapshots` from `./snapshot-lease`; `provisionSnapshotStorage`, `snapshotBucketName`, `tenantDataKey` from `./snapshot-iam`; `claimRebuild`, `finishRebuild`, `failRebuild` from `./backpressure`; `ObjectStore` from `../objectstore/client`.
- Produces:

```ts
export function duckdbBinary(): string;
export function snapshotExportStatements(args: {
  orgId: string; snapshotId: string; stagingBucket: string; endpoint: string;
  accessKeyId: string; secretAccessKey: string;
  sourceWatermark: Date; cdcLagSeconds: number;
}): string[];
export function duckdbBuildScript(paths: {
  nodeParquet: string; edgeParquet: string; metaParquet: string;
}): string;
export function sealBytes(plaintext: Uint8Array, dataKey: Buffer): Buffer;
export function openBytes(sealed: Uint8Array, dataKey: Buffer): Buffer;
export function exportSnapshot(
  scope: Scope, snapshotId: string, generation: number,
  build: { sourceWatermark: Date; cdcLagSeconds: number },
): Promise<{ bucket: string; storageKey: string; byteSize: number; checksum: string }>;
```

Task 16 imports `sealBytes` / `openBytes` for the crypto-shred assertion.

**Context:** One file per tenant, exported from ClickHouse, opened `READ_ONLY` by serving processes (data model §9). Builds never write in place: a rebuild writes a new file for the new `snapshot_id` and the manifest flips to point at it, because writing to a file readers hold would violate DuckDB's concurrency model (§6.4).

**DuckDB arrives as a binary, not an npm dependency.** `@duckdb/node-api` would be a new dependency, and the global constraint is not to add one without asking. The DuckDB CLI does everything needed — read Parquet, create tables, write a database file — so `scripts/install-duckdb.sh` fetches the official static binary into `./.bin/duckdb` and `DUCKDB_BIN` points at it. It is launched with `execFile`: arguments are passed as a list with the shell disabled, and `duckdbBinary()` rejects any path containing a character that is not part of a plain filesystem path, so nothing is ever interpolated into a command line. If a native binding is later preferred, that is a one-function change here and a dependency conversation then.

The route is ClickHouse → Parquet in the staging bucket → DuckDB CLI → sealed file in the tenant's bucket. ClickHouse's `s3()` table function writes Parquet straight to Garage's S3 endpoint, so the first hop needs no code at all. The Parquet files are then fetched to a local temporary directory rather than read over `httpfs`, which keeps DuckDB out of the credentials business entirely.

`snapshot_meta` carries `org_id` so a mis-targeted file fails a check rather than serving silently, and `source_watermark` so an agent can tell how stale its context is.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/context-graph/snapshot-export.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  duckdbBinary, duckdbBuildScript, openBytes, sealBytes, snapshotExportStatements,
} from "./snapshot-export";

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";

const args = {
  orgId: ORG, snapshotId: SNAP, stagingBucket: "gs-graph-staging",
  endpoint: "http://127.0.0.1:3900", accessKeyId: "GK", secretAccessKey: "S",
  sourceWatermark: new Date("2026-08-12T08:00:00Z"), cdcLagSeconds: 12,
};

describe("snapshotExportStatements", () => {
  const statements = snapshotExportStatements(args);

  it("exports nodes, edges and a one-row snapshot_meta", () => {
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("graph_node.parquet");
    expect(statements[1]).toContain("graph_edge.parquet");
    expect(statements[2]).toContain("snapshot_meta.parquet");
  });

  it("scopes the node and edge exports to one tenant and one snapshot", () => {
    for (const sql of statements.slice(0, 2)) {
      expect(sql).toContain(`org_id = toUUID('${ORG}')`);
      expect(sql).toContain(`snapshot_id = toUUID('${SNAP}')`);
    }
  });

  it("writes Parquet into the staging bucket under the snapshot id", () => {
    for (const sql of statements) {
      expect(sql).toContain(`http://127.0.0.1:3900/gs-graph-staging/${SNAP}/`);
      expect(sql).toContain("'Parquet'");
    }
  });

  it("puts source_watermark and expires_at in snapshot_meta, per data model §9", () => {
    expect(statements[2]).toContain("source_watermark");
    expect(statements[2]).toContain("expires_at");
    expect(statements[2]).toContain("2026-08-12 08:00:00");
  });
});

describe("duckdbBuildScript", () => {
  const script = duckdbBuildScript({
    nodeParquet: "/tmp/s/graph_node.parquet",
    edgeParquet: "/tmp/s/graph_edge.parquet",
    metaParquet: "/tmp/s/snapshot_meta.parquet",
  });

  it("creates all three tables from the local parquet files", () => {
    expect(script).toContain(
      "CREATE TABLE graph_node AS SELECT * FROM read_parquet('/tmp/s/graph_node.parquet')",
    );
    expect(script).toContain(
      "CREATE TABLE graph_edge AS SELECT * FROM read_parquet('/tmp/s/graph_edge.parquet')",
    );
    expect(script).toContain(
      "CREATE TABLE snapshot_meta AS SELECT * FROM read_parquet('/tmp/s/snapshot_meta.parquet')",
    );
  });

  it("keeps org_id so a mis-targeted file fails a check rather than serving", () => {
    expect(script).toContain("SELECT count(DISTINCT org_id) = 1 FROM graph_node");
  });

  it("reads local files, keeping DuckDB out of the credentials business", () => {
    expect(script).not.toContain("httpfs");
    expect(script).not.toContain("s3://");
  });
});

describe("duckdbBinary", () => {
  it("defaults to the path install-duckdb.sh writes", () => {
    delete process.env.DUCKDB_BIN;
    expect(duckdbBinary()).toBe("./.bin/duckdb");
  });

  it("rejects a path carrying shell metacharacters", () => {
    process.env.DUCKDB_BIN = "duckdb; rm -rf /";
    expect(() => duckdbBinary()).toThrow(/plain path/);
    process.env.DUCKDB_BIN = "$(whoami)";
    expect(() => duckdbBinary()).toThrow(/plain path/);
  });
});

describe("sealBytes", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips under the tenant data key", () => {
    const plain = new TextEncoder().encode("snapshot bytes");
    expect(openBytes(sealBytes(plain, key), key).toString("utf8")).toBe("snapshot bytes");
  });

  it("cannot be opened with another key, which is what the crypto-shred relies on", () => {
    const sealed = sealBytes(new TextEncoder().encode("x"), key);
    expect(() => openBytes(sealed, Buffer.alloc(32, 9))).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/context-graph/snapshot-export.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshot-export"`

- [ ] **Step 3: Write the DuckDB installer**

```bash
#!/usr/bin/env bash
# scripts/install-duckdb.sh
# Fetches the official DuckDB CLI into ./.bin so the snapshot exporter needs no
# npm dependency. Idempotent.
set -euo pipefail

VERSION="${DUCKDB_VERSION:-v1.5.2}"
DEST="${DEST:-./.bin}"

case "$(uname -s)-$(uname -m)" in
  Darwin-*)      ASSET="duckdb_cli-osx-universal.zip" ;;
  Linux-x86_64)  ASSET="duckdb_cli-linux-amd64.zip" ;;
  Linux-aarch64) ASSET="duckdb_cli-linux-arm64.zip" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$DEST"
if [ -x "$DEST/duckdb" ]; then
  echo "duckdb already present: $("$DEST/duckdb" --version)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/duckdb.zip" \
  "https://github.com/duckdb/duckdb/releases/download/${VERSION}/${ASSET}"
unzip -q -o "$TMP/duckdb.zip" -d "$DEST"
chmod +x "$DEST/duckdb"
echo "installed: $("$DEST/duckdb" --version)"
```

Add `.bin/` to `.gitignore` if it is not already ignored.

- [ ] **Step 4: Write `snapshot-export.ts`**

```ts
// ads-agent/lib/context-graph/snapshot-export.ts
import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "../db/scope-sql";
import { ObjectStore } from "../objectstore/client";
import { chCommand } from "./clickhouse";
import { SNAPSHOT_TTL_SECONDS } from "./snapshot-lease";
import { provisionSnapshotStorage, snapshotBucketName, tenantDataKey } from "./snapshot-iam";

const G = "gentle_space";

/**
 * The DuckDB CLI path, validated. Arguments are passed to execFile as a list
 * with the shell disabled, so nothing is interpolated into a command line; this
 * check additionally refuses anything that is not a plain filesystem path.
 */
export function duckdbBinary(): string {
  const bin = process.env.DUCKDB_BIN ?? "./.bin/duckdb";
  if (!/^[A-Za-z0-9._/-]+$/.test(bin)) {
    throw new Error(`DUCKDB_BIN is not a plain path: ${bin}`);
  }
  return bin;
}

function runDuckdb(dbPath: string, script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      duckdbBinary(),
      [dbPath, "-c", script],
      { shell: false, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) =>
        err ? reject(new Error(`duckdb failed: ${stderr || err.message}`)) : resolve(),
    );
  });
}

function chTimestamp(at: Date): string {
  return at.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/**
 * ClickHouse writes Parquet straight to Garage through its s3() table function,
 * so the first hop of the export is configuration rather than code.
 */
export function snapshotExportStatements(args: {
  orgId: string;
  snapshotId: string;
  stagingBucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sourceWatermark: Date;
  cdcLagSeconds: number;
}): string[] {
  const base = `${args.endpoint.replace(/\/$/, "")}/${args.stagingBucket}/${args.snapshotId}`;
  const creds = `'${args.accessKeyId}', '${args.secretAccessKey}', 'Parquet'`;
  const scoped = `org_id = toUUID('${args.orgId}') AND snapshot_id = toUUID('${args.snapshotId}')`;

  return [
    `INSERT INTO FUNCTION s3('${base}/graph_node.parquet', ${creds})
     SELECT org_id, snapshot_id, node_id, node_kind, label, subject_ref,
            toString(props) AS props
       FROM ${G}.graph_node WHERE ${scoped}`,

    `INSERT INTO FUNCTION s3('${base}/graph_edge.parquet', ${creds})
     SELECT org_id, snapshot_id, source_id, source_kind, relationship_kind,
            target_id, target_kind, meters, weight, confidence, toString(props) AS props
       FROM ${G}.graph_edge WHERE ${scoped}`,

    // One row. org_id is retained so a mis-targeted file fails a check rather
    // than serving silently; source_watermark carries CDC lag forward so an
    // agent can tell how stale its context is (data model §9).
    `INSERT INTO FUNCTION s3('${base}/snapshot_meta.parquet', ${creds})
     SELECT toUUID('${args.orgId}')                             AS org_id,
            toUUID('${args.snapshotId}')                        AS snapshot_id,
            now()                                               AS built_at,
            now() + INTERVAL ${SNAPSHOT_TTL_SECONDS} SECOND     AS expires_at,
            toDateTime('${chTimestamp(args.sourceWatermark)}')  AS source_watermark,
            ${args.cdcLagSeconds}                               AS cdc_lag_seconds`,
  ];
}

/**
 * Local parquet files, not httpfs: reading them from disk keeps DuckDB out of
 * the credentials business entirely.
 */
export function duckdbBuildScript(paths: {
  nodeParquet: string;
  edgeParquet: string;
  metaParquet: string;
}): string {
  return [
    `CREATE TABLE graph_node AS SELECT * FROM read_parquet('${paths.nodeParquet}');`,
    `CREATE TABLE graph_edge AS SELECT * FROM read_parquet('${paths.edgeParquet}');`,
    `CREATE TABLE snapshot_meta AS SELECT * FROM read_parquet('${paths.metaParquet}');`,
    // A file holding two tenants' rows is a bug, and this is where it stops.
    `SELECT count(DISTINCT org_id) = 1 FROM graph_node;`,
  ].join("\n");
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Per-tenant AES-256-GCM over the snapshot file. Destroying the tenant's data
 * key makes every snapshot it ever had unreadable at once (datastore §12.3,
 * §11.2), which is what makes erasure practical for immutable files.
 */
export function sealBytes(plaintext: Uint8Array, dataKey: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openBytes(sealed: Uint8Array, dataKey: Buffer): Buffer {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", dataKey, buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export async function exportSnapshot(
  scope: Scope,
  snapshotId: string,
  generation: number,
  build: { sourceWatermark: Date; cdcLagSeconds: number },
): Promise<{ bucket: string; storageKey: string; byteSize: number; checksum: string }> {
  const stagingBucket = process.env.SNAPSHOT_STAGING_BUCKET ?? "gs-graph-staging";
  const endpoint = process.env.GARAGE_S3_ENDPOINT ?? "http://127.0.0.1:3900";
  const accessKeyId = process.env.ARTIFACT_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ARTIFACT_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("ARTIFACT_ACCESS_KEY_ID / ARTIFACT_SECRET_ACCESS_KEY are not set");
  }

  for (const statement of snapshotExportStatements({
    orgId: scope.orgId, snapshotId, stagingBucket, endpoint, accessKeyId, secretAccessKey,
    sourceWatermark: build.sourceWatermark, cdcLagSeconds: build.cdcLagSeconds,
  })) {
    await chCommand(statement, { orgId: scope.orgId });
  }

  const store = ObjectStore.fromEnv();
  const workDir = await mkdtemp(join(tmpdir(), `snap-${snapshotId}-`));
  try {
    const local: Record<string, string> = {};
    for (const name of ["graph_node", "graph_edge", "snapshot_meta"]) {
      const bytes = await store.get(stagingBucket, `${snapshotId}/${name}.parquet`);
      if (!bytes) throw new Error(`staging parquet missing: ${snapshotId}/${name}.parquet`);
      local[name] = join(workDir, `${name}.parquet`);
      await writeFile(local[name], bytes);
    }

    // A rebuild writes a NEW file. Readers hold the current one open READ_ONLY,
    // so building in place would violate DuckDB's concurrency model (§6.4).
    const dbPath = join(workDir, `${snapshotId}.duckdb`);
    await runDuckdb(
      dbPath,
      duckdbBuildScript({
        nodeParquet: local.graph_node,
        edgeParquet: local.graph_edge,
        metaParquet: local.snapshot_meta,
      }),
    );

    const raw = await readFile(dbPath);
    const dataKey = await tenantDataKey(scope).catch(async () => {
      await provisionSnapshotStorage(scope);
      return tenantDataKey(scope);
    });
    const sealed = sealBytes(raw, dataKey);

    const bucket = snapshotBucketName(scope.orgId);
    const storageKey = `${snapshotId}.duckdb.enc`;
    await store.put(bucket, storageKey, sealed, "application/octet-stream");

    // Staging is transport, not an archive: the parquet is reproducible from
    // ClickHouse and holds a copy of the same personal data.
    for (const name of ["graph_node", "graph_edge", "snapshot_meta"]) {
      await store.remove(stagingBucket, `${snapshotId}/${name}.parquet`);
    }

    return {
      bucket,
      storageKey,
      byteSize: sealed.byteLength,
      checksum: createHash("sha256").update(sealed).digest("hex"),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
```

`generation` is part of the signature because Task 8's `recordSnapshot` needs it and the worker passes the claim's value straight through; `exportSnapshot` itself does not branch on it.

- [ ] **Step 5: Write the worker loop**

```ts
// ads-agent/scripts/graph-rebuild-worker.ts
import { claimRebuild, failRebuild, finishRebuild } from "../lib/context-graph/backpressure";
import { buildGraphSnapshot } from "../lib/context-graph/build";
import { collectSnapshots, recordSnapshot } from "../lib/context-graph/snapshot-lease";
import { exportSnapshot } from "../lib/context-graph/snapshot-export";
import { ObjectStore } from "../lib/objectstore/client";

/**
 * One cycle: claim at most one tenant (the slots table caps how many workers
 * hold a claim at once), rebuild it, export its snapshot, then collect.
 * Connect as context_maintenance -- claiming reads across tenants.
 */
async function cycle(): Promise<boolean> {
  const claim = await claimRebuild();
  if (!claim) return false;

  const scope = { kind: "platform" as const, orgId: claim.orgId };
  try {
    const build = await buildGraphSnapshot(claim.orgId, claim.snapshotId);
    const exported = await exportSnapshot(scope, claim.snapshotId, claim.generation, build);

    await recordSnapshot(scope, {
      orgId: claim.orgId,
      snapshotId: claim.snapshotId,
      generation: claim.generation,
      bucket: exported.bucket,
      storageKey: exported.storageKey,
      byteSize: exported.byteSize,
      checksum: exported.checksum,
      sourceWatermark: build.sourceWatermark,
      cdcLagSeconds: build.cdcLagSeconds,
    });

    await finishRebuild(claim, {
      sourceWatermark: build.sourceWatermark,
      cdcLagSeconds: build.cdcLagSeconds,
    });
    console.log(
      `rebuilt ${claim.orgId} gen=${claim.generation} nodes=${build.nodeCount} ` +
        `edges=${build.edgeCount} lag=${build.cdcLagSeconds}s`,
    );
    return true;
  } catch (err) {
    await failRebuild(claim, err instanceof Error ? err.message : String(err));
    console.error(`rebuild failed for ${claim.orgId}`, err);
    return true;
  }
}

async function main(): Promise<void> {
  let worked = 0;
  while (await cycle()) worked += 1;

  const collection = await collectSnapshots(ObjectStore.fromEnv());
  console.log(
    `rebuilds=${worked} collected=${collection.collected.length} ` +
      `blockedByLease=${collection.blockedByLease}`,
  );
  if (collection.currentGenerationExpired.length > 0) {
    console.warn(
      "current-generation snapshots expired and were collected; those tenants are pending",
      collection.currentGenerationExpired,
    );
  }
}

main().catch((err) => {
  console.error("graph rebuild worker failed", err);
  process.exit(1);
});
```

Add to `ads-agent/package.json` scripts: `"graph:worker": "tsx --env-file=.env.local scripts/graph-rebuild-worker.ts"`.

- [ ] **Step 6: Run tests, install DuckDB, commit**

Run: `cd ads-agent && npx vitest run lib/context-graph/snapshot-export.test.ts`
Expected: PASS (11 tests)

```bash
chmod +x scripts/install-duckdb.sh && ./scripts/install-duckdb.sh
./.bin/duckdb -c "SELECT 'duckdb ok' AS status"
```

Expected: `installed: v1.5.2 ...` then a table containing `duckdb ok`.

```bash
git add ads-agent/lib/context-graph/snapshot-export.ts ads-agent/lib/context-graph/snapshot-export.test.ts ads-agent/scripts/graph-rebuild-worker.ts scripts/install-duckdb.sh ads-agent/package.json .gitignore
git commit -m "feat(context-graph): export one sealed DuckDB snapshot per tenant

ClickHouse -> Parquet in Garage -> DuckDB CLI -> the tenant's own bucket,
sealed under that tenant's data key. DuckDB arrives as a binary rather than an
npm dependency, launched with an argument list and no shell. Builds never write
in place because readers hold the current file open READ_ONLY."
```

---

# Task 15 (Wave 5, fan-in): the S8a gate

**Files:**
- Create: `ads-agent/lib/artifacts/erasure.integration.test.ts`

**Skills:** `senior-qa`, `tdd-guide`
**Model:** inherit

**Gate:** *an artifact survives a write, a read, and an erasure that leaves no bytes behind.*

- [ ] **Step 1: Merge Tasks 12, 13, 14 into the integration branch**

`ads-agent/package.json` is touched by Tasks 13 and 14; both only append a script, so keep both lines. Run `cd ads-agent && npx vitest run` and confirm green before continuing.

- [ ] **Step 2: Write the gate test**

```ts
// ads-agent/lib/artifacts/erasure.integration.test.ts
/**
 * The S8a gate. Runs against a live Garage and a live Postgres:
 *   docker compose -f docker-compose.garage.yml up -d && ./scripts/garage/bootstrap.sh
 *
 * The load-bearing assertion is "LEAVES NO BYTES BEHIND". Everything else could
 * pass while the bytes were still sitting in the bucket.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/client";
import { ObjectStore } from "../objectstore/client";
import { ARTIFACT_BUCKET, getArtifact, putArtifact } from "./store";
import { eraseArtifactsForSubject, eraseArtifactsForTenant } from "./erase";
import { danglingSweep, orphanSweep } from "./sweeps";
import { artifactStorageKey } from "./key";
import type { Scope } from "../db/scope-sql";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const SUBJECT = randomUUID();
const REQUEST_A = randomUUID();
const REQUEST_B = randomUUID();
const scopeA: Scope = { kind: "org", orgId: ORG_A };
const scopeB: Scope = { kind: "org", orgId: ORG_B };

const store = ObjectStore.fromEnv();
const pool = getPool();

/** Every call runs with the tenant set, because RLS is FORCEd on these tables. */
async function asTenant<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  await pool.query("SELECT public.set_tenant($1)", [scope.orgId]);
  return fn();
}

beforeAll(async () => {
  for (const [orgId, requestId] of [[ORG_A, REQUEST_A], [ORG_B, REQUEST_B]] as const) {
    await pool.query(
      `INSERT INTO public.orgs (id, name, kind) VALUES ($1, $2, 'external')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, `gate-${orgId.slice(0, 8)}`],
    );
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    await pool.query(
      `INSERT INTO context.deletion_requests
         (id, org_id, subject_kind, subject_ref, erase_after, respond_by)
       VALUES ($1, $2, 'enquirer', $3, current_date + 366, current_date + 90)
       ON CONFLICT (id) DO NOTHING`,
      [requestId, orgId, SUBJECT],
    );
  }
});

afterAll(async () => {
  for (const orgId of [ORG_A, ORG_B]) {
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    for await (const object of store.list(ARTIFACT_BUCKET, `artifacts/${orgId}/`)) {
      await store.remove(ARTIFACT_BUCKET, object.key);
    }
    await pool.query(`DELETE FROM context.artifact_dangling_flags WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM context.artifacts WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM context.deletion_requests WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM public.orgs WHERE id = $1`, [orgId]);
  }
});

describe("S8a gate: write, read, erase with no bytes behind", () => {
  it("survives a write", async () => {
    const row = await asTenant(scopeA, () =>
      putArtifact(scopeA, {
        contentType: "context_pack",
        body: new TextEncoder().encode(JSON.stringify({ pack: "hello" })),
        subjectRefs: [SUBJECT],
      }),
    );

    expect(row.storageKey).toBe(artifactStorageKey(scopeA, "context_pack", row.id));
    expect(await store.head(ARTIFACT_BUCKET, row.storageKey)).not.toBeNull();
  });

  it("survives a read, and the bytes match the recorded checksum", async () => {
    const written = await asTenant(scopeA, () =>
      putArtifact(scopeA, {
        contentType: "draft",
        body: new TextEncoder().encode("draft body"),
        subjectRefs: [SUBJECT],
      }),
    );

    const read = await asTenant(scopeA, () => getArtifact(scopeA, written.id));
    expect(new TextDecoder().decode(read!.body!)).toBe("draft body");
    expect(read!.row.checksum).toBe(written.checksum);
  });

  it("returns null, not 403-shaped data, for another tenant's artifact", async () => {
    const written = await asTenant(scopeA, () =>
      putArtifact(scopeA, { contentType: "draft", body: new TextEncoder().encode("secret") }),
    );
    await expect(asTenant(scopeB, () => getArtifact(scopeB, written.id))).resolves.toBeNull();
  });

  it("LEAVES NO BYTES BEHIND after a per-subject erasure", async () => {
    const written = await asTenant(scopeA, () =>
      putArtifact(scopeA, {
        contentType: "talking_points",
        body: new TextEncoder().encode("talking points"),
        subjectRefs: [SUBJECT],
      }),
    );
    // Precondition: the object really is there before we erase it, otherwise
    // the assertion below would pass vacuously.
    expect(await store.head(ARTIFACT_BUCKET, written.storageKey)).not.toBeNull();

    const result = await asTenant(scopeA, () =>
      eraseArtifactsForSubject(scopeA, SUBJECT, REQUEST_A),
    );
    expect(result.erasedIds).toContain(written.id);

    // THE GATE. Asked of the object store itself, not of Postgres.
    expect(await store.head(ARTIFACT_BUCKET, written.storageKey)).toBeNull();
  });

  it("keeps the row as a tombstone so a dangling reference renders 'content erased'", async () => {
    const { rows } = await asTenant(scopeA, () =>
      pool.query<{ erased_at: Date | null }>(
        `SELECT erased_at FROM context.artifacts
          WHERE org_id = $1 AND subject_refs @> ARRAY[$2]::uuid[]`,
        [ORG_A, SUBJECT],
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.erased_at).not.toBeNull();
  });

  it("records the erasure in the deletion ledger under store = objectstore", async () => {
    const { rows } = await asTenant(scopeA, () =>
      pool.query<{ state: string }>(
        `SELECT state FROM context.deletion_propagations
          WHERE request_id = $1 AND store = 'objectstore'`,
        [REQUEST_A],
      ),
    );
    expect(rows[0]?.state).toBe("erased");
  });

  it("leaves no bytes under the tenant prefix after offboarding", async () => {
    await asTenant(scopeA, () =>
      putArtifact(scopeA, { contentType: "draft", body: new TextEncoder().encode("last one") }),
    );
    await asTenant(scopeA, () => eraseArtifactsForTenant(scopeA, REQUEST_A));

    const remaining: string[] = [];
    for await (const object of store.list(ARTIFACT_BUCKET, `artifacts/${ORG_A}/`)) {
      remaining.push(object.key);
    }
    expect(remaining).toEqual([]);
  });
});

describe("the two sweeps are two different sweeps", () => {
  it("orphan sweep reclaims bytes with no row, and only once past the grace window", async () => {
    const orphanKey = `artifacts/${ORG_A}/draft/${randomUUID()}`;
    await store.put(ARTIFACT_BUCKET, orphanKey, new TextEncoder().encode("orphan"), "text/plain");

    // Inside the window it is a write in flight, not residue.
    const spared = await orphanSweep({ graceSeconds: 3600 });
    expect(spared.deleted).not.toContain(orphanKey);
    expect(await store.head(ARTIFACT_BUCKET, orphanKey)).not.toBeNull();

    const swept = await orphanSweep({ graceSeconds: 0 });
    expect(swept.deleted).toContain(orphanKey);
    expect(await store.head(ARTIFACT_BUCKET, orphanKey)).toBeNull();
  });

  it("dangling sweep flags a row whose bytes vanished out of band, and deletes nothing", async () => {
    const written = await asTenant(scopeB, () =>
      putArtifact(scopeB, { contentType: "draft", body: new TextEncoder().encode("vanishing") }),
    );
    // Delete the object behind the index's back -- the case §13.1 calls a bug.
    await store.remove(ARTIFACT_BUCKET, written.storageKey);

    const flags = await danglingSweep();
    expect(flags.find((f) => f.artifactId === written.id)?.classification).toBe("unexplained");

    // The row is still there: flagging, not deleting.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM context.artifacts WHERE id = $1`,
      [written.id],
    );
    expect(rowCount).toBe(1);
  });
});
```

The sweeps in the second block run cross-tenant, so `DATABASE_URL` for this test file must connect as a role holding `context_maintenance`. Grant it once in the development database:

```bash
psql "$DATABASE_URL" -c "GRANT context_maintenance TO CURRENT_USER"
```

- [ ] **Step 3: Run the gate**

```bash
docker compose -f docker-compose.garage.yml up -d && ./scripts/garage/bootstrap.sh
cd ads-agent && npx vitest run lib/artifacts/erasure.integration.test.ts
```

Expected: PASS (9 tests). The test named `LEAVES NO BYTES BEHIND after a per-subject erasure` is the gate; if anything else fails, fix it, but if that one fails, S8a is not done.

- [ ] **Step 4: Full suite, then commit**

Run: `cd ads-agent && npx vitest run`, then `npx vitest run` from the repo root.
Expected: green in both.

```bash
git add ads-agent/lib/artifacts/erasure.integration.test.ts
git commit -m "test(artifacts): S8a gate -- write, read, erase with no bytes behind

The gate assertion asks the object store, not Postgres. Suppressing the index
row while the bytes remain is exactly the failure this test exists to catch."
```

**S8a gate:** an artifact survives a write and a read; a per-subject erasure and a tenant offboarding each leave zero objects under the relevant prefix, verified by `HEAD` and prefix listing against Garage itself; the tombstone row survives; the deletion ledger records `store = 'objectstore'`, `state = 'erased'`; the orphan sweep respects its grace window; the dangling sweep flags without deleting. **Stop and confirm before Task 16.**

---

# Task 16 (Wave 6): the S8 gates

**Files:**
- Create: `ads-agent/lib/context-graph/traverse.integration.test.ts`
- Create: `ads-agent/lib/context-graph/snapshot-iam.integration.test.ts`
- Create: `ads-agent/lib/context-graph/backpressure.storm.test.ts`

**Skills:** `senior-qa`, `security-engineer`
**Model:** inherit

**Gate:** *the first traversal query answers correctly*, plus the two cross-cutting items that attach at S8 — rebuild backpressure (§12.2) and snapshot storage IAM (§12.3).

- [ ] **Step 1: Write the traversal gate**

```ts
// ads-agent/lib/context-graph/traverse.integration.test.ts
/**
 * The S8 gate. Seeds a known graph directly into ClickHouse, then asks the
 * traversal for an answer computed independently by hand.
 *
 * Fixture: corridor HSR has one campaign with 4 enquiries of which 3 closed;
 * corridor ORR has one campaign with 4 enquiries of which 1 closed. So HSR
 * converts at 0.75 and ORR at 0.25, and HSR must come first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { chCommand, chQuery } from "./clickhouse";
import { convertingCorridors, corridorAncestors, substituteSpaces } from "./traverse";
import type { Scope } from "../db/scope-sql";

const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const SNAP = randomUUID();
const scope: Scope = { kind: "org", orgId: ORG };
const other: Scope = { kind: "org", orgId: OTHER_ORG };

const HSR = randomUUID();
const ORR = randomUUID();
const CITY = randomUUID();
const CAMPAIGN_HSR = randomUUID();
const CAMPAIGN_ORR = randomUUID();
const SPACE = randomUUID();
const SUBSTITUTE = randomUUID();

const node = (id: string, kind: string, label: string) =>
  `(toUUID('${ORG}'), toUUID('${SNAP}'), toUUID('${id}'), '${kind}', '${label}', NULL, '{}')`;

const edge = (
  src: string, srcKind: string, kind: string, tgt: string, tgtKind: string, weight = "NULL",
) =>
  `(toUUID('${ORG}'), toUUID('${SNAP}'), toUUID('${src}'), '${srcKind}', '${kind}',` +
  ` toUUID('${tgt}'), '${tgtKind}', NULL, ${weight}, NULL, '{}')`;

beforeAll(async () => {
  const enquiriesHsr = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const enquiriesOrr = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const closedHsr = enquiriesHsr.slice(0, 3);
  const closedOrr = enquiriesOrr.slice(0, 1);

  const nodes = [
    node(HSR, "Corridor", "HSR Layout"),
    node(ORR, "Corridor", "ORR Bellandur"),
    node(CITY, "Corridor", "Bangalore"),
    node(CAMPAIGN_HSR, "Campaign", "hsr-search"),
    node(CAMPAIGN_ORR, "Campaign", "orr-search"),
    node(SPACE, "Space", "Rejected Space"),
    node(SUBSTITUTE, "Space", "Substitute Space"),
    ...[...enquiriesHsr, ...enquiriesOrr].map((id) => node(id, "Enquiry", "closed")),
    ...[...closedHsr, ...closedOrr].map((id) => node(id, "Outcome", "won")),
  ];

  const edges = [
    edge(HSR, "Corridor", "PART_OF", CITY, "Corridor"),
    edge(ORR, "Corridor", "PART_OF", CITY, "Corridor"),
    edge(CAMPAIGN_HSR, "Campaign", "TARGETS", HSR, "Corridor"),
    edge(CAMPAIGN_ORR, "Campaign", "TARGETS", ORR, "Corridor"),
    ...enquiriesHsr.map((id) => edge(CAMPAIGN_HSR, "Campaign", "GENERATED", id, "Enquiry")),
    ...enquiriesOrr.map((id) => edge(CAMPAIGN_ORR, "Campaign", "GENERATED", id, "Enquiry")),
    ...[...closedHsr, ...closedOrr].map((id) => edge(id, "Enquiry", "RESULTED_IN", id, "Outcome")),
    edge(SPACE, "Space", "SIMILAR_TO", SUBSTITUTE, "Space", "0.91"),
    edge(SUBSTITUTE, "Space", "LOCATED_IN", HSR, "Corridor"),
  ];

  await chCommand(
    `INSERT INTO gentle_space.graph_node
       (org_id, snapshot_id, node_id, node_kind, label, subject_ref, props)
     VALUES ${nodes.join(",")}`,
  );
  await chCommand(
    `INSERT INTO gentle_space.graph_edge
       (org_id, snapshot_id, source_id, source_kind, relationship_kind, target_id,
        target_kind, meters, weight, confidence, props)
     VALUES ${edges.join(",")}`,
  );
});

afterAll(async () => {
  await chCommand(
    `ALTER TABLE gentle_space.graph_node DELETE WHERE snapshot_id = toUUID('${SNAP}')`,
  );
  await chCommand(
    `ALTER TABLE gentle_space.graph_edge DELETE WHERE snapshot_id = toUUID('${SNAP}')`,
  );
});

describe("S8 gate: the first traversal query answers correctly", () => {
  it("ranks HSR above ORR with the conversion rates computed by hand", async () => {
    const rows = await convertingCorridors(scope, SNAP, { minEnquiries: 1 });

    expect(rows.map((r) => r.corridorLabel)).toEqual(["HSR Layout", "ORR Bellandur"]);
    expect(rows[0]).toMatchObject({
      corridorId: HSR, corridorLabel: "HSR Layout", enquiries: 4, converted: 3,
    });
    expect(rows[0].conversionRate).toBeCloseTo(0.75, 5);
    expect(rows[1]).toMatchObject({ enquiries: 4, converted: 1 });
    expect(rows[1].conversionRate).toBeCloseTo(0.25, 5);
  });

  it("honours the minimum enquiry threshold", async () => {
    await expect(convertingCorridors(scope, SNAP, { minEnquiries: 5 })).resolves.toEqual([]);
  });

  it("finds the substitute space with its weight and corridor", async () => {
    const rows = await substituteSpaces(scope, SNAP, SPACE, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].spaceId).toBe(SUBSTITUTE);
    expect(rows[0].label).toBe("Substitute Space");
    expect(rows[0].corridorId).toBe(HSR);
    expect(rows[0].weight).toBeCloseTo(0.91, 3);
  });

  it("walks the corridor hierarchy as PART_OF edges", async () => {
    await expect(corridorAncestors(scope, SNAP, HSR)).resolves.toEqual([CITY]);
    await expect(corridorAncestors(scope, SNAP, CITY)).resolves.toEqual([]);
  });

  it("answers nothing for a tenant that owns none of these rows", async () => {
    await expect(convertingCorridors(other, SNAP, { minEnquiries: 1 })).resolves.toEqual([]);
    await expect(substituteSpaces(other, SNAP, SPACE, 5)).resolves.toEqual([]);
  });

  it("enforces the row policy even when a caller forgets the predicate", async () => {
    const rows = await chQuery<{ c: string }>(
      `SELECT toString(count()) AS c FROM gentle_space.graph_node
        WHERE snapshot_id = toUUID('${SNAP}')`,
      { orgId: OTHER_ORG },
    );
    expect(Number(rows[0].c)).toBe(0);
  });
});
```

- [ ] **Step 2: Write the snapshot IAM isolation gate**

```ts
// ads-agent/lib/context-graph/snapshot-iam.integration.test.ts
/**
 * Datastore §12.3: snapshot storage is a tenancy boundary. This proves it at the
 * credential layer rather than the application layer -- tenant A's own access
 * key is refused by the object store when pointed at tenant B's bucket.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/client";
import { ObjectStore } from "../objectstore/client";
import { deleteBucket, garageAdminFromEnv, getBucketByAlias } from "../objectstore/garage-admin";
import {
  destroyTenantSnapshotKey, provisionSnapshotStorage, readerCredentials,
  snapshotBucketName, tenantDataKey,
} from "./snapshot-iam";
import { openBytes, sealBytes } from "./snapshot-export";
import type { Scope } from "../db/scope-sql";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const scopeA: Scope = { kind: "org", orgId: ORG_A };
const pool = getPool();
const server = ObjectStore.fromEnv();

beforeAll(async () => {
  for (const orgId of [ORG_A, ORG_B]) {
    await pool.query(
      `INSERT INTO public.orgs (id, name, kind) VALUES ($1, $2, 'external')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, `iam-${orgId.slice(0, 8)}`],
    );
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    await provisionSnapshotStorage({ kind: "org", orgId });
  }
});

afterAll(async () => {
  const admin = garageAdminFromEnv();
  for (const orgId of [ORG_A, ORG_B]) {
    const bucketName = snapshotBucketName(orgId);
    const bucket = await getBucketByAlias(admin, bucketName);
    if (bucket) {
      for await (const object of server.list(bucketName, "")) {
        await server.remove(bucketName, object.key);
      }
      await deleteBucket(admin, bucket.id);
    }
    await pool.query(`DELETE FROM context.snapshot_storage WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM public.orgs WHERE id = $1`, [orgId]);
  }
});

describe("snapshot storage is a tenancy boundary at the credential layer", () => {
  it("gives each tenant its own bucket", () => {
    expect(snapshotBucketName(ORG_A)).not.toBe(snapshotBucketName(ORG_B));
  });

  it("lets a tenant's own key read its own snapshot", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    await server.put(
      snapshotBucketName(ORG_A), "s.duckdb.enc",
      new TextEncoder().encode("A bytes"), "application/octet-stream",
    );

    const readerA = new ObjectStore(await readerCredentials(scopeA));
    const bytes = await readerA.get(snapshotBucketName(ORG_A), "s.duckdb.enc");
    expect(new TextDecoder().decode(bytes!)).toBe("A bytes");
  });

  it("REFUSES tenant A's key against tenant B's bucket, at the object store", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_B]);
    await server.put(
      snapshotBucketName(ORG_B), "s.duckdb.enc",
      new TextEncoder().encode("B bytes"), "application/octet-stream",
    );

    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    const readerA = new ObjectStore(await readerCredentials(scopeA));

    // Not a 404 and not an application check: Garage refuses the credential.
    await expect(readerA.get(snapshotBucketName(ORG_B), "s.duckdb.enc")).rejects.toThrow(/403/);
  });

  it("refuses a write with a read-only tenant key", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    const readerA = new ObjectStore(await readerCredentials(scopeA));
    await expect(
      readerA.put(snapshotBucketName(ORG_A), "nope", new Uint8Array([1]), "text/plain"),
    ).rejects.toThrow(/403/);
  });

  it("crypto-shreds every snapshot when the tenant data key is destroyed", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    const key = await tenantDataKey(scopeA);
    const sealed = sealBytes(new TextEncoder().encode("snapshot"), key);
    expect(openBytes(sealed, key).toString("utf8")).toBe("snapshot");

    await destroyTenantSnapshotKey(scopeA);
    await expect(tenantDataKey(scopeA)).rejects.toThrow(/destroyed/);
  });
});
```

- [ ] **Step 3: Write the rebuild-storm gate**

```ts
// ads-agent/lib/context-graph/backpressure.storm.test.ts
/**
 * Datastore §12.2: "a bulk listings sync marks every tenant stale at once and
 * stampedes." This proves it does not. Live Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/client";
import { claimRebuild, finishRebuild, markTenantStale, REBUILD_CEILING } from "./backpressure";

const pool = getPool();
const ORGS = Array.from({ length: 50 }, () => randomUUID());

async function resetSlotsAndManifests(): Promise<void> {
  await pool.query(`UPDATE context.rebuild_slots SET org_id = NULL, leased_until = NULL`);
  await pool.query(`DELETE FROM context.graph_manifests WHERE org_id = ANY($1::uuid[])`, [ORGS]);
}

beforeAll(async () => {
  for (const orgId of ORGS) {
    await pool.query(
      `INSERT INTO public.orgs (id, name, kind) VALUES ($1, $2, 'external')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, `storm-${orgId.slice(0, 8)}`],
    );
  }
});

afterAll(async () => {
  await resetSlotsAndManifests();
  await pool.query(`DELETE FROM public.orgs WHERE id = ANY($1::uuid[])`, [ORGS]);
});

describe("a rebuild storm stays bounded", () => {
  it("never has more than the ceiling building at once, under 8 concurrent workers", async () => {
    await resetSlotsAndManifests();
    for (const orgId of ORGS) {
      await pool.query("SELECT public.set_tenant($1)", [orgId]);
      await markTenantStale({ kind: "org", orgId }, { byUser: false });
    }
    // Make every tenant eligible: the debounce is 300 s and the test will not wait.
    await pool.query(
      `UPDATE context.graph_manifests SET stale_since = now() - interval '1 hour'
        WHERE org_id = ANY($1::uuid[])`,
      [ORGS],
    );

    let peak = 0;
    const worker = async () => {
      for (let i = 0; i < 12; i++) {
        const claim = await claimRebuild();
        if (!claim) return;
        const { rows } = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM context.graph_manifests WHERE status = 'building'`,
        );
        peak = Math.max(peak, Number(rows[0].n));
        await finishRebuild(claim, { sourceWatermark: new Date(), cdcLagSeconds: 0 });
      }
    };

    await Promise.all(Array.from({ length: 8 }, worker));

    expect(REBUILD_CEILING).toBe(2);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(REBUILD_CEILING);
  });

  it("does not claim a tenant inside the debounce window", async () => {
    await resetSlotsAndManifests();
    const fresh = ORGS[0];
    await pool.query("SELECT public.set_tenant($1)", [fresh]);
    await markTenantStale({ kind: "org", orgId: fresh }, { byUser: true });

    await expect(claimRebuild()).resolves.toBeNull();
  });

  it("coalesces repeated stale marks into one debounce clock", async () => {
    await resetSlotsAndManifests();
    const orgId = ORGS[1];
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    await markTenantStale({ kind: "org", orgId }, { byUser: false });
    const first = await pool.query<{ stale_since: Date }>(
      `SELECT stale_since FROM context.graph_manifests WHERE org_id = $1`, [orgId],
    );

    for (let i = 0; i < 5; i++) {
      await markTenantStale({ kind: "org", orgId }, { byUser: false });
    }
    const after = await pool.query<{ stale_since: Date }>(
      `SELECT stale_since FROM context.graph_manifests WHERE org_id = $1`, [orgId],
    );

    // Refreshing the clock on every mark would mean a bulk import never becomes
    // eligible at all.
    expect(after.rows[0].stale_since.getTime()).toBe(first.rows[0].stale_since.getTime());
  });

  it("builds a tenant with recent user activity before an older idle one", async () => {
    await resetSlotsAndManifests();
    const idle = ORGS[2];
    const active = ORGS[3];
    for (const [orgId, byUser] of [[idle, false], [active, true]] as const) {
      await pool.query("SELECT public.set_tenant($1)", [orgId]);
      await markTenantStale({ kind: "org", orgId }, { byUser });
    }
    // The idle tenant went stale first, so only priority can reorder them.
    await pool.query(
      `UPDATE context.graph_manifests
          SET stale_since = CASE WHEN org_id = $1 THEN now() - interval '2 hours'
                                 ELSE now() - interval '1 hour' END
        WHERE org_id = ANY($2::uuid[])`,
      [idle, [idle, active]],
    );

    const claim = await claimRebuild();
    expect(claim?.orgId).toBe(active);
    if (claim) await finishRebuild(claim, { sourceWatermark: new Date(), cdcLagSeconds: 0 });
  });
});
```

- [ ] **Step 4: Run all three gates**

```bash
docker compose -f docker-compose.garage.yml up -d && ./scripts/garage/bootstrap.sh
npx tsx scripts/clickhouse/migrate.ts
cd ads-agent && npx vitest run lib/context-graph/traverse.integration.test.ts lib/context-graph/snapshot-iam.integration.test.ts lib/context-graph/backpressure.storm.test.ts
```

Expected: PASS (15 tests). The three load-bearing ones are `ranks HSR above ORR with the conversion rates computed by hand`, `REFUSES tenant A's key against tenant B's bucket, at the object store`, and `never has more than the ceiling building at once, under 8 concurrent workers`.

- [ ] **Step 5: Prove Apache AGE is unaffected**

The one regression this plan could plausibly cause is breaking the *other* graph. Nothing here touches `lib/graph/age.ts`, and this is the check that says so.

```bash
git diff --name-only $(git merge-base main HEAD)..HEAD \
  | grep -E '^lib/graph/|^scripts/(check-graph-boost|rebuild-listing-graph)' \
  || echo "no AGE files touched"
npm run graph:check
```

Expected: `no AGE files touched`, then non-zero overlap for the known Bellandur listing row, matching pre-branch behaviour.

- [ ] **Step 6: Full suite, run the worker end to end, commit**

```bash
cd ads-agent && npx vitest run && cd .. && npx vitest run
cd ads-agent && npm run graph:worker
```

Expected: both suites green; the worker prints `rebuilds=N collected=... blockedByLease=0` and exits 0.

```bash
git add ads-agent/lib/context-graph/
git commit -m "test(context-graph): S8 gates -- traversal, IAM isolation, storm bound

The traversal gate checks a hand-computed answer rather than internal
consistency. The IAM gate proves a tenant's own key is refused against another
tenant's bucket by Garage, not by an application check. The storm gate runs 8
workers against 50 stale tenants and asserts the ceiling of 2 holds."
```

**S8 gate:** the first traversal query answers correctly against a hand-computed fixture; tenant A's snapshot credential is refused against tenant B's bucket at the object store; a 50-tenant storm under 8 workers never exceeds 2 concurrent rebuilds and respects the debounce and priority rules; `npm run graph:check` still reports non-zero AGE overlap.

---

# Task 17 (Wave 7): Final review

**Skills:** `adversarial-reviewer`
**Model:** inherit

- [ ] Dispatch one `adversarial-reviewer` over `git diff $(git merge-base main HEAD)..HEAD`, with the Global Constraints section above as its attention lens.

Point its Security Auditor persona at five things specifically:

1. **Can any code path build a storage key without `artifactStorageKey`?** Grep for the literal `artifacts/` outside `ads-agent/lib/artifacts/key.ts` and the migrations. Every hit is a potentially missing tenant segment.
2. **Can any query reach `context.artifacts`, `context.graph_snapshots`, `context.snapshot_storage`, `context.deletion_propagations` or `context.artifact_dangling_flags` without `scopeClause` or an explicit `org_id` predicate?** The `context_maintenance` policies are intentional exceptions; anything else is a leak.
3. **Does every erasure path verify byte absence before recording it?** `deleteAndVerify` is the only route; any direct `store.remove` followed by an `erased_at` update is the bug this plan exists to prevent.
4. **Is `FORCE ROW LEVEL SECURITY` set on every table migrations 080–087 created?** Run the catalogue query and expect zero rows:

```sql
SELECT n.nspname, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'context'
   AND c.relkind = 'r'
   AND c.relname IN ('artifacts','graph_manifests','graph_snapshots','snapshot_leases',
                     'snapshot_storage','deletion_requests','deletion_propagations',
                     'artifact_dangling_flags')
   AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
```

`context.rebuild_slots` and `context.artifact_sweep_runs` are deliberately absent from that list: neither is a tenant table, and the reason is recorded in migrations 085 and 082 respectively.

5. **Did anything touch Apache AGE?** `git diff --name-only $(git merge-base main HEAD)..HEAD | grep '^lib/graph/'` must be empty.

- [ ] Address findings, re-run both suites and all four integration/gate test files, and commit.

---

## Self-review

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| build sequence S8 — context graph, gate "first traversal query answers correctly" | 4, 7, 10, 16 |
| build sequence S8a — Garage, `context.artifacts`, orphan and dangling sweeps | 1, 2, 3, 6, 9, 12, 13, 15 |
| build sequence — S8a standalone after S2, no graph or agent dependency | Preconditions; wave table (T1/T2/T3 carry no graph dependency) |
| build sequence — §12.2 rebuild backpressure and snapshot collection attach at S8 | 5, 8, 14, 16 |
| build sequence — §12.3 snapshot storage IAM attaches at S8 | 11, 16 |
| datastore §6 what the graph models | 4 (node/edge tables), 7 (8 kinds, 9 relationships) |
| datastore §6.1 tables not a graph engine; no Cypher | 4 (DDL test asserts no Cypher, no `CREATE PROPERTY GRAPH`), 10 (bounded hops, SQL/PGQ-compatible) |
| datastore §6.2 one polymorphic edge table, `org_id` and `snapshot_id` on every row, a manifest table, typed edge columns, no `traversal_path` | 4, 5, 7 |
| datastore §6.3 curated projection, on-demand debounced rebuild, row policy per table | 5, 7, 14 |
| datastore §6.4 snapshots opened READ_ONLY, never build in place, old snapshots collected | 8, 14 |
| datastore §12.1 `source_watermark` and `cdc_lag_seconds` recorded at build time | 5, 7, 8, 14 |
| datastore §12.2 ceiling 2, debounce 300 s, priority by recent activity, generation collection with leases | 5, 8, 16 |
| datastore §12.3 prefix per tenant, scoped credential, CMEK per tenant | 11, 16 |
| datastore §13.1 Garage, the narrow job, no presigned URLs, key prefix per tenant, prefix and per-subject erasure, orphan and dangling sweeps | 1, 6, 9, 12, 13 |
| datastore §13.4 retention by bytes, recordings set deliberately against the floor | 9 (`RETENTION_DAYS`) |
| datastore §11.1 suppression first, hard delete later | 2 (`erased_at` tombstone), 12 (ledger) |
| datastore §11.2 per-store consequences, subject provenance on graph rows, snapshot TTL or crypto-shred | 4 (`subject_ref`), 8 (`expires_at`), 11 (data key), 14 (sealed bytes) |
| data model §8 graph model, node kinds and relationships | 7 — 8 of 10 kinds, 9 of 11 relationships; the two gaps are reported |
| data model §8a `context.artifacts` shape, indexes, RLS, write order, erasure | 2, 9, 12 |
| data model §9 DuckDB snapshot, `snapshot_meta`, the three rules | 8, 14 |
| data model §0 conventions and §1 tenancy primitives | every migration; `migration-assertions.ts` enforces them mechanically for PostgreSQL `080`–`087`, and `lib/clickhouse/graph-schema.test.ts` enforces up/down pairing and applied-state for ClickHouse `010`–`014` |
| dataflow review A-4 `evidence` holds identifiers only | Global Constraints; artifacts are referenced by `id` as text, and no task adds a foreign key from `proposals.evidence` |
| dataflow review A-3 never a copy of something already stored | Global Constraints; the five `content_type` values are all content with no other home |

**Gaps found, and what was done about each.** Three, all surfaced rather than papered over: `POI`/`NEAR` and `Organisation`/`WORKS_FOR` have no defined source, so Task 7 excludes them explicitly and its test asserts the exclusion; datastore open question 6 (embedding home) had to be decided to build `SIMILAR_TO` at all, and Task 7 decides it in the no-duplication direction and says so in a comment.

### 2. Placeholder scan

No `TBD`, no `TODO`, no "implement later", no "add error handling", no "similar to Task N". Every code step carries the complete file or a complete fragment with its surrounding context. Every command has an expected output. The only deliberately unfilled values are the two Garage secrets in `.env.example`, marked `<printed by scripts/garage/bootstrap.sh>` because they are generated at bootstrap and must not be committed.

### 3. Type consistency

Checked every name that crosses a task boundary:

- `ObjectStore` methods are `put` / `get` / `head` / `remove` / `list` in Task 6 and in every consumer (9, 11, 12, 13, 14, 15, 16) — `remove`, never `delete`.
- `ObjectSummary` is `{ key, byteSize, lastModified }` everywhere; `byteSize`, never `size`.
- `ARTIFACT_BUCKET` is exported from `lib/artifacts/store.ts` and imported by `erase.ts`, `sweeps.ts` and the gate test.
- `artifactStorageKey(scope, contentType, artifactId)` keeps the same three-argument order in Tasks 2, 9 and 15.
- `RebuildClaim` is `{ orgId, slotNo, snapshotId, generation }` in Task 5, in the Task 14 worker, and in the Task 16 storm test.
- `SnapshotRecord` field names in Task 8's `recordSnapshot` match exactly what the Task 14 worker passes: `bucket` and `storageKey` (not `storage_key`), `sourceWatermark`, `cdcLagSeconds`.
- `sealSecret` / `openSecret` (master key, `envelope.ts`) are deliberately distinct names from `sealBytes` / `openBytes` (tenant data key, `snapshot-export.ts`); they operate under different keys and are never interchanged. Task 16 imports the second pair only.
- `snapshotBucketName(orgId)` takes a raw org id, not a `Scope`, and is called that way in Tasks 14 and 16.
- `assertTenantTableHardening(sql, qualifiedTable)` has the same signature in the migration tests for 080, 081, 082, 085, 086 and 087.
- `enqueueEvent(scope, client, { topic, payload })` is called identically in Task 5 and Task 12, with topics `graph.tenant_stale` and `deletion.requested` — both in the S5a vocabulary. **Checked against the S5a plan as landed** rather than assumed: the argument order is scope-then-client, the event is one object, and the helper throws on platform scope, which is why both call sites construct `{ kind: "org", orgId: scope.orgId }` explicitly instead of forwarding a scope that might be platform.
- `withTenantTransaction(scope, fn, pool?)` is the only transaction helper used: org scope wherever an event is enqueued, platform scope in `finishRebuild` / `failRebuild` where the worker is a deliberate cross-tenant actor and setting a tenant would restrict it by RLS.
- `chQuery(sql, opts)` / `chCommand(sql, opts)` with `{ orgId, params, settings, creds }` is the shape used in Tasks 4, 7, 10, 14 and 16 — `ads-agent`'s own client, deliberately distinct from the root app's `lib/clickhouse/client.ts` because neither app imports across the app boundary. The duplication is S6/S6a's stated convention, not an oversight.
- `applyMigrations(options?)`, `DEFAULT_MIGRATIONS_DIR`, `chExec` and `chQuery` in `lib/clickhouse/graph-schema.test.ts` are **imported from S6/S6a, not redefined**. Signatures checked against that plan as written: `applyMigrations({ dir?, config? }): Promise<string[]>` returning newly-applied versions, `DEFAULT_MIGRATIONS_DIR` = `path.join(process.cwd(), "infra/clickhouse/migrations")`, ledger `default._ch_migrations` keyed on `file.slice(0, 3)`. This plan adds no runner, no ledger and no apply script in either engine.
- `collectSnapshots` and `recordSnapshot` are both imported from `./snapshot-lease` in Task 14's worker — one module, one import.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-12-s8-s8a-context-graph-artifacts.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration. Waves 1–4 dispatch `best-of-n-runner` agents in isolated worktrees at widths 5, 3, 3, 3, with a fan-in merge closing each wave.

**2. Inline Execution** — execute tasks in one session using `superpowers:executing-plans`, batching with checkpoints at each wave boundary.

Which approach?

