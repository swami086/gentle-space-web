# Build sequence

Date: 2026-08-12
Status: canonical

Three specs previously used three numbering schemes — Phases 0–7, Phases A–F, and Stages 1–5 — while
cross-referencing each other, so no reader could tell what to build first. **This document is the
single build order.**

> **Numbering honesty** (corrected 2026-08-12, gap review G-4). This document previously claimed
> "every spec now refers to these `S` numbers." That was not true: the backend spec still leads with
> Phase 0–7, and the tenancy and UX specs still say Epic 0/1. What actually exists is a translation
> table (bottom of this page) mapping the old schemes onto these steps. Use the table; do not assume a
> `Phase 3` you read elsewhere means anything without translating it.

## The sequence

Lettered steps were inserted after the original numbering was published (gap review G-2). They are
suffixed rather than renumbered so existing `S`-number references in other specs stay valid.

| Step | Delivers | Detail in | Gate to pass |
|---|---|---|---|
| **S1** | Fix the four live defects | validation report §9 Tier 1 | cross-tenant test suite green |
| **S2** | Database consolidation, PG18 | datastore §4, data model §10 | both apps run on the merged instance |
| **S3** | Tenancy — scope, RLS, authz | tenancy spec, data model §1 | **release gate**, see below |
| **S4** | Enquiry spine **+ Twenty ownership boundary** — `adsagent.contacts`, `context.twenty_connections`, per-tenant provisioning | backend spec A, B1, B4, C1, C2, C7; Twenty tenancy spec | broker can work an enquiry end to end, **and an enquiry survives Twenty being down** |
| **S5** | Close the enquiry loop | backend spec C3–C6, A5, A6, G1 | reminders and extraction working |
| **S5a** | **Event backbone** — transactional outbox, Pub/Sub, relay | datastore §14 | an event cannot exist without its row, or its row without the event |
| **S6** | ClickHouse mirror and CDC | datastore §3, §12.1 | replicated data matches source |
| **S6a** | **Portal ingestion and consent** — edge endpoint, GCS export, S3Queue, `derived` schema | portal spec, data model §0 | an event from a broker's site reaches ClickHouse, **and a withdrawn consent stops it within seconds** |
| **S7** | Attribution | backend spec D1–D6 | per-corridor cost is real, not invented |
| **S8** | Context graph | datastore §6, §12.2 | first traversal query answers correctly |
| **S8a** | **Artifact store** — Garage, `context.artifacts`, orphan and dangling sweeps | datastore §13.1, data model §8a | an artifact survives a write, a read, and an erasure that leaves no bytes behind |
| **S9** | MCP context server (no agents) | agent spec §5, §6 | the four safety tests in agent spec §9 |
| **S9a** | **Agent tracing** — Langfuse on the existing ClickHouse | datastore §13.2, agent spec §8 | a span carries structure and references, and **no message bodies** |
| **S10** | First agent — `leads` | agent spec §4 | a proposal reaches the queue with evidence |
| **S11** | Decision engine extensions | backend spec E1–E7 | pre-flight checks and diffs render |
| **S12** | Kanban and `orchestrator` | agent spec §7 | two agents complete one linked task chain |
| **S13** | Generative surfaces | backend spec F1–F5 | answers cite only the context pack |
| **S14** | `performance` and `campaign` agents | agent spec §4 | reads the replica, not the primary |
| **S15** | Inbound expansion — email, WhatsApp | backend spec B2, B3 | inbound threads to the right enquiry |
| **S16** | `research` and `content` agents | agent spec §4 | — |
| **S17** | CMS | backend spec H1–H7 | — |

**S9a is not optional and not "observability later."** The agent spec makes the two token metrics the
same signal that enforces the per-tenant cost ceiling, so shipping S10 without S9a ships an autonomous
agent with no spend limit.

## Dataflow review actions

The five actions from `2026-08-12-dataflow-review.md` attach to steps rather than forming one:

| Action | Lands at |
|---|---|
| A-1 Postgres/Twenty field boundary written down | **Closed 2026-08-12** — Twenty tenancy spec §3; lands at S4 |
| A-2 first-party searches routed through the portal pipeline; retire `search_queries` | S6a |
| A-3 traces reference content where it lives | S9a |
| A-4 `evidence` holds identifiers only | S10 |
| A-5 `derived` schema quarantine | S6a |

## The three gates that matter

**S1 protects data that exists today.** The role vocabulary cannot store two of three roles, seven
mutation routes are unguarded including the one that spends money, and no approval records who
approved it. None of this is caught by testing the happy path.

