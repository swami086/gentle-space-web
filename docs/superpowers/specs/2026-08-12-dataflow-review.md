# Dataflow architecture review

Date: 2026-08-12
Reviews the storage topology across all eight stores for correct ownership, flow direction, and duplication.
Triggered by an inaccurate claim of mine — see §1.

## 1. The rule, corrected

I previously said *"everything writes to Postgres first."* **That is wrong.** Three flows bypass
Postgres entirely, and correctly so: portal clickstream, agent traces, and agent-generated artifacts.
Forcing high-volume observational data through a transactional store would be a mistake, not a virtue.

The accurate rule has two halves:

> **Business facts write to Postgres first, always.** Anything the business would be harmed by losing,
> anything a human decision depends on, anything with a legal obligation attached.
>
> **Observational data writes to its own store directly, and never becomes a business fact.** It may
> be aggregated, projected, and read — but it cannot cross into the transactional world without
> passing through Postgres as a deliberate, reviewed write.

The pattern this follows is the standard one for polyglot persistence: keep the relational store as
the single source of truth and give every other store a **read-optimised replica of only what it
needs**. Where a store is the source of truth for its own data (traces, artifacts), that must be
stated rather than assumed.

## 2. Ownership map

Who is the source of truth for what. Nothing outside this table may claim ownership.

| Data | Source of truth | Justification |
|---|---|---|
| Enquiries, activity, requirements, reminders | **Postgres** `adsagent` | transactional, human decisions depend on it |
| Proposals and decisions | **Postgres** `adsagent` | money and audit |
| Users, orgs, credits | **Postgres** `public` / auth service | transactional |
| Consent records | **Postgres** `context` | legal evidence, must be immediately consistent |
| Outbox events | **Postgres** `context` | must commit with the fact it describes |
| Listings, sync state | **Postgres** `listings` | transactional, edited |
| Corridor vocabulary | **Postgres** `public` | reference data |
| Person identity and opportunity | **Twenty CRM**, one instance per org | dedup decides who is who; boundary in the Twenty tenancy spec §3 |
| Portal clickstream | **ClickHouse** raw | never exists in Postgres, by design |
| Agent traces | **Langfuse** on ClickHouse | never exists in Postgres |
| Agent-generated artifacts and call audio | **Garage** (self-hosted S3), indexed by `context.artifacts` | content with no other home |

Everything else in the system is **derived** and must be rebuildable from the above:

| Derived thing | Rebuilt from | Store |
|---|---|---|
| Analytical fact tables | Postgres, via CDC | ClickHouse |
| Graph node and edge tables | Postgres + ClickHouse facts | ClickHouse |
| Per-tenant graph snapshots | graph tables | DuckDB files |
| Clickstream rollups | ClickHouse raw | ClickHouse |
| Raw event files | Pub/Sub | GCS, deleted after ingest |

## 3. Duplication audit

Seven places the same information exists in more than one store. Four are fine, three are not.

### Acceptable — one source of truth, the rest derived

**Enquiry facts in four places** — Postgres (SoT), Twenty (external SoT for person identity),
ClickHouse mirror, DuckDB snapshot. One SoT, one bounded external SoT, two derived replicas.
**A-1 resolved 2026-08-12**: the field boundary is now written down in the Twenty tenancy spec §3 —
Twenty owns who, Postgres owns what happened, and identity conflicts resolve in Twenty's favour
because its deduplication is the authority. The local contact cache is rebuildable and therefore
derived, but it holds personal data and is not exempt from retention rules.

**Corridor vocabulary** in Postgres and as graph `Corridor` nodes. Derived, rebuildable.

**Listing attributes** in `listings.amenities`/`images` JSONB and as graph `Space` node properties.
Derived, rebuildable.

**Consent state** in `context.consent_records` and cached at the ingestion gate. A cache, not a copy —
already has an invalidation rule requiring withdrawal to take effect in seconds.

