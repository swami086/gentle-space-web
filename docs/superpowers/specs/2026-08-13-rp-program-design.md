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
- **GC3 — Search-policy compliance.** No feature may buy or exchange links, generate pages whose primary purpose is ranking manipulation, publish third-party content onto a host domain for its ranking signals, or post automatically to third-party communities. Reference: [Google Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies) (link spam, scaled content abuse, site reputation abuse).
- **GC4 — Uniform audit ledger.** Auto-executed actions write the same `proposals` row (status `auto_executed`) and `ai_action_log` entry as human-approved ones, and publish to the outbox. There is exactly one changelog.
- **GC5 — Idempotency.** Every `execute` accepts and honours an idempotency key. Multi-operation platform writes record a compensating entry rather than leaving a silent partial.
- **GC6 — Tenant isolation.** All new tables carry `org_id`, live under the `adsagent` schema (or `cms` for `cms-service`), enable `FORCE ROW LEVEL SECURITY`, and use a leading-edge tenant index.

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
| W0 | `ads-agent/lib/autonomy/`, `ads-agent/lib/channels/`, `ads-agent/lib/tenant-config/`, `ads-agent/lib/publish/` |
| W1 | `ads-agent/lib/decision-engine/`, `ads-agent/app/(admin)/proposals/`, `ads-agent/app/api/proposals/` |
| W2 | `ads-agent/lib/connectors/`, `ads-agent/mcp/linkedin-ads-server/` |
| W3 | `ads-agent/lib/creative/`, `ads-agent/app/(admin)/creative/` |
| W4 | `ads-agent/app/api/public/`, `ads-agent/app/.well-known/`, `ads-agent/lib/publicapi/`, `ads-agent/mcp/public-gateway/` |
| W4a | `auth-service/` (entire existing service) |
| W5 | `ads-agent/lib/seo/`, `ads-agent/app/(admin)/seo/` |
| W6 | `ads-agent/lib/geo/`, `ads-agent/app/(admin)/geo/` |
| W7 | `cms-service/` (entire new app) |
| W8 | `ads-agent/lib/agency/`, `ads-agent/app/(admin)/agency/` |
| W9 | `app/tools/` routes in the marketing site, `ads-agent/lib/audit-funnel/` |

Shared files that multiple workstreams must touch (`lib/nav-config.ts`, `lib/db/schema.sql` registry comments) are appended to only at each workstream's final task, in a single-line change, to keep conflicts trivial.

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
| **Pre-existing GC1 violation in `mcp/google-ads-server`** — `create_campaign`, `pause_campaign`, `update_campaign_budget` and `add_negative_keyword` mutate Google Ads in-process with no proposal, no autonomy evaluation and no `ai_action_log` entry. The file's comment claims `propose_change` is the only reachable write path, which holds by network placement and Hermes configuration, not by code (the per-profile allowlists in `lib/agent/profiles.ts` gate the context-server task token, and that server has none). | **W1/W2 must route these four tools through the proposal pipeline or remove them.** W4 must not publish them, and their existence is not precedent. Tracked as a W1 task, not deferred to wave 2 |
| Migration collisions across worktrees | Disjoint per-workstream ranges, above |

## Testing

Each workstream ships one gate test file (`<ws>-gate.test.ts`) following the existing `lib/events/gate.db.test.ts` and `scripts/s12-chain-gate.ts` convention, asserting: tenant isolation, idempotency, autonomy path (gated and auto), audit-ledger uniformity, and the workstream's own invariants. The program is complete when all ten workstream gates plus W0's pass on `main`.

## Revision log

**2026-08-13 — after review.** Split W4a out of W4 (the OAuth authorization server was one sentence in W4 with no owner, no path allocation and no migration budget; `auth-service` has RS256 signing and JWKS but no `/authorize`, `/token`, client store or consent). Added `ads-agent/app/.well-known/` to W4's owned paths, since RFC 9728 derives the metadata path from the resource URI and it must be served from the origin root. Recorded the pre-existing ungated Google Ads MCP mutation tools as a W1/W2 obligation rather than leaving them implicit. Two W0 interfaces changed before freeze: `ToolDescriptor` gained `effect`/`scope`/`internalToolName`, and `ExecutionResult.error.class` gained `quota` with `retryAfterMs`.