**S3 is release-blocking.** Nothing customer-facing ships before it. Its acceptance test is the
cross-tenant suite run **against a pooled connection**, proving a second request on a reused
connection cannot see the first request's tenant.

S3 carries a second condition, added 2026-08-12: **Twenty is one shared pipeline today** (tenancy
spec, Q4 resolution). Its client must refuse non-platform callers — throwing, not returning empty —
and the CRM surfaces plus the Twenty MCP tools must be platform-only before any external login
exists. Nine call sites reach that data, including the home dashboard and the autonomous decision
cycle, so this cannot be done by hiding a route.

This guard is **interim**. The end state is one Twenty instance per org
(`2026-08-12-twenty-tenancy-ownership-design.md`), landing at S4; the guard is removed only once every
org has its own. Twenty's deduplication merges contacts across tenants in a shared instance, so the
existing data is contaminated irreversibly and is never migrated.

## Abort criteria (added 2026-08-12, gap review G-3)

Every gate above says how to pass. These two steps are the least reversible in the programme, so they
also need a stated way to stop — decided now, in daylight, rather than at 2am mid-migration.

**S2 — database consolidation.** Abort and restore from the pre-migration base backup if any of:
data checksums disagree between source and merged instance; either app cannot run for more than
30 minutes on the merged instance; or a PG18 behavioural difference surfaces that was not caught in
staging. The old instances stay running and untouched until S3 has passed on the new one — do not
decommission at the end of S2, which is the tempting mistake.

**S3 — RLS.** Abort if the cross-tenant suite fails against a **pooled** connection after the policy
work, rather than loosening a policy to make it pass. RLS half-applied is worse than not applied,
because the surfaces above it start assuming a guarantee the database is not making. Revert the
policies, keep the `org_id` columns and the scope parameters — those are additive and safe to leave —
and re-enter S3 with the pooling model fixed first.

**Both steps are gated on a restore having been rehearsed, not merely a backup having been taken.**
An untested backup is a hope, and §12.5 of the datastore spec is where that rehearsal is defined.

**S9 proves the agent safety model before any agent exists.** Tenant isolation, evidence
enforcement, read-only query templates, and proposal round-trip — all testable by calling the server
directly. Worth having certainty here before multiplying by six agents.

## What can run in parallel

S6 and S8 are additive and reversible, so they can overlap S4 and S5. Everything else is a chain:
S1 → S2 → S3 gates all product work, and S9 gates all agent work.

Of the inserted steps, **S8a is the one that can start early** — the artifact store is standalone
infrastructure with no dependency on the graph or the agents, so it can be built any time after S2.
**S5a must precede S6a** (portal ingestion publishes through the outbox) and **S9a must precede S10**
(no untraced agent). S6a additionally depends on S6 for the ClickHouse cluster it ingests into.

## Cross-cutting, not phases

These attach to the step that first needs them rather than having a slot of their own: freshness and
staleness signalling (datastore §12.1, first needed at S9), rebuild backpressure and snapshot
collection (§12.2, at S8), snapshot storage IAM (§12.3, at S8), observability (§12.4, from S6),
backup and restore (§12.5, from S2), and rate limiting (§12.6, before the public surfaces carry real
traffic).

Data-protection obligations (datastore §11) are not a step either. Suppression-based erasure has to
be designed into the enquiry spine at **S4**, because retrofitting deletion semantics after data
exists is materially harder than building them in.

## Scope lever

The critical path to a **usable product** is S1 → S2 → S3 → S4. Everything from S6 onward is
leverage on top of something that already works. The decision on record is to build the full
architecture before launching; if runway or motivation becomes the binding constraint, stopping
after S5 yields a product a broker can use every day.

## Superseded numbering

| Old | New |
|---|---|
| backend Phase 0 / tenancy Epic 0/1 | S3 |
| backend Phase 1 · datastore Phase C | S4 |
| backend Phase 2 | S5 |
| backend Phase 3 | S7 |
| backend Phase 4 | S11 |
| backend Phase 5 | S13 |
| backend Phase 6 | S15 |
| backend Phase 7 | S17 |
| datastore Phase A | S2 |
| datastore Phase B | S3 |
| datastore Phase D | S6 |
| datastore Phase E | S8 |
| datastore Phase F | S9–S16 |
| agent Stage 1 | S9 |
| agent Stage 2 | S10 |
| agent Stage 3 | S12 |
| agent Stage 4 | S14 |
| agent Stage 5 | S16 |
