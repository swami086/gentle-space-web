# S14 — `performance` and `campaign` agents — design

Date: 2026-08-13  
Status: approved (plan written; await execution choice)
  
Build step: **S14** ([`2026-08-12-build-sequence.md`](2026-08-12-build-sequence.md))  
Maps to: agent topology Stage 4 ([`2026-08-12-agent-topology-design.md`](2026-08-12-agent-topology-design.md) §4, §10)  
Depends on: **S9–S13** on local `main` (context MCP, task tokens, ClickHouse `get_campaign_performance`, Kanban/orchestrator pattern, decision preflight E2 available for campaign drafts)  
Related: S10 leads design, S12 Kanban runbook, Hermes Google Ads MCP (`:8766`)

## Problem

S10/S12 proved Hermes profiles can mint tokens, read via context-MCP, and queue pending proposals. No profile yet owns **analytical spend reads** or **campaign create/budget** proposals. Without S14, brokers lack autonomous performance review and campaign drafting that are required to use the **ClickHouse replica** (not the Postgres OLTP primary) for analytics.

## Goals

1. Ship Hermes profiles **`performance`** and **`campaign`** against context-MCP (`:8768`) and, for option‑3 enrichment, Google Ads MCP (`:8766`).
2. Extend mint API / `profiles.ts` so both profiles receive **server-owned** tool allowlists (client cannot invent tools).
3. Enforce proposal kinds:
   - `performance` → `campaign.pause` only  
   - `campaign` → `campaign.create` | `campaign.budget_change` only  
4. Both allowlists include **`get_campaign_performance`** (ClickHouse). Google Ads read tools are available on Hermes for enrichment; they do **not** replace the replica gate.
5. Pass the **S14 gate**: live Hermes two-profile E2E against **local Docker ClickHouse** proves analytics came from the replica path; at least one pending spend-related proposal appears; human approval unchanged.
6. Leave wake stubs (`HERMES_WAKE`) consistent with S10/S12.

## Non-goals

- Auto-approve / execute / spend on ad platforms.
- Meta Ads MCP (Google Ads MCP only for option 3 in this cycle).
- `research` / `content` agents (S16).
- CMS (S17).
- New Postgres migrations (reuse S9 tools + existing CH table/views).
- Replacing the decision-cycle worker; agents propose, humans approve.
- Making Google Ads MCP required for the **replica** half of the gate (CH-only still proves “not primary”; full option‑3 smoke wants Ads when configured).

## Decisions (brainstorming 2026-08-13)

| # | Decision |
|---|---|
| D1 | Scope = **full S14** — both `performance` and `campaign`. |
| D2 | Proposal kinds = topology set (pause / create / budget_change). |
| D3 | Gate = **live Hermes two-profile E2E** against local Docker ClickHouse (not simulated-only). |
| D4 | Both profiles may call `get_campaign_performance`. |
| D5 | Architecture = **option 3**: thin Hermes profiles (S10/S12 pattern) **plus** Google Ads MCP enrichment. |
| D6 | No new PG migrations. |
| D7 | Stale CDC lag refuse for create/budget remains in `create_proposal` (`STALE_LAG_SECONDS`); pause is not a spend-*changing* kind for that gate. |

## Architecture

```
Hermes profiles: performance + campaign
        │
        ├─ POST /api/internal/agent/task-token  →  ads-agent (owner mint)
        │
        ├─ context-MCP (:8768, agent_ro)
        │     • get_campaign_performance  →  ClickHouse (AGENT_CLICKHOUSE_*)  ← S14 gate
        │     • get_context_pack / list_proposals / graph_query / …
        │     • create_proposal → adsagent.proposals (pending)
        │
        └─ Google Ads MCP (:8766)  [option 3]
              • list_campaign_performance, search_terms_report, list_accessible_customers
              • enrich drafts only — never propose_change / never spend
```

**Safety invariants (unchanged from S9+):**

- Tenant only from task token.
- `evidence` = context-pack IDs, never prose.
- Spend-changing kinds refuse when CDC lag &gt; threshold.
- Spans: no message bodies (S9a).
- Never log raw task tokens.

## Tool allowlists (server-owned)

Shared analytical + proposal surface (both profiles):

```
get_campaign_performance, get_context_pack, list_proposals,
graph_query, create_proposal
```

