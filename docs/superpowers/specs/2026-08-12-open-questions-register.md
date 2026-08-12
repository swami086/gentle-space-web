# Open questions register

Date: 2026-08-12
Status: **the single list.** Individual specs may restate a question for context, but this file
decides whether it is open, and this file is updated first.

Created because a question was answered in conversation and never propagated: the tenancy spec's Q4
sat marked "hard blocker" for a day after it had an answer, and the mitigation it recorded turned out
to cover one of nine call sites (gap review G-1). No view of all questions existed, so nobody could
see the gap.

## Rules

1. A question is **closed here first**, then in its home spec. Closing it only in conversation is what
   caused G-1.
2. Every question names the step it blocks. A question blocking nothing is a note, not a question.
3. **Duplicates are merged, not tracked twice.** Two specs asking the same thing produce two answers,
   both authoritative in their own document.

## Blocking

| # | Question | Blocks | Home | Default if unanswered |
|---|---|---|---|---|
| B2 | Retention floor start date — does `erase_after` run from the deletion request or from last activity | **S4**, and now every artifact incl. call audio | data model Q3 | from last activity — the more conservative read, and the one that survives an audit |
| B3 | Corridor vocabulary — who defines the canonical list, and how are scraped free-text areas mapped | **S7** (attribution is per-corridor) | data model Q2 **+** backend Q3 — *merged, was asked twice* | none; D1 does not work without it |
| B4 | Encryption mechanism — `pgcrypto` versus KMS envelope encryption | S3 (§6.3), shapes erasure in three specs | data model Q1 | pgcrypto; revisit only if key-destruction-as-erasure is wanted |
| B6 | **Which plan owns `evidence` and `proposed_by` on `adsagent.proposals`** | S9, and S1–S3's reserved range | data model §2 | **S9 owns them** and S1–S3 releases its reservation of `014`–`019`. They exist for agent provenance, which has no reader until S10 |

**B6 was found by writing the plans, not by reading the specs.** It is not visible in any single
document — B6 only when S1–S3's deferral meets S9's migration `105` (renumbered from `104`; see B5).

## Open, not yet blocking

| # | Question | Becomes blocking at | Home |
|---|---|---|---|
| O1 | Is `page_view` justifiable at all under purpose limitation | S6a — do not build transport for data that may not be collectable | portal Q2 |
| O2 | Consent Manager registration under DPDP Rule 4 (commences 14 Nov 2026) — needs a lawyer | S6a, and a statutory date regardless | portal Q1 |
| O3 | Retention window per purpose | S6a | portal Q3 |
| O4 | Where the ingestion endpoint runs — Cloud Run versus a third Next.js target | S6a | portal Q4 |
| O5 | Approval value threshold above which `admin` is required | S11 | tenancy Q2 |
| O6 | Twenty sync direction — poll or webhook | S4 | backend Q4 |
| O7 | Allocation rule for D5 — equal split or weighted by enquiry volume | S7 | backend Q5 |
| O9 | Partition cadence for `access_log` | S9 | data model Q5 |
| O10 | Digest email to the broker, given BD2 | S5 | backend G2 (deferred) |

## Closed

| # | Question | Answer | Closed |
|---|---|---|---|
| B5 | `pg_clickhouse` built at S9 | Resolved 2026-08-12: extension in `docker/Dockerfile.postgres`, migration `103_pg_clickhouse_fdw`, gate `fdw-tenant.gate.test.ts`. Spec: `2026-08-12-pg-clickhouse-fdw-design.md`. | 2026-08-12 |
| B1 | Postgres/Twenty field boundary — which system owns each enquiry field, and which wins on conflict | **Twenty owns who, Postgres owns what happened.** Identity fields: Twenty wins. Everything else: Postgres wins, Twenty is a projection. Full table in the Twenty tenancy spec §3 | 2026-08-12, closes dataflow A-1 |
| C1 | Is Twenty CRM data per-org or one shared pipeline | **Shared today, per-org by design.** Each org gets its own provisioned instance (TW1). The client-level platform-only guard is an *interim* containment that stays until every org has one, then is removed. Revised from "shared, permanently" — the original answer treated today's state as the end state | 2026-08-12, revised same day |
| C5 | Do brokers use Twenty's UI | **No.** It is a headless engine kept for dedup, stages and export. Its UI is not part of the product | 2026-08-12 |
| C6 | Workspace-per-tenant or instance-per-tenant | **Instance per tenant**, provisioned via Coolify. Each runs Twenty's default single-workspace mode, the best-tested path | 2026-08-12, TW1 |
| C7 | `twenty_opportunity_id` uniqueness — global or per `org_id` | **Per `org_id`.** Each org has its own Twenty instance issuing its own ids, so global uniqueness was both wrong and unenforceable | 2026-08-12, was O8 |
| C2 | How does `ads-agent` read listings | Database consolidation, UD2 | 2026-08-12, backend D2 |
| C3 | Do external orgs self-register | Staff-provisioned | tenancy Q6 |
| C4 | Where do first-party site searches live, given `search_performed` | Route them through the portal pipeline; retire `search_queries` | 2026-08-12, dataflow A-2 |

## Spec defects found while writing the plans (2026-08-12)

Not questions — the plans already resolved each one and say so at the point of deviation. Listed here
so the **specs** get corrected, because a plan that silently disagrees with its spec is a spec that will
mislead the next reader.

