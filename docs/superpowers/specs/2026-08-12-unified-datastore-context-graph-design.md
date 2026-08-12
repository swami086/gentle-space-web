# Unified datastore, multi-tenancy, and the context graph

Date: 2026-08-12
Status: draft for review
Companions: `2026-08-12-backend-features-design.md`, `2026-08-11-tenancy-authz-foundation-design.md`
Supersedes: open question D2 in the backend spec (resolved by consolidation, see §4)

## 1. What changed

The product is now framed as a **productised multi-tenant AI SaaS for real-estate brokers**, not
an internal tool. That reframes every storage decision: tenant isolation stops being a feature and
becomes the substrate.

Three storage jobs, deliberately separated:

| Job | Engine | Role |
|---|---|---|
| Transactions | PostgreSQL 16 | system of record, tenant-isolated, serves the product |
| Analytics | ClickHouse | mirror fed by CDC; never authoritative |
| Context graph | node + edge **tables** in ClickHouse | queried with SQL; no graph engine |
| Per-tenant serving | DuckDB snapshot per tenant | rebuilt on demand from ClickHouse |

---

## 2. Decisions

- **UD1 — PostgreSQL is the system of record.** Relational core, JSONB for document/NoSQL shapes,
  pgvector for embeddings, Apache AGE retained for the existing listings-search graph boost.
  Everything commits in one transaction boundary.

