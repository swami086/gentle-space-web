# RP — Ryze parity program (umbrella)

Date: 2026-08-13  
Status: approved (brainstorming complete; per-workstream specs written)

Scope: 1:1 capability parity with [Ryze AI](https://www.get-ryze.ai/) across paid ads, MCP/API, SEO, GEO, website/CRO, agency white-label and the free-tools funnel — built on the existing `ads-agent` service plus a new `cms-service`.  
Related: [`2026-08-03-ads-automation-agent-design.md`](2026-08-03-ads-automation-agent-design.md) (original human-gated design, modelled on Ryze), [`2026-08-12-unified-datastore-context-graph-design.md`](2026-08-12-unified-datastore-context-graph-design.md) (tenancy, ClickHouse mirror, context graph), [`2026-08-12-backend-features-design.md`](2026-08-12-backend-features-design.md)  
Constraints: graduated autonomy (§Global constraints GC1), CRE-first tenant config (GC2), search-policy compliance (GC3), uniform audit ledger (GC4)

## Problem

`ads-agent` today is a human-gated Meta + Google proposal engine for one tenant. Ryze ships a broader product: multi-channel autonomous ad management, a public MCP/API surface, an SEO autopilot, GEO/AI-citation work, website/CRO automation, and an agency white-label tier. Matching that surface 1:1 is nine largely independent subsystems. Attempting it as one spec produces an unbuildable document; attempting it as nine simultaneous vertical slices produces nine incompatible definitions of "execute a change".

## Goals

1. Reach feature parity with Ryze's advertised surface, minus the parts that violate search-engine policy (GC3).
2. Preserve the differentiators Ryze lacks: CRM lead-quality objective, enquiry/WhatsApp spine, context graph, and a single approval ledger.
3. Decompose into workstreams that up to 8 agents can build **in parallel** without merge conflicts or interface guesswork.
4. Keep CRE-first values in data so a horizontal (non-CRE) tenant can be onboarded later without refactoring.

## Non-goals

- Buying backlinks, PR placement networks, guest-post networks, automated Reddit/Quora/Wikipedia posting, or mass thin-content generation (GC3).
- TikTok, Microsoft and Pinterest ad connectors in this program (the adapter interface accommodates them later; no adapter is written now).
- Generative AI video / UGC creative.
- Reseller billing, margin control and affiliate programs in the agency tier.
- Replacing Twenty CRM, `auth-service`, or the existing listings marketing site.

## Decisions (brainstorming, 2026-08-13)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Parity boundary | All nine software surfaces (W1–W9) |
| 2 | Autonomy model | Graduated autonomy — per-action-kind promotion after N clean approvals, inside guardrails, with undo window |
| 3 | Customer / tenant model | CRE vertical first, horizontal-ready tenant config |
| 4 | SEO/CRO publishing surface | Hosted CMS we operate (not third-party CMS adapters) |
| 5 | SEO/GEO parity boundary | Compliant subset only — no link buying, no scaled thin content, no automated third-party posting |
| 6 | Ad channels | Google + Meta (hardened) + LinkedIn; adapter framework generic for later channels |
| 7 | Creative | Copy variants + statics composed from real listing photos; A/B + fatigue refresh; no generative video |
| 8 | MCP/API | Public OAuth MCP **and** documented REST |
| 9 | Agency tier | Multi-account workspace + bulk audit + white-label reports (no reseller billing) |
| 10 | Decomposition | Thin wave-0 foundation, then 8 parallel workstreams |
| 11 | CMS deployment | Separate `cms-service` Next.js app, own schema, internal-key API |

## Parity matrix

| WS | Ryze capability | Existing basis in repo | Delivered by |
|----|-----------------|------------------------|--------------|
| W1 | Always-on management, pause/scale, cross-channel budget shifts | `lib/decision-engine/*`, S11 approve→scheduled+undo | Autonomy rollout across ad action kinds |
| W2 | Channel breadth | `lib/connectors/{meta,google-ads}.ts` | LinkedIn adapter + Google/Meta depth on the adapter interface |
| W3 | Ad variants written, A/B tested, fatigue-refreshed | none (explicit non-goal of the 2026-08-03 spec) | Creative engine using listings data |
| W4 | "API to let AI manage your ads", 150+ tools, OAuth | `mcp/{context-server,google-ads-server,app-data-mcp-server}` | Public OAuth MCP + REST |
| W4a | (prerequisite for the above) | `auth-service` RS256 signing + JWKS publication | OAuth 2.1 authorization server: authorization-code + PKCE, client metadata documents, consent, grants |
| W5 | Technical SEO fixes, programmatic content, rank tracking | none | SEO autopilot |
| W6 | AI-search citations, llms.txt, share of voice | none | GEO workstream |
| W7 | Website edits, A/B tests, CRO fixes | none | `cms-service` + CRO agent |
| W8 | 100s of accounts, bulk audits, white-label reports | `auth-service` RBAC, org scoping, `lib/portal`, `lib/metering` | Agency workspace |
| W9 | Free calculators/generators, free domain audit | none | Free tools + audit funnel |

## Global constraints

Every workstream spec inherits these verbatim.

- **GC1 — Graduated autonomy.** No write to any external system (ad platform, CMS, third-party API) may execute without either an explicit human approval or an `autonomy_policies` row in `mode = 'auto'` for that `(org_id, action_kind)` whose guardrails pass at execute time. The autonomy engine fails closed: on any policy-lookup error the action is gated.
- **GC2 — Tenant config, not constants.** Corridors, negative-keyword seeds, lead tiers, objectives, currency and brand kit are read from `tenant_config`. No workstream hardcodes CRE values.
- **GC3 — Search-policy compliance.** No feature may buy or exchange links, generate pages whose primary purpose is ranking manipulation, publish third-party content onto a host domain for its ranking signals, post automatically to third-party communities, serve different content to a crawler than to a user, or send automated queries to a search engine. Reference anchors, each of which a gate reviewer must be able to check independently: [link spam](https://developers.google.com/search/docs/essentials/spam-policies#link-spam), [scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content), [site reputation abuse](https://developers.google.com/search/docs/essentials/spam-policies#site-reputation), [doorway abuse](https://developers.google.com/search/docs/essentials/spam-policies#doorway-abuse), [cloaking](https://developers.google.com/search/docs/essentials/spam-policies#cloaking), [machine-generated traffic](https://developers.google.com/search/docs/essentials/spam-policies#machine-generated-traffic).

  **Doorway abuse is the policy that actually governs one-page-per-locality**, not scaled content abuse — its examples name "multiple domain names or pages targeted at specific regions or cities that funnel users to one page" and "substantially similar pages that are closer to search results than a clearly defined, browseable hierarchy". Since W7 serves many tenants on many custom domains from one listings database, that first example describes the deployment unless the value gate prevents it.

  **Compliance thresholds are program floors in code, never tenant config.** Tenant config may make a gate stricter; it may never loosen one. This resolves the tension where GC2 would otherwise let a tenant set the minimum-listings threshold to 1 and pass.

  Site reputation abuse is narrower than a blanket ban — the policy turns on content being hosted *mainly for the host's ranking signals*, and editorial columns, syndication and UGC are explicitly not violations. The program's blanket refusal is therefore a deliberate conservative choice, not a policy requirement, and should be described that way.

- **GC4 — Uniform audit ledger.** Auto-executed actions write the same `proposals` row (status `auto_executed`) and the same **`adsagent.audit_log`** entry via `writeAudit` as human-approved ones, and publish to the outbox. There is exactly one changelog.

  Two corrections to the original wording. The ledger is `audit_log`, not `ai_action_log`: migration 013 states `ai_action_log` "is retained in place and **unread**; it is dropped in a later cleanup", and it has no `org_id`, so using it would violate GC6. And the gated path does **not** currently publish to the outbox — `executeProposal` calls `markProposalExecuted` and nothing else — so making the two paths identical means *adding* outbox publication to the gated path, which is W0 work, not a W1 assumption.

- **GC5 — Idempotency.** Every `execute` accepts and honours an idempotency key, backed by a durable store (`adsagent.adapter_idempotency`, W0). Multi-operation platform writes record a compensating entry rather than leaving a silent partial. No platform SDK accepts an idempotency key natively, so this is our store, not theirs.

- **GC6 — Tenant isolation.** Every new table follows the repo's canonical shape verbatim — not a paraphrase of it:

  ```sql
  BEGIN;
  CREATE TABLE adsagent.x (
    id         UUID PRIMARY KEY DEFAULT uuidv7(),
    org_id     public.org_ref NOT NULL REFERENCES public.orgs(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX x_org_thing_idx ON adsagent.x (org_id, thing, created_at DESC);
  ALTER TABLE adsagent.x ENABLE ROW LEVEL SECURITY;
  ALTER TABLE adsagent.x FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON adsagent.x;
  CREATE POLICY tenant_isolation ON adsagent.x
    USING      (org_id = public.current_tenant() OR public.is_platform_read())
    WITH CHECK (org_id = public.current_tenant());
  COMMIT;
  ```

  Every element is load-bearing. `uuidv7()` is the convention in 30 migrations and `gen_random_uuid()` in zero. `public.org_ref` is the domain type used in ~25 migrations. **`FORCE` with no policy is deny-all** — a table shipped without the policy is unreadable by every role, and the natural panic-fix under deadline is `USING (true)`, which is a silent cross-tenant leak. `WITH CHECK` carries as much isolation as `USING`; migration 009 warns explicitly that without it "a tenant can write rows carrying another tenant's org_id". Every migration ships a paired `.down.sql`; the runner requires it.

  Tables read by a scheduler across orgs additionally need a `cross_tenant_read` `FOR SELECT` policy, or `withCrossTenantRead` returns zero rows and the scheduler **silently does nothing**.

  A program-wide test greps every new migration for its policy, following `110_proposal_cross_tenant_claim.test.ts`, so a missing policy fails CI rather than production.

  **Documented exception:** `adsagent.audit_requests` (W9) is anonymous by nature and carries no `org_id`. It is the only exempt table, it must declare explicit `GRANT`s (notably excluding `agent_ro`), and it must carry retention.

- **GC7 — Never log or persist raw error text.** `err.message` is forbidden in any persisted or spanned field. `lib/tracing/redact.ts` documents why: "a Postgres error's message and detail echo row values, a ClickHouse error echoes the query, and a validation error echoes the input" — and platform SDK errors are worse, routinely serialising the failed request including `Authorization` headers. Errors cross boundaries as closed-enum codes via `safeErrorCode`, never free text.

- **GC8 — No cross-range migration references.** Migrations are applied in version order, not merge order, so a lower-numbered migration must never reference an object created in another workstream's higher range. Cross-workstream foreign keys are therefore forbidden; use the documented-external-reference comment pattern from migration 056 instead.

## Workstream map and dependencies

```text
W0 foundation (autonomy engine · channel registry · tenant config · publish contract)
 │
 ├─ W1 autonomy rollout            needs: autonomy engine
 ├─ W2 LinkedIn + channel depth    needs: channel registry
 ├─ W3 creative engine             needs: channel registry, autonomy engine
         ├─ W4a OAuth authorization server needs: nothing (own service)
         ├─ W4 public MCP + REST           needs: channel registry (tool descriptors), autonomy engine,
         │                                        W4a token-claims contract (published in the W4a spec,
         │                                        so both build in parallel; only W4's final
         │                                        integration task needs W4a running)
 ├─ W5 SEO autopilot               needs: publish contract
 ├─ W6 GEO / AI citations          needs: publish contract
 ├─ W7 cms-service + CRO agent     needs: publish contract (implements it)
 ├─ W8 agency workspace            needs: tenant config
 └─ W9 free tools + audit funnel   needs: nothing
```

W5, W6 and W7 depend on the publish **contract**, not on each other's implementations — the contract ships in W0 precisely so those three can run concurrently.

## Parallel-safety: ownership map

Two mechanisms prevent eight concurrent worktrees from colliding.

**1. Owned paths.** Each workstream may create/modify only its own paths; shared paths are W0-only and frozen once W0 merges.

| WS | Owned paths |
|----|-------------|
| W0 | `ads-agent/lib/autonomy/`, `ads-agent/lib/channels/`, `ads-agent/lib/tenant-config/`, `ads-agent/lib/publish/`, `ads-agent/lib/types.ts`, `ads-agent/lib/executor/`, `ads-agent/lib/db/proposals.ts`, `ads-agent/lib/net/` (guarded fetch), `ads-agent/mcp/google-ads-server/`, `ads-agent/app/(admin)/settings/autonomy/` |
| W1 | `ads-agent/lib/decision-engine/`, `ads-agent/app/(admin)/proposals/`, `ads-agent/app/api/proposals/`, `ads-agent/scripts/run-proposal-undo-worker.ts` |
| W2 | `ads-agent/lib/connectors/`, `ads-agent/mcp/linkedin-ads-server/`, `ads-agent/lib/channels/linkedin-adapter.ts` |
| W3 | `ads-agent/lib/creative/`, `ads-agent/app/(admin)/creative/` |
| W4 | `ads-agent/app/api/public/`, `ads-agent/app/.well-known/`, `ads-agent/lib/publicapi/`, `ads-agent/mcp/public-gateway/` |
| W4a | `auth-service/` (entire existing service) |
| W5 | `ads-agent/lib/seo/`, `ads-agent/app/(admin)/seo/` |
| W6 | `ads-agent/lib/geo/`, `ads-agent/app/(admin)/geo/` |
| W7 | `cms-service/` (entire new app) |
| W8 | `ads-agent/lib/agency/`, `ads-agent/app/(admin)/agency/` |
| W9 | `app/tools/` routes in the marketing site, `ads-agent/lib/audit-funnel/` |

Three mechanisms remove the shared-file conflicts that owned paths alone cannot:

- **`lib/executor/` is W0-owned and becomes a registry.** The current `switch (proposal.kind)` with a throwing `default` would otherwise force W1, W3 and W7 to edit the same statement concurrently. W0 replaces it with `registerExecutor(kind, handler)` so each workstream *adds a file*.
- **`proposals.kind` stops being a closed `CHECK`.** Today `proposals_kind_check` hardcodes five literals; three workstreams each adding kinds would each need a DROP/ADD restating the full list, and whichever migration applies last silently wins. W0 replaces it with an insert-only `adsagent.proposal_kinds` lookup table.
- **W0 declares the shared-file exceptions it needs**: it rewrites `lib/decision-engine/strategy-config.ts` (a W1 path) down to a seed export, and it owns `mcp/google-ads-server/` in order to close the ungated write surface. W2 extends the W0-authored `google-adapter.ts` / `meta-adapter.ts` capability lists; that exception is declared rather than implicit.

`lib/nav-config.ts` is appended to only at each workstream's final task, in a single-line change. (The earlier draft also named `lib/db/schema.sql` as a shared ads-agent file — no such file exists; ads-agent's checked-in artefact is the generated `lib/db/baseline.sql`, which must not be hand-edited.)

**2. Migration ranges.** Latest applied migration is `112`. Each workstream owns a disjoint numeric block and may not use another's.

| WS | Migration range |
|----|-----------------|
| W0 | 120–129 |
| W1 | 130–139 |
| W2 | 140–149 |
| W3 | 150–159 |
| W4 | 160–169 |
| W5 | 170–179 |
| W6 | 180–189 |
| W8 | 190–199 |
| W9 | 200–209 |
| W7 | `cms-service/lib/db/migrations/001+` (own schema, own sequence) |
| W4a | `auth-service` own schema, own sequence |

## Sequencing

**Wave 0:** W0 alone, merged to `main` before the parallel wave starts. It is small by construction — four modules, no product surface.

**Wave 1:** W1–W9 plus W4a in parallel worktrees — ten workstreams against an 8-agent ceiling, so two are slotted in as capacity frees. Hold back **W9** (fully independent, no dependants) and **W6** (depends only on the publish contract, and its value compounds after W5 has pages to analyse). Start W4a early despite the ceiling: it has no dependencies and W4 cannot finish without it.

**Wave 2 (out of scope for these specs):** additional channels (TikTok/Microsoft/Pinterest) as adapters, ads-in-ChatGPT when the surface has a public API, reseller billing.

## Risks

| Risk | Mitigation |
|------|------------|
| Autonomy causes real overspend | Guardrails re-checked at execute time; undo window; three-level kill switch; promotion requires a clean streak per action kind |
| Nine parallel workstreams drift on interfaces | W0 freezes shared interfaces before wave 1; each spec restates consumed/produced signatures verbatim |
| SEO/GEO work drifts toward policy-violating tactics | GC3 is a spec-level constraint reviewed in every workstream gate test |
| Public API exposes a write path that bypasses the gate | W4 publishes a literal allowlist (not a containment rule); an import boundary forbids `lib/publicapi/` from importing `getAdapter`; an exhaustive registry sweep drives every executable descriptor with `evaluateAutonomy` stubbed to throw |
| The gate sits *above* the bypass, so every workstream gate test asserts the wrong layer | **W0 moves enforcement below the adapters.** `execute` requires an `ExecutionGrant` that only the autonomy engine can construct (class with a private field, not a forgeable branded alias); the connectors and the Google Ads MCP server reject writes without it; `lib/publicapi/` may not import `getAdapter` at all. Structural, not test-asserted |
| `cms-service` cannot verify a `proposalId` it is handed — no FK is possible across a schema and service boundary, so any internal-key holder can send a random UUID | `lib/publish/` mints a short-lived HMAC over `(orgId, proposalId, idempotencyKey, actionKind)` after calling `evaluateAutonomy` itself; `cms-service` verifies the HMAC. The gate stops being opt-in per call site |
| One listings database feeding many tenant domains produces cross-domain near-duplicates, which is doorway abuse in the deployment's own shape | Value gate spans all tenant domains plus the Gentle Space site; shared-source listing prose is excluded from the uniqueness numerator; first-party tenant content is a mandatory component of the distinct-fact count |
| Anonymous free-audit endpoint fetches user-submitted domains (SSRF, outbound DoS, stored XSS) | W0 owns one guarded-fetch module used by W9 and W6: resolve once, reject private/loopback/link-local/CGNAT/reserved ranges (v4, v6, v4-mapped), connect to the validated IP with explicit Host/SNI, `redirect: 'manual'` revalidating each hop, http/https on 80/443 only, caps on body bytes, decompressed bytes, depth and wall time |
| **Pre-existing GC1 violation in `mcp/google-ads-server`** — `create_campaign`, `pause_campaign`, `update_campaign_budget` and `add_negative_keyword` mutate Google Ads in-process with no proposal, no autonomy evaluation and no `ai_action_log` entry. The file's comment claims `propose_change` is the only reachable write path, which holds by network placement and Hermes configuration, not by code (the per-profile allowlists in `lib/agent/profiles.ts` gate the context-server task token, and that server has none). | **W1/W2 must route these four tools through the proposal pipeline or remove them.** W4 must not publish them, and their existence is not precedent. Tracked as a W1 task, not deferred to wave 2 |
| Migration collisions across worktrees | Disjoint per-workstream ranges, above |

## Testing

Each workstream ships one gate test file (`<ws>-gate.test.ts`) following the existing `lib/events/gate.db.test.ts` and `scripts/s12-chain-gate.ts` convention, asserting: tenant isolation, idempotency, autonomy path (gated and auto), audit-ledger uniformity, and the workstream's own invariants. The program is complete when all ten workstream gates plus W0's pass on `main`.

## Revision log

**2026-08-13 — after four-reviewer pass (architecture, data model and security, SEO/GEO, cross-spec consistency).** Verdict was BLOCK; the following program-level corrections landed first because every workstream inherits them. GC3 gained doorway abuse, cloaking and machine-generated traffic, and compliance thresholds became code floors rather than tenant config. GC4 now names `adsagent.audit_log` (migration 013 retired `ai_action_log` as "retained in place and unread", and it has no `org_id`), and records that the gated path does not currently publish to the outbox. GC6 now quotes the canonical DDL verbatim — `uuidv7()`, `public.org_ref`, the FK to `public.orgs`, and the `tenant_isolation` policy with `WITH CHECK` — because `FORCE` with no policy is deny-all and its panic-fix is a permissive policy. Added GC7 (no raw `err.message` anywhere persisted) and GC8 (no cross-range migration references, since migrations apply in version order rather than merge order). Ownership extended to the five unowned load-bearing files; the executor became a registry and `proposals.kind` a lookup table, because three workstreams would otherwise edit one `switch` and one `CHECK` concurrently. Enforcement moved below the adapters via an unforgeable `ExecutionGrant`, and the publish client now mints an HMAC that `cms-service` can actually verify.

**2026-08-13 — after API review.** Split W4a out of W4 (the OAuth authorization server was one sentence in W4 with no owner, no path allocation and no migration budget; `auth-service` has RS256 signing and JWKS but no `/authorize`, `/token`, client store or consent). Added `ads-agent/app/.well-known/` to W4's owned paths, since RFC 9728 derives the metadata path from the resource URI and it must be served from the origin root. Recorded the pre-existing ungated Google Ads MCP mutation tools as a W1/W2 obligation rather than leaving them implicit. Two W0 interfaces changed before freeze: `ToolDescriptor` gained `effect`/`scope`/`internalToolName`, and `ExecutionResult.error.class` gained `quota` with `retryAfterMs`.
