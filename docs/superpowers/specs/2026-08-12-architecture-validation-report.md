# Architecture validation report

Date: 2026-08-12
Reviews: `2026-08-11-admin-ux-architecture-design.md`, `2026-08-11-tenancy-authz-foundation-design.md`,
`2026-08-12-backend-features-design.md`, `2026-08-12-unified-datastore-context-graph-design.md`,
`2026-08-12-agent-topology-design.md`
Codebase at commit `7e83c58`

## 1. Method

Three lenses, deliberately combined because each catches what the others miss.

**Claim verification.** Every load-bearing factual assertion in the specs was re-checked against the
codebase rather than trusted. One assertion I made during review was itself wrong and is corrected
below.

**`architect-reviewer` checklist** — scalability, integration, security, data, evolution, technical
debt.

**`adversarial-reviewer` personas** — Saboteur, New Hire, Security Auditor. Used because I wrote all
five specs, and that skill names the failure mode precisely: *"You are likely reviewing code you
just wrote… your brain formed the same mental model that produced this code."* A straight re-read by
the author is worth little.

Two research streams — data-protection compliance and AI-agent security — ran in parallel and are
folded into §7.

## 2. Constraints that shaped this review

Gathered before reviewing, because they change verdicts rather than details.

| Constraint | Value |
|---|---|
| Team | Solo founder, leaning heavily on AI agents |
| Scale at 12 months | 50–500 broker tenants |
| Compliance | India DPDP Act **and** GDPR expected |
| Timeline | No hard deadline — build it properly |
| Hosting | GCP, project `propane-galaxy-498403-n8`, managed by `gcloud` |

The team constraint is the one that matters most, and none of the specs were written against it.

## 3. Claim verification

| Claim | Verdict |
|---|---|
| Seven mutation routes have no authorisation check | **Confirmed exactly** |
| `middleware.ts` excludes `/api` from its matcher | Confirmed — `matcher: ["/((?!api\|_next/static\|...).*)"]` |
| `ads-agent` has zero references to `listings` | Confirmed |
| No email/SMS/WhatsApp sending library in either app | Confirmed |
| No full-text search anywhere (`tsvector`, `pg_trgm`) | Confirmed |
| `campaigns.corridor` is dead outside marketing HTML | Confirmed |
| `cron_settings` is a global singleton | Confirmed — `id INT PRIMARY KEY DEFAULT 1, CHECK (id = 1)` |
| `decideProposal` records no `decided_by` | Confirmed — `UPDATE proposals SET status = $2, decided_at = NOW()` |
| Role vocabulary mismatch between schema and code | Confirmed, and worse than described (F-2) |

**Correction.** Mid-review I reported that eighteen routes were unauthenticated. That was a false
positive: my search pattern missed `requireApiRole`, the actual guard. The chat routes *are*
protected. The specs' original figure of seven was right.

## 4. Findings

### CRITICAL

**F-1 — Row-level security will leak across tenants as specified.**
Both apps construct `pg.Pool`, so connections are reused between requests. The specs describe
setting `app.current_tenant_id` but never state that it must be **transaction-local**. Without the
third argument, `set_config` persists on the pooled connection after the transaction ends, and the
next request reusing that connection inherits the previous tenant's context. RLS then correctly
enforces the wrong tenant: a silent cross-tenant read, no error, no log line.

*Fixed in the datastore spec §5 with the required form, a single-helper rule, and a note that the
same discipline is what makes PgBouncer transaction mode safe later.*

**F-2 — The role system cannot work against its own schema.**
`schema.sql` defines `role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member'))`, while
`lib/auth/dal.ts:12` declares `MemberRole = "admin" | "operator" | "viewer"` with
`ROLE_RANK = { viewer: 1, operator: 2, admin: 3 }`. The database therefore **cannot store `operator`
or `viewer` at all**, and a stored `member` is cast to `MemberRole` and looked up in `ROLE_RANK`,
yielding `undefined`. This is not documentation drift — the authorisation system is inoperable as
deployed. Compounded by the `migrate.ts` trap: altering the CHECK inside `CREATE TABLE` will never
apply to an existing database, so this needs an explicit `ALTER`.

