# S10 — First agent (`leads`) — design

Date: 2026-08-13
Status: approved (pending user review of this written spec)
Build step: **S10** ([`2026-08-12-build-sequence.md`](2026-08-12-build-sequence.md))
Maps to: agent topology Stage 2 ([`2026-08-12-agent-topology-design.md`](2026-08-12-agent-topology-design.md) §10)
Depends on: **S9 + S9a** on `main` (context MCP, task tokens, `create_proposal`, cost ceiling, OTLP/redact)
Related: Hermes container install ([`2026-08-10-hermes-agent-container-install-design.md`](2026-08-10-hermes-agent-container-install-design.md)); chat bridge is orthogonal (admin UI ↔ Hermes API)

## Problem

S9 proved the agent safety model by calling the context MCP directly. No Hermes profile yet reads enquiries and queues proposals. Without S10, brokers get no autonomous triage loop, and later agents (S12+) have no proven profile pattern.

## Goals

1. Run a Hermes profile named **`leads`** against the existing **context-mcp** (`:8768`).
2. Mint **task tokens** via a privileged ads-agent HTTP API (Hermes cannot use `agent_ro` to INSERT tokens).
3. Enable `leads` to propose **`enquiry.requirement_update`** and **`message.draft`** only, with non-empty **evidence IDs** from `get_context_pack`.
4. Pass a **manual E2E gate**: one pending proposal appears in the approval queue, not executed.
5. Leave a **cron/wake stub** for later scheduling without implementing Kanban (S12).

## Non-goals

- Kanban, `orchestrator`, or multi-agent task chains (S12).
- `performance` / `campaign` / `research` / `content` profiles (S14–S16).
- Executing or sending proposals (no email/WhatsApp send; human approval unchanged).
- Expanding app-data-MCP (`:8767`) to wrap context tools or mint tokens.
- Committing Hermes upstream into this repo; Hermes stays in `~/hermes-agent`.
- Production VM Hermes rollout.
- Live Langfuse Steps 7–8 (S9a deferred ops) — recommended before production agent traffic, not a code blocker for S10.

## Decisions (brainstorming 2026-08-13)

| # | Decision |
|---|---|
| D1 | Scope this cycle to **S10 only** (not S11–S17). |
| D2 | Runtime = **Hermes container** calling context-MCP (not an in-repo LLM worker). |
| D3 | Token mint = **ads-agent HTTP** `POST /api/internal/agent/task-token`. |
| D4 | Trigger = **manual** for the gate + **wake script stub** (no schedule yet). |
| D5 | Proposal kinds = both `enquiry.requirement_update` and `message.draft`. |
| D6 | Architecture approach = thin Hermes profile + mint API + existing context-MCP. |

## Architecture

```
Hermes (:8642, profile `leads`)
  │  POST /api/internal/agent/task-token
  ▼
ads-agent (owner pool → mintTaskToken)
  │  { token } once; never logged
  ▼
Hermes ──MCP──► context-mcp (:8768, agent_ro)
  │  task_token on every tool
  │  reads → get_context_pack → create_proposal
  ▼
adsagent.proposals (status=pending, proposed_by=leads)
```

**Safety invariants (unchanged from S9):**

- Tenant is derived **only** from the task token.
- `evidence` holds identifiers from the context pack, never prose.
- `agent_ro` never mints tokens and has no INSERT on proposals (only SECURITY DEFINER `agent_create_proposal`).
- Spans use `safeErrorCode` + no message bodies (S9a).

## Token mint API

**Route:** `POST /api/internal/agent/task-token`  
**Auth:** header `x-agent-internal-key` must equal env `AGENT_INTERNAL_API_KEY`.  
Distinct from auth-service `x-internal-api-key` / `AUTH_SERVICE_INTERNAL_API_KEY`.

**Request body:**

```json
{
  "orgId": "<uuid>",
  "taskId": "<string>",
  "profile": "leads",
  "ttlSeconds": 900
}
```

**Server rules:**

