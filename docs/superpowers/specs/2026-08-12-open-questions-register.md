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
| B1 | Postgres/Twenty field boundary — which system owns each enquiry field, and which wins on conflict | **Twenty owns who, Postgres owns what happened.** Identity fields: Twenty wins. Everything else: Postgres wins, Twenty is a projection. Full table in the Twenty tenancy spec §3 | 2026-08-12, closes dataflow A-1 |
| C1 | Is Twenty CRM data per-org or one shared pipeline | **Shared today, per-org by design.** Each org gets its own provisioned instance (TW1). The client-level platform-only guard is an *interim* containment that stays until every org has one, then is removed. Revised from "shared, permanently" — the original answer treated today's state as the end state | 2026-08-12, revised same day |
| C5 | Do brokers use Twenty's UI | **No.** It is a headless engine kept for dedup, stages and export. Its UI is not part of the product | 2026-08-12 |
| C6 | Workspace-per-tenant or instance-per-tenant | **Instance per tenant**, provisioned via Coolify. Each runs Twenty's default single-workspace mode, the best-tested path | 2026-08-12, TW1 |
| C7 | `twenty_opportunity_id` uniqueness — global or per `org_id` | **Per `org_id`.** Each org has its own Twenty instance issuing its own ids, so global uniqueness was both wrong and unenforceable | 2026-08-12, was O8 |
| C2 | How does `ads-agent` read listings | Database consolidation, UD2 | 2026-08-12, backend D2 |
| C3 | Do external orgs self-register | Staff-provisioned | tenancy Q6 |
| C4 | Where do first-party site searches live, given `search_performed` | Route them through the portal pipeline; retire `search_queries` | 2026-08-12, dataflow A-2 |

## Explicitly not questions

Recorded so they are not reopened as though undecided: cross-tenant behavioural aggregation across
brokers (portal Q5) is **out of scope by decision**, not pending — doing it would make us a controller
for that processing with its own lawful basis, and it must not happen incidentally as a side effect of
some other feature.
