# Build sequence

Date: 2026-08-12
Status: canonical

Three specs previously used three numbering schemes — Phases 0–7, Phases A–F, and Stages 1–5 — while
cross-referencing each other, so no reader could tell what to build first. **This document is the
single build order.** Every spec now refers to these `S` numbers.

## The sequence

| Step | Delivers | Detail in | Gate to pass |
|---|---|---|---|
| **S1** | Fix the four live defects | validation report §9 Tier 1 | cross-tenant test suite green |
| **S2** | Database consolidation, PG18 | datastore §4, data model §10 | both apps run on the merged instance |
| **S3** | Tenancy — scope, RLS, authz | tenancy spec, data model §1 | **release gate**, see below |
| **S4** | Enquiry spine | backend spec A, B1, B4, C1, C2, C7 | broker can work an enquiry end to end |
| **S5** | Close the enquiry loop | backend spec C3–C6, A5, A6, G1 | reminders and extraction working |
| **S6** | ClickHouse mirror and CDC | datastore §3, §12.1 | replicated data matches source |
| **S7** | Attribution | backend spec D1–D6 | per-corridor cost is real, not invented |
| **S8** | Context graph | datastore §6, §12.2 | first traversal query answers correctly |
| **S9** | MCP context server (no agents) | agent spec §5, §6 | the four safety tests in agent spec §9 |
| **S10** | First agent — `leads` | agent spec §4 | a proposal reaches the queue with evidence |
| **S11** | Decision engine extensions | backend spec E1–E7 | pre-flight checks and diffs render |
| **S12** | Kanban and `orchestrator` | agent spec §7 | two agents complete one linked task chain |
| **S13** | Generative surfaces | backend spec F1–F5 | answers cite only the context pack |
| **S14** | `performance` and `campaign` agents | agent spec §4 | reads the replica, not the primary |
| **S15** | Inbound expansion — email, WhatsApp | backend spec B2, B3 | inbound threads to the right enquiry |
| **S16** | `research` and `content` agents | agent spec §4 | — |
| **S17** | CMS | backend spec H1–H7 | — |

## The three gates that matter

**S1 protects data that exists today.** The role vocabulary cannot store two of three roles, seven
mutation routes are unguarded including the one that spends money, and no approval records who
approved it. None of this is caught by testing the happy path.

**S3 is release-blocking.** Nothing customer-facing ships before it. Its acceptance test is the
cross-tenant suite run **against a pooled connection**, proving a second request on a reused
connection cannot see the first request's tenant.

**S9 proves the agent safety model before any agent exists.** Tenant isolation, evidence
enforcement, read-only query templates, and proposal round-trip — all testable by calling the server
directly. Worth having certainty here before multiplying by six agents.

## What can run in parallel

S6 and S8 are additive and reversible, so they can overlap S4 and S5. Everything else is a chain:
S1 → S2 → S3 gates all product work, and S9 gates all agent work.

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