- Reject any `profile` other than `leads` in S10 (403).
- Ignore any client-supplied allowlist; set allowlist server-side.
- Default `ttlSeconds` to 900 if omitted; clamp to a documented max (e.g. 3600).
- Call existing `mintTaskToken()` from `ads-agent/mcp/context-server/task-token.ts` (owner `getPool()`).

**`leads` tool allowlist (fixed):**

```
list_enquiries, get_enquiry, get_context_pack,
search_spaces, get_space, list_proposals, graph_query,
create_proposal
```

Omit `get_campaign_performance` (ClickHouse analytical path for the `performance` profile).

**Response:** `{ "token": "<64 hex>" }`  
**Errors:** 401 bad/missing key · 400 validation · 403 profile · 500 mint failure (stable code only; never echo token material).

**Logging:** never log the raw token or its SHA-256 (agent spec §6).

## Hermes profile and skill

**MCP:** Add `context-mcp` → `http://host.docker.internal:8768/mcp` in `~/.hermes/config.yaml` (same Docker Desktop pattern as Google Ads / app-data). Ensure compose `CONTEXT_MCP_ALLOWED_HOSTS` already includes `host.docker.internal` (it does on `main`).

**Profile:** `leads` — enquiry triage, requirement extraction, message drafts. No Kanban assignment in S10.

**Skill (in-repo):** `docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md`

Required workflow:

1. Mint a token (`orgId` from Hermes env `LEADS_ORG_ID`, `taskId` = new UUID, `profile: leads`).
2. `list_enquiries` (e.g. waiting) → choose one → `get_enquiry` + `get_context_pack(entity: "enquiry", id)`.
3. Propose only `enquiry.requirement_update` or `message.draft`.
4. `evidence` = IDs present in the pack; rationale broker-readable; no invented facts.
5. Before `create_proposal`, re-check every concrete claim against tool results this turn (same iron law as `verification-before-proposing`).

**Hermes env (out of band):** `AGENT_INTERNAL_API_KEY`, `LEADS_ORG_ID`, ads-agent base URL (e.g. `http://host.docker.internal:3030`). Document in runbook / `.env.example` stubs without committing secrets.

**Not wired into `leads`:** Google Ads `propose_change` / campaign skills.

## Cron / wake stub

Add `ads-agent/scripts/wake-leads-agent.ts`:

- Accepts `orgId` and optional `enquiryId`.
- Documents the future path to invoke Hermes API.
- Default: print “not scheduled” and exit 0 unless `HERMES_WAKE=1`.
- **Do not** register node-cron in S10.

## Acceptance gate

Manual gate passes when all hold:

1. `context-mcp` listening on `:8768` with `AGENT_RO_DATABASE_URL` (no owner `DATABASE_URL` in that service).
2. Hermes can mint a token and call context-MCP tools.
3. One row in `adsagent.proposals` with `status = pending`, `proposed_by = 'leads'`, kind ∈ `{enquiry.requirement_update, message.draft}`, non-empty `evidence`, `executed_at` null.
4. Proposal visible in the existing admin approvals UI.
5. No send/execute occurred from the agent path.

## Testing

| Layer | What |
|---|---|
| Unit | Mint route: auth, profile lock, server-owned allowlist, validation |
| Integration (no Hermes) | Mint → InMemoryTransport context server → `create_proposal` (reuse S9 patterns) |
| Manual | Full Hermes E2E gate above |
| Compose | `context-mcp` service remains contract-tested (`deployment.test.ts`) |

## Error handling

| Failure | Behaviour |
|---|---|
| Bad mint key | 401; Hermes must not invent a token |
| Wrong profile | 403 |
| Token expired / tool not allowed | Existing MCP `token_*` errors |
| Empty evidence | Existing `evidence_empty` |
| Cross-tenant / missing enquiry | `not_found` |
| Ceiling exceeded | Existing S9a refusal + metering |

## Out of scope follow-ups

- S11 decision-engine diffs for requirement/message proposals.
- S12 Kanban dispatcher minting tokens per task automatically.
- Live Langfuse over-budget smoke before production traffic.

## Open questions (non-blocking)

None for implementation start. `LEADS_ORG_ID` for local gate is an ops choice (platform/internal org seed) documented at implement time.