**F-3 — Seven mutation routes remain unauthenticated, including one that spends money.**
`proposals/[id]/approve` decides *and executes* against live Google Ads. Also open: `cycle/run`,
`proposals/[id]` PATCH, `proposals/[id]/reject`, `settings` PATCH, `campaign-drafts/[id]` PATCH,
`campaign-drafts/[id]/create-proposal`. Already the subject of the tenancy spec; re-confirmed live.

### HIGH

**F-4 — Cross-tenant analytics had no authorised path.**
Aggregate insight across brokers is a stated product goal, while three specs assert cross-tenant
reads are impossible. Both cannot hold. *Fixed in datastore spec §5.1: a separate privileged service
with its own role, unreachable from the MCP server, emitting aggregates only, with an append-only
audit log.*

**F-5 — No staleness signal anywhere in the agent path.**
Agents read a graph projected from a CDC-fed mirror. If CDC stalls, agents propose confidently on
stale data — a budget-pause proposal justified by three-day-old spend looks identical to a correct
one. Nothing in the design surfaces lag to the agent, the proposal, or the approving human.
**Recommendation:** carry `built_at` and CDC watermark into every context pack; render staleness on
the proposal; refuse to propose spend changes when lag exceeds a threshold.

**F-6 — Operational surface exceeds the operator.**
Postgres, self-hosted ClickHouse, per-tenant DuckDB snapshots, CDC, the `pg_clickhouse` FDW, the
Hermes fleet, and two Next.js apps — one person. Self-hosting was chosen deliberately over
ClickHouse Cloud for cost and control; recorded in the datastore spec §9 with the mitigation that
ClickHouse must never be on the critical path for the product to function.

**F-7 — `decideProposal` records no decider.**
The entire product premise is human-gated approval, and the approval writes no human. This is an
audit gap today and a compliance problem under both regimes once agents are proposing.

### MEDIUM

**F-8 — Snapshot rebuild has no backpressure.** "Material change marks a tenant stale, a debounced
worker rebuilds." A bulk listings sync touches every tenant at once. No concurrency ceiling, no
queue depth limit, no cost bound.

**F-9 — Snapshot garbage collection has no refcount.** The spec says old snapshots are collected
"once no reader holds them", without saying how that is known. Needs leases or generation counting.

**F-10 — Three phase-numbering schemes.** Phases 0–7, Phases A–F, and Stages 1–5 across three
documents that cross-reference each other. A reader cannot tell what to build first.

**F-11 — No written data model.** Entities are described in prose across five documents and never
as a schema. For a solo operator using AI agents to implement, this is the single highest-leverage
missing artifact.

**F-12 — DuckDB snapshot files are a tenant-isolation boundary with no stated controls.** Each file
holds one tenant's complete dataset. If they land in object storage, bucket IAM becomes a tenancy
boundary; nothing specifies it.

### NOTE

**F-13** — No observability story across three data systems. **F-14** — No backup/DR design;
compliance pillar three is named but never designed. **F-15** — Rate limiting is unaddressed for
LLM-backed endpoints.

## 5. Architecture review

**Sound.** The propose-only agent boundary is the strongest decision in the set — it reuses the
existing approval gate rather than inventing a trust boundary, so a malfunctioning agent produces a
bad suggestion rather than a bad outcome. Schema-per-service with per-schema grants is the canonical
pattern. Graph-as-tables is validated by a serious org that got burned doing otherwise. Postgres as
system of record is correct and now argued rather than assumed.

**Weak.** Evolution is under-specified: there is no rollback for the database consolidation, and no
answer for what happens if ClickHouse or the CDC pipeline is unavailable for a day. Integration is
under-specified: CDC lag has no SLO and no consumer-side handling (F-5). Technical debt is
acknowledged but unscheduled — F-2 and F-3 are live defects in code the new architecture builds on.