| # | Defect | Home spec | How the plan resolved it |
|---|---|---|---|
| D1 | §9's third safety test submits a **mutating Cypher statement** to `graph_query`, but §5 — revised the same day — says that tool accepts no query text at all. The test's original rationale was statement-type validation, which is the control F-19 declares unsound | agent spec §9 | Test implemented literally, submitting the statement where a template name goes and asserting rejection at the allowlist boundary. It passes, but it no longer proves what it was written to prove. **Amend §9** |
| D2 | Child tables `campaign_draft_messages`, `performance_snapshots`, `crm_signal_snapshots` get **no `org_id`** and are scoped by joining the parent — contradicting "every domain table, no exceptions; a table without it cannot be RLS-protected" | tenancy §2a vs data model §0 | Resolved for the data model. A child without `org_id` cannot carry a policy and is reachable by any query naming it directly. The parent join survives as the backfill source, not as the isolation mechanism. **Amend §2a** |
| D3 | `deletion_propagations.store` admits `bigquery`, a leftover from the rejected design | portal §8 vs §PI3, datastore §14.6 | Migration `060` adds `gcs_raw`, the store portal §7's own erasure table names |
| D4 | `enquiry_fact` is specified `ENGINE = MergeTree`, which watermark CDC cannot use — re-reading updated rows accumulates duplicates forever and reconciliation can never match | data model §7 | `ReplacingMergeTree(updated_at)` with reads via `FINAL`, keeping the spec's `ORDER BY` exactly |
| D5 | The relay index `(created_at) WHERE published_at IS NULL` cannot also lead with `org_id` — an `org_id`-leading index cannot serve "oldest unpublished across all tenants", the relay's only query | data model §5a vs §0 | Both indexes carried; the exception is named in a comment at the deviation |
| D6 | §12.4 asks whether `twenty_opportunity_id` should be unique per org. §3 of the same document already answers it | data model §12.4 | Already closed as C7 above. **Delete the stale question** |
| D7 | Two caches of the same identity fields with no stated relationship: `enquiries.contact_*` and `contacts.*` | data model §3 vs tenancy §4 | Written down: `enquiries.contact_*` is the immutable as-captured submission (evidence); `contacts.*` is the Twenty-reconciled cache, overwritten wholesale by dedup. Contact reveal says which it returned |
| D8 | Twenty enrichment is routed "through the outbox (S5a)", but the build sequence puts S5a **after** S5 | tenancy §7 vs build sequence | Claim-based pollers (`FOR UPDATE SKIP LOCKED`, exponential backoff) whose signatures the S5a consumers keep, so the swap is one script |
| D9 | The context graph's home: the graph node/edge tables are **ClickHouse**, not the Postgres `context` schema | datastore §3.2 + data model §7 | Followed the specs. Postgres `context` holds only the control plane. *This one was my dispatch brief's error, not a spec defect* |
| D10 | `context.session_links` carries an explicit composite primary key against the `uuidv7()` convention | portal §8 | Explicit DDL wins for a pure link table |
| D11 | §13.3 maps a context pack to `context.artifacts.id`, while dataflow A-3 forbids copying Postgres content into the artifact store | datastore §13.3 vs dataflow A-3 | A-3 wins; packs return `rowIds` |
| D12 | D2 still lists "read-only listings API or a projection sync" in its Build column, which datastore §4 moots entirely | backend spec §3 | D2 is now just S3's `GRANT`. No task builds an integration |
| D13 | A6 signals are sequenced at S5, but §6 says they need inbound message text, which arrives with B2 at **S15** | backend spec | Derivation is channel-agnostic and reads whatever `enquiry_messages` holds; until S15 most enquiries yield single-occurrence signals |
| D14 | §8a's token ceiling and §13.4's byte ceiling are described as one mechanism; they are two different ceilings | datastore | Implemented as two, named separately |
| D15 | Garage grants per **bucket** and has no prefix-scoped grant, so "one prefix per tenant with a scoped credential" is not buildable; and CMEK-per-tenant presumes a key manager no spec has chosen | datastore §12.3 vs Garage | One bucket per tenant; application-side envelope encryption under an environment master key. **Ties to B4** |
| D16 | Not a defect, recorded to stop a "fix": migration `002` targets **`public.proposals`** while data model §2 says `adsagent.proposals`. Both are right — `002` runs at S1 against the standalone database, S2 renames the schema and reconciles both `schema_migrations` ledgers, and S3 onward targets `adsagent` | — | Leave it alone |

**Three graph features have no buildable source** and are excluded with a test asserting the exclusion,
so they cannot be quietly assumed present: `POI`/`NEAR` (data model §8 sources them from OpenStreetMap,
but no spec defines an OSM ingestion or a POI table), `Organisation`/`WORKS_FOR` (needs an employer
reference on a person; `adsagent.contacts` has none), and datastore open question 6 on analytical
embeddings, which had to be **decided** rather than deferred or `SIMILAR_TO` could not be built at all —
similarity is computed in Postgres where pgvector lives, and only the resulting pairs ship across.

## Explicitly not questions

Recorded so they are not reopened as though undecided: cross-tenant behavioural aggregation across
brokers (portal Q5) is **out of scope by decision**, not pending — doing it would make us a controller
for that processing with its own lawful basis, and it must not happen incidentally as a side effect of
some other feature.