### Not acceptable

**A-2 — `search_queries` versus `search_performed`.** The marketing site logs searches into a Postgres
`search_queries` table with no tenant, session, or user. Broker portals will emit `search_performed`
events into the ClickHouse raw zone. Same concept, two stores, two pipelines, neither aware of the
other, and no way to answer "how many searches happened" without knowing both exist.

The portal spec called this "deliberately out of scope", which was me deferring rather than deciding.
**Decide it:** the Gentle Space site is itself a portal. Its searches should flow through the same
ingestion path, and `search_queries` should retire once they do. Until then, the table needs a comment
saying it covers only the first-party site, so nobody compares the two numbers.

**A-3 — enquiry message text could be copied into the artifact store.** The datastore spec's trace
table lists message bodies as "by reference only", and the surrounding text said the span carries an
*artifact* reference. Read literally, that copies enquirer PII into a second store with a different
erasure path and a different retention clock.

**That is a defect, not a design.** The rule must be: a trace references content **where it already
lives**. If content is in Postgres, the span carries the Postgres row id. The artifact store holds
only content that has no other home — generated drafts, talking points, context packs assembled at run
time, call audio. Never a copy of something already stored.

**A-4 — agent reasoning across three stores.** `proposals.evidence` (Postgres), artifacts, and trace
payloads could each hold overlapping pieces of an agent's reasoning. The rule that separates them:
**`evidence` holds identifiers only, never prose.** The artifact store holds generated content. Traces
hold structure and references. With that, there is no overlap.

## 4. Flow direction

Checked for backward flows — anything writing from a derived store into a source of truth.

**One found, and it is the most dangerous thing in this review.**

Clickstream is observational data owned by ClickHouse. But the design also says scheduled transforms
"populate Postgres tables the product reads". That is a derived store feeding the source of truth, and
it means Postgres would hold rows that did not originate there and cannot be reproduced by replaying
its own history.

It is not wrong to want it — showing a broker "this visitor viewed these three spaces before
enquiring" is genuinely useful. But it needs a boundary, or observational data quietly acquires the
authority of fact:

**A-5 — Postgres tables fed from clickstream live in a separate `derived` schema**, are truncatable
and rebuildable at any time, are never the input to another derivation, and are never used to justify
a proposal without the underlying enquiry also supporting it. A table in `derived` is a convenience,
not a record.

The other inbound flow, Twenty → Postgres, is legitimate but **its direction was corrected on
2026-08-12**. It is no longer an enquiry sync: enquiries originate in Postgres and project outward.
What flows back is only resolved identity — the person id and canonical contact fields that Twenty's
deduplication decided. Twenty remains a declared co-source of truth with a bounded scope, not a
derived store, but it is downstream for everything except who a person is.

## 5. Actions

| # | Action | Where |
|---|---|---|
| A-1 | ~~Write down the Postgres/Twenty field boundary~~ **Done** — Twenty tenancy spec §3 | closed 2026-08-12 |
| A-2 | Route first-party site searches through the portal pipeline; retire `search_queries`. Until then, comment the table's limited scope | portal spec §6 |
| A-3 | Traces reference content where it lives; the artifact store holds only content with no other home | datastore §13.1, §13.3 |
| A-4 | `proposals.evidence` holds identifiers only, never prose | agent spec §5 |
| A-5 | Clickstream-derived Postgres tables live in a `derived` schema, rebuildable, never an input to further derivation | data model §0 |

A-3 and A-5 are the two that would cause real harm if left: one duplicates personal data into a store
with a different erasure path, the other lets observational data acquire the authority of record.

## 6. What this review did not find

No store lacks an owner. No derived data is unrebuildable. Nothing writes to two sources of truth for
the same field. The outbox correctly commits with the fact it describes, so no event can exist without
its data or vice versa. Erasure has a defined path in every store that holds personal data.

The topology is sound. The problems are all at the boundaries, which is where they usually are.
