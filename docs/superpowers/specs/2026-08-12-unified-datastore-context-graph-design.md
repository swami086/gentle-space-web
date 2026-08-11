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
| Context graph | PuppyGraph over ClickHouse | Cypher/Gremlin traversal, zero-copy |

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

- **UD6 — PuppyGraph provides the context graph** over ClickHouse via Cypher/Gremlin, zero-copy.

- **UD7 — The graph is a curated projection**, rebuilt on a schedule, not a live mirror of every
  operational row. Matches the existing `lib/graph/rebuild.ts` approach.

- **UD8 — The graph models the full domain**: spaces, corridors, enquiries, people, requirements,
  campaigns, calls, and outcomes.

- **UD9 — Apache AGE is retained**, scoped to the existing listings-search boost in
  `/api/spaces/search`. It is in the hot path and transactional; removing it is out of scope.
  Two graph engines is a real cost, accepted knowingly (§9).

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
                    └──────────┬──────────────────┘
                               │ CDC (PeerDB / ClickPipes)
                               ▼
                    ┌─────────────────────────────┐
                    │  ClickHouse                 │
                    │  facts, events, rollups     │
                    │  node + edge tables         │
                    │  row policies per tenant    │
                    └──────────┬──────────────────┘
                               │ JDBC, zero-copy
                               ▼
                    ┌─────────────────────────────┐
                    │  PuppyGraph                 │
                    │  Cypher / Gremlin           │
                    └─────────────────────────────┘

   Hermes agents ──▶ MCP context server ──▶ all three, tenant-scoped
```

`pg_clickhouse` (FDW) is installed so application code can reach analytical tables through a single
Postgres connection. It pushes down aggregates, `GROUP BY`, `ORDER BY`, `HAVING`, `WHERE` including
LIKE/regex, date functions, `CASE WHEN`, and JOINs between foreign tables.

**Rule:** cross-system joins execute with only the ClickHouse portion pushed down and the join
performed in Postgres. Keep analytical tables together in ClickHouse and join them there.

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

### How it is built

A curated projection (UD7). Operational rows land in ClickHouse via CDC; a scheduled job derives
node and edge tables from them; PuppyGraph declares a graph schema over those tables and serves
Cypher without copying anything.

Every node and edge table carries `org_id` and is covered by a ClickHouse row policy.

### Honest performance note

PuppyGraph has no native graph storage, so there is no index-free adjacency. ClickHouse's
[benchmark](https://clickhouse.com/blog/zero-copy-graph-analytics) across 97 queries on 35.4M
records reports **28 ms median, 148 ms P95**, and states plainly: *"we will experience a higher
query latency for the trade-off we have made."* Interactive, but not what a native graph engine
delivers.

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

**Phase A — Consolidation.** Merge `ads_agent` into the listings instance as a schema; per-schema
DB users and grants. Closes D2.

**Phase B — Tenancy.** `org_id` everywhere, RLS with `FORCE`, leading-edge indexes, `set_config`
wrapper. This is Epic 0/1 from the tenancy spec, now with RLS as the mechanism. **Release-blocking.**

**Phase C — Enquiry spine.** Phase 1 of the backend spec, on the consolidated tenant-safe base.

**Phase D — ClickHouse + CDC.** Mirror, row policies, `pg_clickhouse`, validate replicated data
against source before anything depends on it.

**Phase E — Context graph.** Node/edge projections, PuppyGraph schema, first queries.

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

**PuppyGraph is commercial.** The Developer Edition is forever-free but **single-node, limited to
two data sources, community support**, and positioned for proof-of-concept. Production requires the
Enterprise Edition, priced on server memory and CPU. Budget for it, and confirm licensing terms
before the graph becomes load-bearing for a paying product.

**Two graph engines.** AGE for listings search, PuppyGraph for the context graph. Justified because
AGE is in the transactional hot path and PuppyGraph is analytical, but it is duplicated concept
surface. Revisit once the context graph is proven.

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
2. **Graph refresh cadence** — hourly, nightly, or event-triggered?
3. **Single-tenant restore** — logical export per tenant, or a dedicated instance for large accounts?
4. **PuppyGraph Enterprise cost** at target scale — needs a quote before Phase E commits.
5. **Corridor vocabulary** — still unresolved from the backend spec; listing areas are free text
   from scrapers (`lib/listings/normalize.ts`). The graph needs a controlled vocabulary for
   `Corridor` nodes to be meaningful.
6. **Embedding home** — pgvector for operational search is settled; do analytical embeddings get
   duplicated into ClickHouse, or does the graph reference Postgres for similarity?