- **UD2 — Consolidate `gentle_space_listings` and `ads_agent` into one Postgres instance, one
  schema per service.** Per [microservices.io](https://microservices.io/patterns/data/database-per-service.html):
  *"Private-tables-per-service and schema-per-service have the lowest overhead. Using a schema per
  service is appealing since it makes ownership clearer."* The boundary is enforced with a distinct
  DB user per schema plus grants, which the same source recommends because *"without some kind of
  barrier… developers will always be tempted to bypass a service's API."*

- **UD3 — `auth_service` stays on its own instance.** Credentials do not share a blast radius with
  application data.

- **UD4 — Tenancy is shared-schema with row-level security**, in both engines, using the same
  session-variable pattern (§5).

- **UD5 — ClickHouse is adopted now**, as the analytical mirror and the substrate for the context
  graph. Fed by CDC from Postgres. Never the system of record — ClickHouse has no transactions.

- **UD6 — The context graph is plain tables, not a graph engine.** Typed node tables plus a single
  polymorphic edge table in ClickHouse, queried with SQL. **This replaces the earlier PuppyGraph
  decision** (revised 2026-08-12, §6.1), removing a commercial dependency whose free edition is
  single-node and proof-of-concept only.

- **UD13 — Each tenant gets a DuckDB snapshot**, rebuilt on demand from ClickHouse, used to serve
  that tenant's agent and search reads. ClickHouse holds the multi-tenant union where cross-tenant
  analytics run; the snapshots are per-tenant projections of it.

- **UD14 — Edge properties are typed columns, not JSON.** Our edge properties are a small, known
  set. ClickHouse's own guidance: *"You should only use the JSON type when the structure of your
  data is dynamic… Your data structure is known and consistent — in this case, use normal columns."*

- **UD7 — The graph is a curated projection**, rebuilt on a schedule, not a live mirror of every
  operational row. Matches the existing `lib/graph/rebuild.ts` approach.

- **UD8 — The graph models the full domain**: spaces, corridors, enquiries, people, requirements,
  campaigns, calls, and outcomes.

- **UD9 — Apache AGE is retained**, scoped to the existing listings-search boost in
  `/api/spaces/search`. It is in the hot path and transactional; removing it is out of scope.
  Two graph representations is a real cost, accepted knowingly (§9), and a candidate for collapsing
  onto one table model once PostgreSQL 19 SQL/PGQ is GA.

- **UD10 — Agents are Hermes profiles**, one per specialisation, internal-facing initially.

- **UD11 — Inter-agent coordination is Hermes Kanban**, with `delegate_task` for synchronous
  sub-answers only.

- **UD12 — Shared agent context comes from an MCP server, not from memory providers**, which are
  per-profile isolated by design.

---

## 3. Target architecture

```
                    ┌─────────────────────────────┐
   product reads/   │  PostgreSQL 16              │
   writes ─────────▶│  schemas: listings,         │
                    │    adsagent, context        │
                    │  pgvector · AGE · JSONB     │
                    │  RLS (FORCE) per tenant     │
                    │  system of record + control │
                    │  plane (graph manifest)     │
                    └──────────┬──────────────────┘
                               │ CDC (PeerDB / ClickPipes)
                               ▼
                    ┌─────────────────────────────┐
                    │  ClickHouse                 │
                    │  facts, events, rollups     │
                    │  node + edge tables         │
                    │  row policies per tenant    │
                    └──────────┬──────────────────┘
                               │ on-demand export per tenant
                               ▼
                    ┌─────────────────────────────┐
                    │  DuckDB snapshot per tenant │
                    │  one file per org           │
                    │  serves that tenant's reads │
                    └─────────────────────────────┘

   Hermes agents ──▶ MCP context server ──▶ all three, tenant-scoped
```

`pg_clickhouse` (FDW) is installed so application code can reach analytical tables through a single
Postgres connection. It pushes down aggregates, `GROUP BY`, `ORDER BY`, `HAVING`, `WHERE` including
LIKE/regex, date functions, `CASE WHEN`, and JOINs between foreign tables.

**Rule:** cross-system joins execute with only the ClickHouse portion pushed down and the join
performed in Postgres. Keep analytical tables together in ClickHouse and join them there.

### 3.1 Why PostgreSQL is retained (evaluated 2026-08-12)

Asked directly, once ClickHouse and DuckDB were both in the design: is Postgres still needed?
**Yes, with high confidence — there is no candidate to replace it.**

| Criterion | PostgreSQL | ClickHouse | DuckDB |
|---|---|---|---|
| ACID transactions | yes | **none** | yes, but single-process |
| Row-level security | `FORCE RLS`, mature | row policies | none |
| Foreign keys, unique constraints | yes | **none** | partial |
| Update/delete-heavy OLTP | yes | mutations discouraged | not a server |
| Concurrent writer processes | yes | yes | **no** (Quack is beta until ~DuckDB 2.0) |
| Existing code investment | all of `lib/db/*` | none | none |

A proposal-approval flow that commits real ad spend needs transactions and constraints; UD5 already
records that ClickHouse has neither. GitLab Orbit made the same split — Rails/Postgres as source of
truth, ClickHouse for the graph only.

### 3.2 What lives in the `context` schema

The graph itself moved to ClickHouse (§6.1), so this Postgres schema holds the **transactional
control plane** that the columnar store cannot:

- **The graph manifest** — per-tenant `status`, `last_built_at`, `snapshot_id`, `error_message`.
  Small, contended, and read-modify-written by both the app (marking a tenant stale) and the
  builder (claiming work). It describes the graph but must not live in it.
- **Agent task tokens** — the dispatcher-minted `(task_id, profile, org_id)` bindings from the
  agent spec, kept server-side so they are revocable.
- **Agent proposal provenance** — which agent proposed what, with which evidence.

---

## 4. Consolidation — and what it resolves

Today: `gentle_space_listings` :5433 (pg16 + AGE + pgvector), `ads_agent` :5434,
`auth_service` :5435, Twenty CRM external.

Target: one instance hosting `listings` and `adsagent` schemas plus a new `context` schema;
`auth_service` untouched.

**This closes open question D2 from the backend spec.** "How does `ads-agent` read listings?" was
going to need an API, a projection, or a second connection. After consolidation it is a `GRANT`.
Per-space metrics, call-prep grounded in real availability, and the enquiry→listing resolution all
stop being integrations.

Migration is `pg_dump` of `ads_agent` restored into a new schema, then repointing `DATABASE_URL`
and setting `search_path`. Low risk: no table renames, no data reshaping. `ads-agent`'s
`lib/db/migrate.ts` trap still applies — every change must be an idempotent `ALTER`, never a
modification inside a `CREATE TABLE` body.

---

## 5. Tenancy: one pattern, two engines

The same mental model works in both, which is the main reason this architecture is tractable.

**PostgreSQL**

```sql
ALTER TABLE enquiry ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry FORCE ROW LEVEL SECURITY;   -- owners must not bypass

CREATE POLICY tenant_isolation ON enquiry
  USING (org_id = current_setting('app.current_tenant_id')::uuid);

CREATE INDEX ON enquiry (org_id, created_at DESC);  -- tenant_id MUST lead
```

> **CRITICAL — the pooling hazard.** Both apps use `pg.Pool`, so connections are reused across
> requests. `set_config('app.current_tenant_id', $1)` **without** the third argument persists on the
> connection after the transaction ends, and the next request to reuse that connection inherits the
> previous tenant's context. RLS then faithfully enforces the *wrong* tenant — a silent cross-tenant
> read with no error and no log line.
>
> Every call site must use the local form, inside a transaction:
>
> ```sql
> BEGIN;
> SELECT set_config('app.current_tenant_id', $1, true);  -- true = transaction-scoped
> -- ... queries ...
> COMMIT;
> ```
>
> This must be wrapped in a single helper that no code path bypasses, and covered by the
> cross-tenant test suite that the tenancy spec makes a release gate. If a connection pooler
> (PgBouncer) is later placed in front in transaction mode, the same rule is what keeps it safe.

**ClickHouse**

```sql
CREATE ROW POLICY tenant_policy ON enquiry_fact
  USING org_id = toUUID(getSetting('SQL_current_tenant_id'));
```

Guidance taken from ClickHouse's own [multi-tenant Postgres
guide](https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture):

