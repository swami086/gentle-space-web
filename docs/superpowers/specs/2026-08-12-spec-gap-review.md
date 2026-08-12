# Spec gap review

Date: 2026-08-12
Adversarial review of the ten specs and plans against each other and against the codebase.
Verdict: **BLOCK** — two critical findings, one of which is a live cross-tenant data exposure whose
answer has been known since the design conversation and was never propagated.

## Critical

### G-1 — Q4 is answered, its consequence is unimplemented, and the stated mitigation is too narrow

The tenancy spec records Q4 — *"Is Twenty CRM data per-org, or one shared pipeline?"* — as a **hard
blocker**, with the consequence: *"If shared, `/leads` must be hidden from external orgs until Twenty
is partitioned."*

**Q4 was answered during design: shared.** Neither the spec nor the plan records this. Two failures
follow.

First, the S1–S3 plan still excludes the `twenty-pipeline` module as *"Blocked on the tenancy spec's
open question Q4"* — work deferred on a question that has an answer.

Second, and worse, **the stated mitigation covers one route out of nine call sites.** Indexing the
codebase shows Twenty data reaching:

| Consumer | Why hiding `/leads` does not cover it |
|---|---|
| `ads-agent/app/(admin)/crm/page.tsx` | the CRM board itself |
| `ads-agent/app/(admin)/page.tsx` | **the home dashboard** — `getPipelineValue`, `fetchLeadSignal` |
| `ads-agent/app/api/crm/opportunities/[id]/stage/route.ts` | a **mutation** on another tenant's opportunity |
| `ads-agent/lib/decision-engine/cycle.ts` | the **autonomous** cycle reads `fetchLeadSignal` |
| `ads-agent/lib/openui/crm-tools.ts` | generative surface renders opportunity cards |
| `ads-agent/lib/openui/opportunity-openui-lang.ts` | same |
| `ads-agent/lib/openui/resolve-tools-then-generate.ts` | reshapes Twenty tool results into UI |
| `ads-agent/lib/bifrost/mcp-client.ts` | Twenty MCP endpoint |
| `app/api/leads/route.ts` | `createLeadInTwenty` writes into the shared pipeline |

Hiding one route leaves the dashboard, a mutation endpoint, the decision engine, and three generative
modules serving one tenant's pipeline to another. The decision-engine path is the most serious,
because it acts without anyone looking at a screen.

**Required:** containment is a property of the Twenty *client*, not of any route. Every function in
`twenty-pipeline.ts` must refuse to return data to a non-platform caller until Twenty is partitioned,
so a new call site inherits the block instead of having to remember it.

### G-2 — The build sequence is stale while asserting it is canonical

`2026-08-12-build-sequence.md` calls itself *"the single build order"*. It contains **zero** mentions
of: the portal ingestion pipeline, Pub/Sub, the transactional outbox, GCS, ClickHouse S3Queue, the
artifact store, Garage, Langfuse, consent, or the `derived` schema.

Every one of those was specified after the build sequence was written, and the portal spec defines no
build steps of its own, so an entire ingestion subsystem and the whole compliance surface exist in
design with no place in any build order.

A stale document labelled canonical is worse than no document: someone following it builds the product
and silently skips the event backbone, the artifact store, agent tracing, and consent capture.

## Warnings

### G-3 — No abort criteria for the two irreversible steps

Searching the plan, the build sequence, and the datastore spec for rollback, abort, revert, or backing
out returns **nothing**. S2 (database consolidation onto PG18) and S3 (RLS) are the least reversible
steps in the programme, and each has an entry gate but no exit condition for failure. A gate that only
says how to pass tells you nothing at 2am when it fails.

### G-4 — The numbering unification was claimed, not done

The build sequence states *"Every spec now refers to these `S` numbers."* It does not. The backend
spec still leads with Phase 0–7 and bolts a translation note on top; the tenancy spec is still titled
"Epic 0 & 1"; the UX spec references Epic 0/1 in seven places. The original complaint — three
numbering schemes cross-referencing each other so no reader can tell what to build first — is
unchanged, now with a translation table layered over it.

### G-5 — Roughly twenty-five open questions across five specs, with no register, owner, or deadline

Open questions live in the data model (5), the portal spec (5), the backend spec (5), the tenancy spec
(Q1–Q6), and the UX spec (Q1–Q5). Nothing lists them together. **G-1 is what this costs**: a question
was answered in conversation and never made it back into the spec that declared it blocking, and
nobody could see the gap because no view of it exists.

### G-6 — The same question is open twice, in two specs

Corridor vocabulary is asked independently as data model Q2 and backend Q3. Two owners will answer it
twice, differently, and both answers will be authoritative in their own document.

### G-7 — An unresolved question now has a new dependent

Data model Q3 — does the retention floor run from the deletion request or from last activity — was
already load-bearing. It now also governs `erase_after` on every artifact, including call recordings,
which will be the largest personal-data objects in the system.

## Notes

- **G-8** — Portal Q2 doubts whether `page_view` has a defensible lawful basis at all, yet the
  ingestion pipeline is designed to carry it. Building transport for data that may not be collectable
  is cheap to avoid now and awkward to unwind later.
- **G-9** — Data model Q1 (pgcrypto versus KMS envelope encryption) blocks §6.3 and shapes whether key
  destruction can serve as the erasure primitive, which affects the erasure design in three specs.

## What is sound

Ownership is defined for every store, derived data is rebuildable, the outbox commits with the fact it
describes, and the agent safety model is testable before any agent exists. The architecture is not the
problem. **Every finding here is a failure to propagate a decision**, not a failure to make one — which
is why the fix is a single register and a build sequence that is actually maintained.