**Scalability is not the risk.** At 50–500 tenants nothing here is volume-constrained. The risk is
entirely operational complexity per operator.

## 6. Adversarial review

**Saboteur.** Beyond F-1 and F-5: bulk-approving agent proposals gives each its own undo window, so
one wrong bulk action needs N separate undos with no bulk reversal. The snapshot swap has a race
between a manifest flip and readers holding the old file. Nothing bounds how many proposals an agent
may create, so a malfunctioning agent floods the approval queue the UX spec was designed to keep
calm.

**New Hire.** Five documents, three numbering schemes, no entry point, no schema. Told to "implement
the enquiry spine", a newcomer would not know which spec is authoritative or which phase precedes
which. F-10 and F-11 are the concrete fixes.

**Security Auditor.** F-1, F-2, F-3 and F-12 are its findings. Additionally: the task token needs a
stated TTL, revocation path and replay defence; `graph_query` accepts model-generated query text and
statement-type validation is a known-weak control; agents read untrusted public enquiry text. See §7.

## 7. Compliance and agent-security research

Two parallel research streams ran against primary sources. Both found problems that change the
design rather than merely annotate it.

### 7.1 Data protection — the retention floor contradicts our deletion model

**The timeline is settled, not speculative.** The DPDP Rules 2025 were
[notified on 14 Nov 2025](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655). Rule 4
(Consent Managers) commences 14 Nov 2026; **Rules 3 and 5–16 commence around 13 May 2027**, and
that block contains notice, security, breach, retention and transfer obligations. That lands
squarely inside the window where this product would be operating at 50–500 tenants.