- *"RLS should act as an infrastructure safety net, not your primary authorization gate."*
  Application-level tenant filtering stays the front line; RLS is the backstop for developer error.
- *"Slow RLS is almost always unoptimized RLS"* — a policy matching `current_setting` against an
  indexed tenant column is a normal index lookup. But a missing **leading-edge** tenant index
  *"quietly destroys customer-facing query latency at scale."*
- Superusers and `BYPASSRLS` roles always bypass. Keep them out of application code paths.

### The four isolation pillars

1. **Operational** — no noisy neighbours; statement timeouts, connection-pool discipline.
2. **Data** — RLS in both engines, plus application filtering.
3. **Compliance** — per-tenant export, deletion, and restore must be possible. Design for it now;
   shared-schema makes single-tenant point-in-time restore the hardest of the four.
4. **Analytical** — dashboards never run on the OLTP primary. This is what ClickHouse is for.

### 5.1 The cross-tenant path (added 2026-08-12)

Aggregate insight across brokers — *which corridors convert best* — is a deliberate product goal.
That contradicts every other statement in these specs, which say cross-tenant reads are impossible.
Both cannot be true, so the exception is designed explicitly rather than discovered later.

**A separate privileged analytics service**, and nothing else, may read across tenants:

- Its own database role, distinct from the application role. The application role never gains
  `BYPASSRLS`.
- **Not reachable from the MCP context server**, so no agent can invoke it by any path. Agents
  remain tenant-pinned with no exception.
- Every cross-tenant query is written to an append-only audit log with the caller, the query, and
  the row count returned.
- It emits **aggregates only** into a separate store. Per-tenant rows never leave it, so a bug
  cannot surface one broker's enquiries inside another broker's UI.
- Reviewed against the compliance position (§11) before any personal data is aggregated.

The rule to hold onto: cross-tenant access is a *separate service with separate credentials*, never
a flag on the existing one.

### Agents and tenant context

The rule that binds the agent layer to the storage layer:

> *"The first thing a worker does on dequeue is call the same `set_config('app.current_tenant_id', …)`
> wrapper the API uses, inside the same transaction that runs the job logic."*

Hermes Kanban has a `--tenant` namespace per task. **That value is what the worker sets as database
tenant context on dequeue.** Agents then get identical storage-layer isolation to the API rather
than a parallel honour system. This is non-negotiable: an agent that forgets is a cross-tenant leak.

---

## 6. The context graph

### What it models

Nodes: `Space`, `Corridor`, `Person`, `Organisation`, `Enquiry`, `Requirement`, `Campaign`,
`Call`, `Outcome`.

Edges: `ENQUIRED_ABOUT` (Person→Space), `LOCATED_IN` (Space→Corridor), `TARGETS`
(Campaign→Corridor), `GENERATED` (Campaign→Enquiry), `ABOUT` (Call→Enquiry), `RESULTED_IN`
(Enquiry→Outcome), `SIMILAR_TO` (Space→Space, vector-derived), `WORKS_FOR` (Person→Organisation).