**`performance` add:** campaign/list reads needed for pause targeting if already exposed on context-MCP (e.g. pack entity `campaign`); **omit** enquiry triage tools unless already required for pack. Do **not** include leads-only tools.

**`campaign` add:** `search_spaces` / `get_space` if corridor drafting needs them (same as leads subset for spaces); still **no** enquiry write kinds.

**Hermes-side (not mint allowlist):** Google Ads MCP toolsets configured on the profile in `~/.hermes/config.yaml` — separate from context-MCP allowlist.

Kind enforcement: skills + tests assert `performance` only emits `campaign.pause`; `campaign` only emits create/budget_change. Server already validates kind ∈ agent vocabulary; optional profile→kind restriction can be added in mint/create path if cheap — prefer skill + gate tests first, server lock if abuse risk shows up.

## Hermes skills (in-repo)

| Skill | Profile | Workflow |
|---|---|---|
| `performance-review` | `performance` | Mint → `get_campaign_performance` (required) → optional Ads MCP peek → `get_context_pack` → `create_proposal(kind: campaign.pause)` with evidence IDs |
| `campaign-draft` | `campaign` | Mint → `get_campaign_performance` (required before propose) → optional Ads MCP → pack → `create_proposal(kind: campaign.create \| campaign.budget_change)` with evidence; respect stale refuse |

Both skills must re-check claims against tool results this turn (`verification-before-proposing` iron law).

## Wake stubs

- `ads-agent/scripts/wake-performance-agent.ts`
- `ads-agent/scripts/wake-campaign-agent.ts`

Same posture as leads/orchestrator: log-only unless `HERMES_WAKE=1`. Env: `PERFORMANCE_ORG_ID` / `CAMPAIGN_ORG_ID` (may equal `LEADS_ORG_ID` for local), `AGENT_INTERNAL_API_KEY`, `ADS_AGENT_BASE_URL`, ClickHouse agent vars already required by context-mcp.

## Acceptance gate (S14)

Live gate passes when all hold:

1. ClickHouse reachable from context-mcp (`AGENT_CLICKHOUSE_URL`); `get_campaign_performance` returns rows for the test tenant (seed CH data if empty).
2. Hermes profiles `performance` and `campaign` can mint tokens and call context-MCP.
3. A call path for performance metrics uses **ClickHouse HTTP**, not a Postgres scan of `performance_snapshots` / OLTP aggregates (asserted in unit tests + observed in E2E).
4. At least one row in `adsagent.proposals` with `status = pending`, `proposed_by ∈ {performance, campaign}`, kind ∈ `{campaign.pause, campaign.create, campaign.budget_change}`, non-empty `evidence`, `executed_at` null.
5. Proposal visible in admin approvals UI; no execute/send from the agent path.
6. **Option‑3 smoke:** when Google Ads MCP is up, profile can call a read tool without proposing platform changes. If Ads is down, document skip — CH path still required for gate items 1–5.

## Testing

| Layer | What |
|---|---|
| Unit | Allowlists; profile mint lock; `getCampaignPerformance` uses `AGENT_CLICKHOUSE_URL`; kind restrictions in skills/helpers |
| Unit / integration | Stale refuse for create/budget; pause allowed without spend-lag refuse |
| Manual | Full Hermes + Docker CH E2E (and Ads when available) |
| Runbook | `docs/superpowers/specs/2026-08-13-s14-performance-campaign-agents-runbook.md` |

## Error handling

| Failure | Behaviour |
|---|---|
| Bad mint key | 401 |
| Unknown / wrong profile | 403 |
| CH unset / down | Tool error; agent must not fall back to Postgres analytics |
| Stale CDC lag on create/budget | `stale_data_refusal` |
| Empty evidence | `evidence_empty` |
| Google Ads MCP down | Soft-fail enrichment; continue with CH-only for replica gate |

## Out of scope follow-ups

- Orchestrator auto-linking performance→campaign Kanban parents (nice-to-have; wake stubs suffice for S14).
- Meta connector for performance agents.
- Production VM Hermes rollout.

## Open questions (non-blocking)

- Exact CH seed dataset for empty local mirrors — document in runbook at implement time.
- Server-side profile→kind allowlist in `create_proposal`: **deferred** — S14 relies on skills + tests; add server lock only if abuse appears.