**F-16 (CRITICAL for design) — erasure cannot be a hard delete.**
[Rule 8(3)](https://www.dpdpa.com/dpdparules/rule8.html) requires personal data, associated traffic
data and processing logs to be retained **for at least one year**, expressly including data held by
a processor on a fiduciary's behalf, and the Rule's own illustration confirms this holds *"even if X
deletes her account."* Every deletion design in these specs assumed cascading hard deletes. The
correct model is **suppression first — tombstone plus access block — with a scheduled hard-erase
after the retention floor**. Building delete-on-request would be non-compliant in the opposite
direction from the usual mistake.

*(How Rule 8(3) reconciles with the §12 erasure right is genuinely unsettled in the sources. Needs
a lawyer before launch.)*

**F-17 (HIGH) — per-tenant DuckDB snapshots are the single largest privacy exposure.** They are
immutable files that outlive deletions by construction. Either regenerate on a fixed cycle with a
hard TTL, or encrypt per data subject and destroy keys (crypto-shredding). The ICO's
["beyond use"](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)
allowance covers backups, not live analytical artefacts.

**F-18 (HIGH) — the context graph is personal data.** [EDPB Opinion 28/2024](https://www.edpb.europa.eu/system/files/2024-12/edpb_opinion_202428_ai-models_en.pdf)
holds that models trained on personal data are not automatically anonymous, which points against
treating derived artefacts as out of scope. Every node and edge derived from an enquirer must carry
subject provenance so it can be pruned on erasure.

**Other obligations with architectural consequences.** You are a **Data Processor** for tenant
enquiry data under both regimes (brokers determine the purpose) — but you become a **controller**
the moment you use enquirer data for your own product improvement, which is exactly what
cross-tenant analytics (§5.1) does. Breach notification has **no de-minimis threshold**: every
affected principal without delay, Board report within 72 hours, penalties to ₹250 crore. Rule
6(1)(a) names encryption, masking and tokenisation explicitly — **RLS alone is not a sufficient
safeguard**. Access logs must be retained a year to support blast-radius queries. The LLM provider
is a **sub-processor**, requiring listing, tenant authorisation, no-training flags and zero-retention
settings. India has **no EU adequacy decision**, so EU data needs SCCs plus a transfer impact
assessment, and a DPIA is likely required given AI plus data matching plus invisible processing.

Good news: **there is no general data-localisation mandate for non-SDFs**, so GCP region choice
stays open, and the three-year inactivity erasure in Rule 8(1) applies only to large
e-commerce/gaming/social platforms — not to this product.

### 7.2 Agent security — one tool is structurally unsound

**What the design already gets right, confirmed against OWASP.** The propose-only boundary genuinely
closes Excessive Agency (LLM03) at all three root causes rather than mitigating it. Under the
Rule-of-Two framing, agents hold untrusted input and sensitive data but neither state change nor
external communication — the acceptable tier. And server-derived tenancy is precisely the fix for
the failure that [broke Supabase's MCP server](https://generalanalysis.com/blog/supabase-mcp-blog),
where a support-ticket injection exfiltrated tokens because the agent held a role that bypasses RLS.

**F-19 (CRITICAL) — `graph_query` must not accept free-form query text.** Statement-type validation
is a denylist, and read-only statements still exfiltrate: subqueries against system catalogs, CTEs,
`UNION` branches that escape a top-level injected predicate, and blind timing oracles that leak data
a bit at a time. Textual predicate injection — which is exactly what "the server injects the tenant
predicate" means — is structurally unsound.
[Cypher injection](https://neo4j.com/developer/kb/protecting-against-cypher-injection/) has the same
properties. **Replace with parameterised, allowlisted templates where the model supplies only
values, over views that already embed the tenant predicate** so there is nothing to inject.

**F-20 (CRITICAL) — RLS is void if the MCP server connects as the table owner.** Table owners ignore
row-level security unless `FORCE ROW LEVEL SECURITY` is set. The session variable would be set
correctly and enforce nothing. This compounds F-1: connect as a dedicated **non-owner** role with
`SELECT` only, and add a CI test asserting a cross-tenant read fails.

**F-21 (HIGH) — Kanban comments launder untrusted text into trusted instruction.** Agent A reads a
hostile enquiry email and writes a comment; Agent B consumes that comment as peer output. This is
documented inter-agent trust escalation with
[100% success rates reported](https://arxiv.org/html/2603.09134v1) against AutoGen, CrewAI and
MetaGPT. Mitigation: taint labels propagated transitively, and a **typed inter-agent message schema**
— enum intents plus record IDs rather than free prose.

**F-22 (HIGH) — the approval gate decays, and can be lied to.** Human approval is the single
load-bearing control in the whole design. OWASP flags approval fatigue explicitly, and
invisible-Unicode smuggling can make the displayed proposal differ from what executes. Strip
tag-block (U+E0000–E007F), variation-selector and zero-width characters at ingest and render; show
approvers **the literal Google Ads mutation diffed against live state**, never the agent's own
summary; cap proposals per tenant per day; require step-up approval above a spend threshold.

**F-23 (HIGH) — six agents under one uid defeats the per-tenant token.** Any agent that can read
another's memory, argv, environment or the Kanban SQLite file has the others' tenancy. One uid per
profile is the minimum; containers per tenant the ideal. Deliver tokens over a unix socket with
`SO_PEERCRED` rather than environment variables or files, and never log them to Kanban.

**F-24 (HIGH) — denial of wallet via the public enquiry form.** An unauthenticated endpoint triggers
multi-agent inference that fans out across Kanban hops. Needs non-overridable per-tenant cost
ceilings that **halt** inference, per-task caps on tool calls and agent hops with a circuit breaker,
length caps on enquiry text, and bot mitigation on the form.

**F-25 (MEDIUM) — the task token binds scope, not intent.** Within its TTL an injected agent may
invoke any read tool. Embed the profile's tool allowlist in the token, revoke server-side on task
completion, and ensure the executor holds its own Google Ads credential rather than receiving one
passed through.

## 8. Decisions taken during validation

- ClickHouse **self-hosted** on GCP, not ClickHouse Cloud. Recommendation was the managed option on
  operational-burden grounds; self-hosting chosen for cost and control.
- Cross-tenant analytics via a **separate privileged service** (§5.1 of the datastore spec).
- **Full architecture before launch**, rather than cutting to the product critical path.
- Validation output as this standalone report plus fixes applied in place.

## 9. What must be fixed before any customer data exists

**Tier 1 — small, release-blocking, and none catchable by testing the happy path.**
F-1 transaction-local tenant context · F-20 non-owner DB role plus `FORCE ROW LEVEL SECURITY` and a
CI test that a cross-tenant read fails · F-2 role vocabulary and the explicit `ALTER` · F-3 route
authorisation · F-7 record the decider.

**Tier 2 — design changes, before the code they affect is written.**
F-19 replace `graph_query` with parameterised templates over tenant-scoped views · F-16 build
erasure as suppression-then-scheduled-delete, never hard delete · F-17 snapshot TTL or
crypto-shredding · F-21 typed inter-agent messages with taint propagation.

**Tier 3 — before first paying tenant.**
F-22 approval-gate hardening and Unicode stripping · F-23 per-profile uid isolation · F-24 cost
ceilings and circuit breakers · F-18 subject provenance on graph nodes · a deletion ledger to
evidence the 90-day response · a sub-processor list naming the model provider, with no-training and
zero-retention configured.

The ordering matters: Tier 1 protects data that exists today, Tier 2 avoids building things that
must be torn out, and Tier 3 is what a tenant's own compliance review will ask for.

---

## 10. Findings closed in the specs (2026-08-12)

Every finding is now either designed into a spec or scheduled as work. Nothing remains
recorded-but-unaddressed.

| Finding | Where it now lives |
|---|---|
| F-1 RLS pooling leak | tenancy spec §3a *and* datastore §5 — it belonged in the tenancy spec |
| F-2 role vocabulary | data model §2, as an explicit `ALTER` plus the `member` → `operator` remap |
| F-3 route authorisation | tenancy spec §4 (already designed); scheduled as **S1** |
| F-4 cross-tenant path | datastore §5.1 — separate privileged service |
| F-5 staleness signal | datastore §12.1 and agent spec §5 — context packs carry their own age |
| F-6 operational surface | datastore §9, recorded as an accepted trade |
| F-7 no decider recorded | data model §2; tenancy spec already added `decided_by`/`decided_via` |
| F-8 rebuild backpressure | datastore §12.2 — concurrency ceiling, debounce, priority |
| F-9 snapshot GC | datastore §12.2 — generation-based with reader leases |
| F-10 three numbering schemes | `2026-08-12-build-sequence.md`, now canonical |
| F-11 no data model | `2026-08-12-data-model.md` |
| F-12 snapshot bucket IAM | datastore §12.3 — per-tenant prefix, scoped service account, CMEK |
| F-13 observability | datastore §12.4 — four signals, one alert each |
| F-14 backup and DR | datastore §12.5 — only Postgres holds anything irreplaceable |
| F-15 rate limiting | datastore §12.6 and agent spec §6 |
| F-16 erasure model | datastore §11.1 — suppression then scheduled erase |
| F-17 snapshot TTL | datastore §11.2 and §12.3 |
| F-18 graph is personal data | data model `graph_node.subject_ref`; datastore §11.2 |
| F-19 `graph_query` | agent spec §5 — parameterised templates over tenant-scoped views |
| F-20 table-owner RLS bypass | tenancy spec §3a, agent spec §5, data model §0 |
| F-21 Kanban comment laundering | agent spec §7 — typed messages plus taint labels |
| F-22 approval gate | UX spec §C — literal mutation diff, Unicode stripping, bulk cancel |
| F-23 per-uid isolation | agent spec §6 |
| F-24 denial of wallet | agent spec §6, datastore §12.6 |
| F-25 token binds intent | agent spec §6 — tool allowlist in the token |

The distinction to keep in mind: **designed is not done.** Every row above is a specification, not
working code. S1 in the build sequence is the only item that touches software that exists today.
