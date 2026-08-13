---
name: campaign-draft
description: "Draft campaign create or budget-change proposals via context-MCP and ClickHouse analytics — never execute or call Ads write tools."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Google Ads, Proposals, MCP, ClickHouse]
    category: marketing
    related_skills: [verification-before-proposing, ads-agent-campaign-strategy]
---

# Campaign Draft

The **`campaign`** Hermes profile reads spend analytics through **context-mcp** (`:8768`) — including
the ClickHouse replica via `get_campaign_performance` — and may write **only** via `create_proposal`.
Every proposal becomes a `pending` row a human must approve at `/proposals` before any campaign is
created or budget is changed. You never execute spend, pause live campaigns, or call Google Ads write
tools.

For broader Google Ads strategy narratives (read tools + `propose_change`), see
`ads-agent-campaign-strategy` as **reference only** — this skill uses context-MCP proposals, not Ads
MCP writes.

## When to Use

Use when asked to draft a new corridor campaign, propose a budget change for an existing campaign, or
prepare spend-related changes for human approval based on replica analytics.

## Prerequisites

- **context-mcp** must be connected (tools such as `get_campaign_performance`, `get_context_pack`,
  `create_proposal`, `search_spaces`, `get_space` visible). If not, tell the user to run
  `docker compose up -d context-mcp` from the `ads-agent` directory and then `/reload-mcp`.
- Hermes env must provide `AGENT_INTERNAL_API_KEY`, `CAMPAIGN_ORG_ID`, and `ADS_AGENT_BASE_URL`
  (e.g. `http://host.docker.internal:3030`).
- ClickHouse agent vars (`AGENT_CLICKHOUSE_URL`, etc.) must be configured on context-mcp — analytics
  come from the replica, not Postgres OLTP.
- **Google Ads MCP** (`:8766`) is optional enrichment only. When configured, restrict Hermes
  `tools.include` to read tools only (see step ③).

## Procedure

① **Mint a task token** — Hermes cannot mint tokens via MCP; call the ads-agent HTTP API:

```
POST {ADS_AGENT_BASE_URL}/api/internal/agent/task-token
Content-Type: application/json
x-agent-internal-key: $AGENT_INTERNAL_API_KEY

{ "orgId": "$CAMPAIGN_ORG_ID", "taskId": "<new-uuid>", "profile": "campaign" }
```

Keep the returned `token` only in working memory for this turn — **never paste it into chat**.

② **Required: fetch replica analytics** — pass `task_token` on every context-MCP call this turn.
**Call `get_campaign_performance` before any proposal.** Do not skip this step; do not propose from
memory, Ads MCP alone, or Postgres aggregates.

- `get_campaign_performance` — ClickHouse spend/clicks/conversions for the tenant (required gate)
- If the tool errors (CH down, misconfigured), stop and report — do not invent numbers or proceed to
  `create_proposal`.

③ **Optional supporting reads** — only when needed for the draft:

- `get_context_pack` with `entity: "campaign"` (or corridor/space entity as appropriate) — grounding
  allowlist for evidence ids
- `search_spaces` / `get_space` — corridor drafting, space inventory, location targeting context
- `graph_query` — named graph traversals when the pack alone is insufficient
- `list_proposals` — check for existing pending create/budget proposals on the same target

**Optional Google Ads MCP reads** (enrichment only — never required for the replica gate):

- `list_campaign_performance`
- `search_terms_report`
- `list_accessible_customers`

**Never call Google Ads write tools**, including:

- `propose_change`
- `create_campaign`
- `pause_campaign`
- `update_campaign_budget`
- `add_negative_keyword`

If Ads MCP is down, continue with ClickHouse + context-mcp only.

④ **Verify before proposing** — invoke the spirit of `verification-before-proposing`: every spend
figure, corridor name, campaign id, and budget amount in your rationale and payload must trace to a
tool result from **this turn** (`get_campaign_performance`, pack, spaces, or an optional Ads read).
If you cannot name the tool call that produced a fact, re-fetch it or drop the claim.

⑤ **Submit — never execute yourself.** Call `create_proposal` with:

- `kind`: **only** `campaign.create` or `campaign.budget_change`
- `evidence`: non-empty array of **identifiers from the context pack** (UUIDs, node ids, artifact
  keys — never prose)
- `rationale`: broker-readable explanation grounded in replica analytics and corridor context
- `payload`: structured create spec or budget delta appropriate to the kind

Example shapes (adapt to the corridor/campaign):

```json
create_proposal({
  "task_token": "<minted-token>",
  "kind": "campaign.create",
  "payload": {
    "corridor": "Bandra",
    "dailyBudgetMicros": 50000000,
    "spaceIds": ["<space-uuid>"]
  },
  "rationale": "get_campaign_performance shows under-indexed spend in Bandra corridor; search_spaces returned 3 active listings.",
  "evidence": ["<pack-row-id>", "<space-uuid>"]
})
```

```json
create_proposal({
  "task_token": "<minted-token>",
  "kind": "campaign.budget_change",
  "payload": {
    "campaign_id": "<uuid>",
    "dailyBudgetMicros": 75000000
  },
  "rationale": "Replica 7d ROAS below target on campaign …; current budget from get_campaign_performance row ….",
  "evidence": ["<campaign-uuid>", "<pack-row-id>"]
})
```

⑥ **Handle stale refuse — stop and report.** If `create_proposal` returns `stale_data_refusal`, CDC
lag exceeds the server threshold for spend-changing kinds. **Do not retry with invented numbers.**
Tell the user replication is stale, report the error code, and wait for fresh data (re-run CDC /
replicate) before drafting again.

⑦ **Tell the user what happened.** Report the returned `proposalId` and that a human must approve it
at `/proposals` before any campaign is created or budget changes on platform. **Never execute spend**
— approval and execution are human-only.

## Pitfalls

- **Never skip `get_campaign_performance`.** Replica analytics are required before every proposal;
  Ads MCP reads do not replace the ClickHouse gate.
- **Never invent facts.** Every budget, spend, and corridor claim must come from a tool result this
  turn — no citing figures from memory or a previous session.
- **Do not call Google Ads write tools** — especially `propose_change`. Platform mutations belong to
  human approval via context-MCP `create_proposal`, not Ads MCP writes. See `ads-agent-campaign-strategy`
  only as a reference for read-tool patterns; do not follow its `propose_change` submission path here.
- **Do not emit `campaign.pause`.** Pause proposals belong to the `performance` profile / `performance-review`
  skill, not campaign drafting.
- **Do not emit enquiry kinds** (`enquiry.requirement_update`, `message.draft`) — those belong to
  `leads-enquiry-triage`.
- **Empty evidence is rejected by the server** (`evidence_empty`). Every `evidence` entry must be an
  identifier present in the context pack, never free-text rationale.
- **`stale_data_refusal` is final for this turn.** Do not guess lag seconds or substitute Ads MCP
  numbers when the server refuses a spend-changing proposal.

## Verification

After calling `create_proposal`, confirm the tool returned a `proposalId` (a UUID). If it returned
an error instead (`invalid_kind`, `evidence_empty`, `evidence_not_identifier`, `stale_data_refusal`,
`not_found`), read the message and fix the input or stop — do not retry blindly.