This is what makes questions answerable that SQL handles badly — *which corridors do enquiries that
convert actually originate from*, *which spaces are substitutes for the one a client rejected*,
*which campaigns produce enquiries that reach a viewing*.

### 6.1 Why tables rather than a graph engine (revised 2026-08-12)

This section replaces an earlier decision to use PuppyGraph. The revision follows
[GitLab Orbit](https://github.com/gitlabhq/orbit-knowledge-graph), which solves a near-identical
problem — a per-tenant knowledge graph served to AI agents, with a local embedded tier and a SaaS
tier.

Orbit's history is the argument. It was built on **KùzuDB, an embedded graph database, which was
then archived** — *"rendering it an unviable foundation for a production system."* GitLab
benchmarked Neo4j, FalkorDB and Memgraph, and
[selected ClickHouse](https://gitlab.com/groups/gitlab-org/-/epics/20822) *"for horizontal scale
and SQL operability."* Their SaaS tier streams data by CDC into ClickHouse and **builds the graph
there as tables**. No Cypher, no graph engine.

Three consequences for us: the commercial PuppyGraph dependency disappears; the single-node limit
of its free edition stops mattering; and we avoid betting the graph on a young vendor after
watching a serious org get burned doing exactly that.

**Forward compatibility is the bonus.** PostgreSQL 19 (Beta 1 shipped 2026-06-04, Beta 2
2026-07-16) introduces SQL/PGQ property graphs: `CREATE PROPERTY GRAPH` over `VERTEX TABLES` and
`EDGE TABLES`, queried with `GRAPH_TABLE(… MATCH …)`. Critically it is *"not a separate execution
engine bolted onto Postgres — it compiles to relational joins."* Because SQL/PGQ declares a graph
**over existing tables**, building the table model now means graph query syntax is later available
by declaration rather than by migration. Caveat: SQL/PGQ has **no variable-length paths** — *"you
write every hop explicitly"* — so arbitrary-depth traversal still means recursive CTEs. Our known
queries (fixed-hop POI proximity, bounded corridor hierarchy) fit inside that limit.

### 6.2 Schema conventions

Adopted from Orbit, after inspecting a real 12.3M-edge Orbit graph rather than trusting its schema
on paper.

- **One polymorphic edge table.** `(source_id, source_kind, relationship_kind, target_id,
  target_kind)`. Empirically load-bearing: Orbit's five relationship kinds span **eleven distinct
  kind-triples** — `CALLS` alone appears between four different node-kind pairs. A table per
  relationship would duplicate; a table per node-pair would explode.
- **`org_id` denormalised onto every node and edge row**, set at build time. This is exactly how
  Orbit shares one DuckDB file across repositories (`project_id` on every table).
- **A manifest table** — `status` enum (`pending | building | ready | error`), `last_built_at`,
  `error_message` — per tenant. Orbit uses this for index state; we need it for on-demand rebuilds.
- **`snapshot_id` on every row.** A rebuild lands as a new snapshot and swaps atomically rather
  than mutating in place, which also makes snapshots diffable.
- **Typed edge property columns** (`meters`, `weight`, `confidence`, `reason`) per UD14. Add a
  ClickHouse `JSON` column only if genuinely dynamic properties appear, and give it
  [type hints](https://clickhouse.com/docs/concepts/best-practices/json-type) if so — hinted paths
  *"are always stored just like traditional columns… achieve the same performance as if they were
  modeled as top-level fields."*

**Rejected: `traversal_path`.** Orbit's schema carries it, but every row I sampled in a live
database had it empty — the column is unpopulated in practice. Hierarchy is instead modelled the
way Orbit actually models it: as edges (`Directory CONTAINS Directory`, 27k rows). Our
Area ⊂ Corridor ⊂ City becomes `PART_OF` edges. Add a materialised path later only if traversal
depth measurably hurts.

### 6.3 How it is built

A curated projection (UD7). Operational rows land in ClickHouse via CDC; a build job derives node
and edge tables from them under a new `snapshot_id`; per-tenant DuckDB files are exported from
ClickHouse for serving (UD13).

**Rebuilds are on demand.** A material change to a tenant's listings, enquiries or campaigns marks
that tenant's graph `pending`; a debounced worker rebuilds and flips the manifest to `ready`.
Nightly cadence is not used — most tenants change rarely, and the ones that change want freshness.

Every node and edge table carries `org_id` and is covered by a ClickHouse row policy. DuckDB
snapshots contain a single tenant's rows, so the file boundary is a second, physical isolation
layer beneath the row policy.

The manifest itself lives in Postgres, not ClickHouse — see §3.2.

### 6.4 Snapshot serving rules

These follow from DuckDB's [concurrency model](https://duckdb.org/docs/current/connect/concurrency)
and are not optional.

- **Serving processes open snapshots `READ_ONLY`.** The docs are explicit: *"Read-only mode:
  multiple processes can read from the database, but no processes can write."* That is what allows
  several horizontally-scaled app instances to serve the same tenant concurrently.
- **Never build in place.** A rebuild writes a new file for the new `snapshot_id`, then the
  manifest flips to point at it and readers pick it up on next open. Writing to a file that
  readers hold would violate the rule above.
- **Do not rely on multi-process writes.** Cross-process writing needs the Quack remote protocol,
  *"in beta stage as of DuckDB v1.5.2… expected to become mature by DuckDB v2.0 in fall 2026."*
  Nothing in this design should depend on it.
- **Old snapshots are garbage-collected** once no reader holds them, tracked via the manifest.

---

## 7. Agent architecture (decided; detailed spec to follow)

**Profiles** — one Hermes profile per specialisation: `campaign`, `leads`, `performance`,
`content`, `research`, and `orchestrator`. Each gets its own home, config, memory, and command
alias. The Hermes docs are emphatic: *"Never point two agent processes at the same profile."*

Email drafting is a **capability, not an agent** — it drafts, the broker sends from their own
inbox. The system never sends. This preserves BD2 from the backend spec.

**Coordination** — Hermes Kanban. A durable board shared across profiles where *"Comment — the
inter-agent protocol. Agents and humans append comments; when a worker is (re-)spawned it reads the
full comment thread as part of its context."* Coordination is peer: any profile reads or writes any
task. Tasks survive restarts, can be blocked and unblocked, and accept human intervention.
`delegate_task` is reserved for short synchronous sub-answers inside a single run.

**Shared context** — an HTTP MCP server in front of the datastore. Memory providers cannot do this
job: all nine are per-profile isolated. The MCP server is configured with an identity header set to
`value_from: profile`, which *"sends the active Hermes profile name… useful when multiple profiles
on one machine talk to the same server and it needs to tell them apart."* That gives per-agent
authorisation over shared data.

**Analytics agents read the replica.** The performance agent is a pillar-four workload.

---

## 8. Sequencing

> **Canonical order lives in `2026-08-12-build-sequence.md`** (added 2026-08-12). Phases here map
> as: A → **S2**, B → **S3**, C → **S4**, D → **S6**, E → **S8**, F → **S9–S16**. Note that the
> canonical sequence adds an **S1** ahead of everything: fixing the four live defects found in
> validation. Where the two disagree, the build sequence wins.

**Phase A — Consolidation.** Merge `ads_agent` into the listings instance as a schema; per-schema
DB users and grants. Closes D2.

**Phase B — Tenancy.** `org_id` everywhere, RLS with `FORCE`, leading-edge indexes, `set_config`
wrapper. This is Epic 0/1 from the tenancy spec, now with RLS as the mechanism. **Release-blocking.**

**Phase C — Enquiry spine.** Phase 1 of the backend spec, on the consolidated tenant-safe base.

**Phase D — ClickHouse + CDC.** Mirror, row policies, `pg_clickhouse`, validate replicated data
against source before anything depends on it.

**Phase E — Context graph.** Node/edge tables, the build job, per-tenant DuckDB export, first
queries in SQL.

**Phase F — Agents.** MCP context server first, then profiles, then kanban wiring.

Phases D and E can run parallel to C, since the mirror is additive and reversible.

---

## 9. Risks and trade-offs

**Recorded trade-off on ClickHouse timing.** My recommendation was to defer ClickHouse until data
volume justified it, on the basis of ClickHouse's own guidance that *"at small data volumes (under
100 GB) with light analytical queries… a single database like PostgreSQL can handle both workloads,"*
and that adoption is *"incremental and reversible… no cutover date needed."* Current volume is
roughly 704 listings. The decision was made to adopt now to avoid a later migration, which is a
legitimate reading of the same source — it also argues *"if you expect to scale, it makes more sense
to start with an architecture that grows with you."* Recorded here so the reasoning is not lost;
not revisited elsewhere.

**~~PuppyGraph is commercial.~~** *Resolved 2026-08-12 — PuppyGraph was dropped (§6.1), so the
licensing and single-node concerns no longer apply.*

**No graph query language.** Traversals are SQL joins, written by hand. Multi-hop queries are more
verbose than Cypher and easier to get wrong. Mitigations: keep traversals behind named functions in
the MCP context server rather than scattered across callers, and revisit once PostgreSQL 19 SQL/PGQ
is GA. Accepted as the price of dropping the engine.

**Two graph representations.** AGE for the listings-search boost, node/edge tables for the context
graph. Less duplication than two engines, but still two mental models. If SQL/PGQ lands well, both
could collapse onto one table model — worth revisiting after PG19 GA.

**DuckDB snapshot fan-out.** One file per tenant means N artifacts to build, store, version, and
garbage-collect. At small tenant counts this is trivial; it needs an operational answer before it
is hundreds. The manifest table is the control plane for that.

**Operational surface versus a solo operator (recorded 2026-08-12).** This design requires running
Postgres, self-hosted ClickHouse, per-tenant DuckDB snapshots, a CDC pipeline, the `pg_clickhouse`
FDW, the Hermes agent fleet, and two Next.js apps — operated by one person with AI assistance, on
GCP, targeting 50–500 tenants within a year. The recommendation on review was ClickHouse Cloud to
remove one system's operational burden, on the same reasoning GitLab used when it required *"low
operational overhead… to minimise the on-call burden for our DBRE and Data Engineering teams"* — a
team GitLab has and this project does not. **Self-hosting was chosen deliberately** for cost and
control. Recorded here so the trade is explicit; not revisited elsewhere. The mitigation is that
ClickHouse must not be on the critical path for the product to function: if it is down, the
product degrades (no analytics, no fresh graph) rather than failing.

**Everything before launch.** The critical path to a usable product is consolidation → tenancy →
enquiry spine. ClickHouse, the graph, and the agents are leverage on top of a product that already
works. The decision was to build the full architecture before launching, which is defensible with
no deadline pressure, but it front-loads risk: none of the leverage is validated by real users
until all of it exists. If motivation or runway becomes the binding constraint, cutting to
Phases A–C is the lever.

**AGE is not planner-integrated.** No cross-model query optimisation; the `label(e)[0]` failure and
graph-fallback path in the current code are symptoms. Keep AGE scoped narrowly.

**Hermes is single-host.** The kanban docs state: *"it's your box, your filesystem, the worker runs
with your uid. This is the trusted-local-user threat model; kanban is single-host by design."*
Profiles do not sandbox. `--tenant` is *"a soft filter; boards are the hard isolation boundary."*
Acceptable while agents are internal; **must be solved before brokers get their own agents.**

**Shared-schema restore.** Single-tenant point-in-time restore is the weakest of the four pillars
under shared-schema. Needs a designed answer before the first enterprise customer asks.

---

## 10. Open questions

1. **CDC transport** — PeerDB/ClickPipes managed, or self-hosted logical replication?
2. ~~**Graph refresh cadence**~~ *Resolved 2026-08-12: on demand, debounced, driven by the manifest
   state machine (§6.3).*
3. **Single-tenant restore** — logical export per tenant, or a dedicated instance for large accounts?
   Note the DuckDB snapshots make per-tenant *export* trivial; restore is still open.
4. ~~**PuppyGraph Enterprise cost**~~ *Resolved 2026-08-12: PuppyGraph dropped (§6.1).*
5. **Corridor vocabulary** — still unresolved from the backend spec; listing areas are free text
   from scrapers (`lib/listings/normalize.ts`). The graph needs a controlled vocabulary for
   `Corridor` nodes to be meaningful.
6. **Embedding home** — pgvector for operational search is settled; do analytical embeddings get
   duplicated into ClickHouse, or does the graph reference Postgres for similarity?
7. **"Material change" definition** — what exactly marks a tenant's graph stale and triggers an
   on-demand rebuild, and what debounce window avoids thrashing on bulk imports?
8. **SQL/PGQ adoption** — re-evaluate once PostgreSQL 19 is GA. If it performs, it could replace
   both AGE and hand-written traversal SQL with one standard syntax over the same tables.
9. **Where snapshot files live** — local disk on a stateful service, or object storage read via
   DuckDB's `httpfs` extension? Object storage removes per-instance file management on GCP, at the
   cost of network latency per query, and makes bucket IAM a tenant-isolation boundary. Decide
   before Phase E, since it shapes the build job's output target.

---

## 11. Data protection (added 2026-08-12)

Hosting is GCP; the operator is an Indian entity; tenants are Indian brokers with some international
clients expected. Both India's DPDP Act and GDPR are in scope. Full findings and sources are in
`2026-08-12-architecture-validation-report.md` §7.1. What follows is only what changes this design.

### 11.1 Erasure is suppression first, hard delete later

**This inverts the assumption the rest of these specs were built on.**
[Rule 8(3) of the DPDP Rules 2025](https://www.dpdpa.com/dpdparules/rule8.html) requires personal
data, associated traffic data and processing logs to be retained **for at least one year**,
expressly including data a processor holds on a fiduciary's behalf, and its own illustration
confirms this applies *"even if X deletes her account."*

So an erasure request must:

1. **Suppress immediately** — tombstone the subject, block all access paths, remove from search,
   graph projections and any agent context pack. From the user's perspective the data is gone.
2. **Retain physically** for the statutory floor, access-blocked.
3. **Hard-erase on a schedule** once the floor passes.

Building delete-on-request would be non-compliant in the opposite direction from the usual mistake.
A **deletion ledger** — request, per-store propagation status, completion timestamps — is what
evidences the 90-day response obligation; cascading foreign-key deletes prove nothing.

*How Rule 8(3) reconciles with the §12 erasure right is unsettled in the sources. Confirm with a
lawyer before launch.*

### 11.2 Consequences for each store

- **PostgreSQL** — tombstone plus access block. Rule 6(1)(a) names encryption, masking and
  tokenisation explicitly, so **RLS alone is not a sufficient safeguard**; personal columns need
  encryption or tokenisation as well.
- **ClickHouse** — hold pseudonymous IDs and metrics rather than enquirer PII wherever possible.
  Where PII must land there, encrypt per data subject so a key destruction (crypto-shredding)
  satisfies erasure without fighting ClickHouse's weak delete story.
- **DuckDB snapshots** — the largest exposure in the whole design: immutable per-tenant files that
  outlive deletion by construction. Either give every snapshot a **hard TTL** and regenerate from
  Postgres, or encrypt per subject and destroy keys. Snapshot GC becomes a compliance control, not
  just housekeeping.
- **Context graph** — treat as personal data.
  [EDPB Opinion 28/2024](https://www.edpb.europa.eu/system/files/2024-12/edpb_opinion_202428_ai-models_en.pdf)
  holds that artefacts derived from personal data are not automatically anonymous. Every node and
  edge derived from an enquirer carries **subject provenance** so it can be pruned on erasure.
- **Access logs** — retained one year, and queryable by tenant, because breach notification has no
  de-minimis threshold: every affected principal without delay and a Board report within 72 hours.

### 11.3 Roles, and the trap in cross-tenant analytics

For tenant enquiry data you are a **Data Processor** — brokers determine the purpose. But using
enquirer data for your own product improvement makes you a **controller** for that processing, and
that is exactly what the cross-tenant analytics service in §5.1 does. It therefore needs its own
lawful basis and tenant authorisation, not merely an audit log. Aggregates-only is the design that
keeps this defensible.

The **LLM provider is a sub-processor**: list it, obtain tenant authorisation, and configure
no-training and zero-retention. India has no EU adequacy decision, so EU-origin data needs SCCs and
a transfer impact assessment. A DPIA is likely required — AI processing combined with data matching
and data not collected from the subject directly.

No general localisation mandate applies to non-SDFs, so GCP region choice stays open.

---

## 12. Operations (added 2026-08-12)

Closing the items the validation report recorded but no spec designed. Scoped to a solo operator:
each is the smallest thing that prevents a specific failure, not a full platform.

### 12.1 Freshness, and refusing to act on stale data

Agents read a graph projected from a CDC-fed mirror. If CDC stalls they will propose confidently on
stale data — a budget-pause justified by three-day-old spend looks identical to a correct one.
Nothing currently surfaces lag to the agent, the proposal, or the approving human.

- Every snapshot records `source_watermark` — the newest CDC commit timestamp it contains.
- `graph_manifests` records `cdc_lag_seconds` observed at build time.
- **Every context pack the MCP server returns carries `built_at` and current lag.** An agent cannot
  obtain data without also obtaining its age.
- Proposals store the lag at creation, and the approval screen renders it.
- **Hard rule:** agents refuse to propose anything that changes spend when lag exceeds a threshold
  (default 15 minutes). Refusing is correct behaviour, not an error.

### 12.2 Rebuild backpressure and snapshot collection

On-demand rebuilds have no ceiling as specified: a bulk listings sync marks every tenant stale at
once and stampedes.

- **Concurrency ceiling** on simultaneous rebuilds (default 2), enforced by claiming rows in
  `graph_manifests` with `FOR UPDATE SKIP LOCKED`.
- **Debounce window** (default 5 minutes) between a tenant being marked stale and a build starting,
  so a bulk import coalesces into one rebuild per tenant.
- **Priority by recent activity** — tenants with a user active today build first.
- **Generation-based collection.** Keep the current and previous snapshot per tenant. A serving
  process takes a **lease** (tenant, snapshot, expiry) before opening a file; collection removes
  only snapshots older than the previous generation with no live lease. This replaces "collected
  once no reader holds them", which never said how that is known.

### 12.3 Snapshot storage is a tenancy boundary

Each file holds one tenant's complete dataset, so wherever they live, that storage becomes a
tenant-isolation boundary alongside RLS.

- One GCS bucket, **one object prefix per tenant**.
- The serving service account holds `objectViewer` **scoped to the prefix**, never bucket-wide.
  A single shared read credential would make the file boundary decorative.
- Server-side encryption with **CMEK per tenant**, so destroying a key erases every snapshot for
  that tenant at once — which is what makes §11.2's crypto-shredding practical.

### 12.4 Observability

Four signals, one alert each, one channel. Anything more is unmaintainable by one person.

| Signal | Alert when | Why |
|---|---|---|
| CDC lag | above the §12.1 threshold | agents silently degrade to guessing |
| Rebuild queue depth and failures | depth grows across two checks, or any tenant is `error` | stale graphs, silently |
| Agent cost per tenant per day | above ceiling, or 3× the tenant's trailing median | denial of wallet, and runaway loops |
| Cross-tenant audit rows | any row not attributable to a scheduled job | the isolation boundary being crossed |

One trace id propagates request → agent task → MCP call → SQL, so a bad proposal can be traced back
to the data that produced it.

### 12.5 Backup and restore

The asymmetry that makes this cheap: **only Postgres holds anything irreplaceable.**

- **Postgres** — point-in-time recovery, and a restore drill actually performed, not just enabled.
- **ClickHouse** — derived. Rebuildable from Postgres by replay; back up configuration and schema,
  not data.
- **Snapshots** — derived, rebuildable, disposable.
- **Per-tenant export** — a tenant's snapshot already *is* their export, which turns a compliance
  obligation into a file copy.
- **Twenty** — outside our backup boundary; it is the system of record for person and opportunity,
  so its own retention applies.

### 12.6 Rate limiting

Two unauthenticated surfaces both call an LLM per request: the public enquiry form and `/api/spaces/search`.
Each is a cost-attack vector where an attacker spends nothing and we spend per call.

- Per-IP and per-org request limits on both.
- Length caps on enquiry text and search queries before any model call.
- A **hard per-tenant cost ceiling that halts inference** rather than warning — the control that
  actually bounds loss.
- Bot mitigation on the public form.
- Pre-flight token estimation, so an oversized input is rejected before it is paid for.
