# Ads-agent gate integrity + campaign dogfood — design

**Date:** 2026-09-18  
**Status:** approved for planning (Approach 1 dogfood + architecture harden from review)  
**Related:**  
- `2026-08-03-ads-automation-agent-design.md` (human gate)  
- `2026-08-07-google-ads-mcp-integration-design.md` (MCP boundary)  
- `2026-08-03-ads-agent-campaign-creation-design.md` (chat → proposal)  
- `2026-08-12-architecture-validation-report.md` (F-22 gate integrity)  
- Architecture review session 2026-09-18 (CONCERNS: MCP write surface)

## Problem

The product spine is sound: propose → human approve → schedule/undo → worker → execute → Google Ads MCP. Two classes of gaps block trustworthy dogfood and undercut the load-bearing claim “nothing spends without Approve”:

1. **System-boundary gap (P0):** `google-ads-mcp` registers live write tools (`create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`) on the same Streamable HTTP endpoint chat/Hermes can discover. Client-side allowlists protect *our* LLM path only. Any MCP client that can reach `:8766` can mutate Ads without a `proposals` row.
2. **Dogfood-path gaps (P1 / Approach 1):** `finalUrl` is not required for draft `ready`; preflight treats Google as healthy when env vars are set (even if MCP is down or OAuth `invalid_grant`); Approve → schedule → worker is easy to misread; Hermes mode does not update draft fields.

## Goals

1. **Wire-level gate integrity:** External/chat MCP clients cannot call Google Ads **write** tools. Only the ads-agent executor (and cycle read path via a read surface) can reach writes — and executor still only runs after an approved/scheduled proposal.
2. **Honest approve preflight:** Blocking checks include MCP reachability + a cheap authenticated probe (not env-var presence alone).
3. **Campaign create dogfood:** Bifrost chat or manual edit → `ready` (including non-empty `finalUrl`) → Create Proposal → Approve → after undo + `worker:proposals` → Search campaign on a **Google Ads test** customer, with failures visible.
4. **Hermes parity (P2):** Hermes campaign chat must persist SetupCard field updates the same way Bifrost chat does (or Hermes toggle is disabled until that lands — prefer implement).

## Non-goals

- Meta campaign create / Meta MCP migration  
- Full Approvals IA rename (`/approvals`)  
- Autonomy / auto-approve  
- Kind taxonomy rename migration (`pause` → `campaign.pause`) — document aliases only  
- Refreshing the user’s OAuth refresh token (operator action; plan documents the check)  
- Langfuse / context-mcp / ClickHouse hardening beyond what preflight needs  

## Decisions

### D1 — Dual MCP surfaces (same image, two Compose services)

| Surface | Port (local) | Tools registered | Who may call |
|---------|--------------|------------------|--------------|
| **Read** | `8766` (existing) | `list_campaign_performance`, `search_terms_report`, `list_accessible_customers` only | Chat, Hermes allowlists, cycle reads, health probes |
| **Write** | `8769` (new) | The four mutate tools + `propose_change` | ads-agent executor / connector write path only; bind still host-allowlisted; **not** advertised to Bifrost `tools` |

Implementation: `GOOGLE_ADS_MCP_SURFACE=read|write` (default `read` for safety if unset). `buildGoogleAdsMcpServer(surface)` registers the matching tool set. Compose: `google-ads-mcp` (read) + `google-ads-mcp-write` (write, `8769:8769`).

Env for ads-agent host:

- `GOOGLE_ADS_MCP_URL` → read (`http://localhost:8766/mcp`) — unchanged default  
- `GOOGLE_ADS_MCP_WRITE_URL` → write (`http://localhost:8769/mcp`)

`callGoogleAdsTool` gains an optional `surface: "read" | "write"` (default `read`). Connector write helpers pass `write`.

### D2 — Preflight connector health

Extend `getConnectorStatus()` / preflight:

- `googleAdsConfigured`: existing env-var boolean  
- `googleAdsReachable`: `listTools` (or `list_accessible_customers`) against **read** URL succeeds within timeout  

Approve **blocks** on `!configured || !reachable` for Google kinds (severity `block`). Soft-warn if credits low remains warn.

### D3 — Draft readiness requires `finalUrl`

`isDraftReady` requires `draft.finalUrl` non-empty, valid `http(s)` URL, and existing RSA/budget/keyword rules. Manual edit + chat paths already PATCH `finalUrl`.

### D4 — Schedule UX clarity (minimal)

Proposal detail already shows undo window. After successful approve API response, client must show explicit copy: status `scheduled`, countdown, “executes after undo window when `worker:proposals` is running”, and link/status for `executed`/`failed`. Fix any path that discards the approve JSON body without feedback (if still present).

### D5 — Hermes draft updates

When Hermes campaign stream completes with OpenUI SetupCard (or structured field payload), persist via the same `updateDraftFields` + `isDraftReady` status transition used by `/messages`. Prefer server-side Hermes campaign route writing drafts; if browser-only today, add a PATCH after parse — do not leave Create Proposal stuck on `chatting`.

## Architecture (target)

```text
Chat / Hermes / cycle READS
  → GOOGLE_ADS_MCP_URL (:8766 read-only tools)

Approve → schedule → worker:proposals → executeProposal
  → createFullGoogleCampaign / pause / budget / negative
  → GOOGLE_ADS_MCP_WRITE_URL (:8769 write tools)
  → Google Ads API

Bifrost (:8080) → Vertex — LLM only; never Ads mutate
```

## Success criteria

1. `listTools` on `:8766` returns **only** the three read tools.  
2. `listTools` on `:8769` returns write tools (+ `propose_change`); chat resolver still never advertises writes.  
3. Unit tests: read server rejects unknown write tool name (not registered); draft without `finalUrl` is not `ready`; preflight fails closed when read MCP is down.  
4. Operator can complete Google **test** create dogfood with stack up + valid refresh token (token refresh is manual prerequisite).  
5. Hermes mode can reach `ready` without manual-only edit.

## Risks

| Risk | Mitigation |
|------|------------|
| Dual URL misconfig → writes hit read server | Fail loud if write tool called against read URL; tests; `.env.example` comments |
| Compose only starts read service | `depends_on` / README; preflight fails approve |
| Breaking Hermes external configs that pointed at `:8766` for writes | Intended; Hermes must use `propose_change` on write URL or context-mcp `create_proposal` only |

## Implementation

See plan: `docs/superpowers/plans/2026-09-18-ads-agent-gate-integrity-dogfood.md`  
(Parallel Composer 2.5 subagent waves.)
