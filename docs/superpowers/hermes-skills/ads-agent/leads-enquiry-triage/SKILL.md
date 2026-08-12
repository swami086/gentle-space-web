---
name: leads-enquiry-triage
description: "Triage broker enquiries via context-MCP and queue requirement updates or message drafts for human approval — never send or execute."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [CRM, Proposals, MCP]
    category: crm
    related_skills: [verification-before-proposing]
---

# Leads Enquiry Triage

The **`leads`** Hermes profile reads enquiries through **context-mcp** (`:8768`) and may write
**only** via `create_proposal`. Every proposal becomes a `pending` row a human must approve at
`/proposals` before anything changes. You never send email, WhatsApp, or any outbound message.

## When to Use

Use when asked to triage a broker enquiry, extract or refine requirements, or draft a broker-facing
message for human review.

## Prerequisites

- **context-mcp** must be connected (tools such as `list_enquiries`, `get_enquiry`, `create_proposal`
  visible). If not, tell the user to run `docker compose up -d context-mcp` from the `ads-agent`
  directory and then `/reload-mcp`.
- Hermes env must provide `AGENT_INTERNAL_API_KEY`, `LEADS_ORG_ID`, and `ADS_AGENT_BASE_URL`
  (e.g. `http://host.docker.internal:3030`).

## Procedure

① **Mint a task token** — Hermes cannot mint tokens via MCP; call the ads-agent HTTP API:

```
POST {ADS_AGENT_BASE_URL}/api/internal/agent/task-token
Content-Type: application/json
x-agent-internal-key: $AGENT_INTERNAL_API_KEY

{ "orgId": "$LEADS_ORG_ID", "taskId": "<new-uuid>", "profile": "leads" }
```

Keep the returned `token` only in working memory for this turn — **never paste it into chat**.

② **Gather enquiry context** — pass `task_token` on every context-MCP call this turn:

- `list_enquiries` (e.g. filter by status such as `waiting`) — pick one enquiry to triage
- `get_enquiry` with the chosen `enquiry_id`
- `get_context_pack` with `entity: "enquiry"` and the same id — this is your grounding allowlist

③ **Optional supporting reads** — only when needed for the proposal:

- `search_spaces` / `get_space` — space matching for requirement updates
- `graph_query` — named graph traversals when the pack alone is insufficient
- `list_proposals` — check for existing pending proposals on this enquiry

④ **Verify before proposing** — invoke the spirit of `verification-before-proposing`: every concrete
claim in your rationale and payload must trace to a tool result from **this turn**. If you cannot
name the tool call that produced a fact, re-fetch it or drop the claim.

⑤ **Submit — never execute yourself.** Call `create_proposal` with:

- `kind`: **only** `enquiry.requirement_update` or `message.draft`
- `evidence`: non-empty array of **identifiers from the context pack** (UUIDs, node ids, artifact
  keys — never prose)
- `rationale`: broker-readable explanation of why this proposal is warranted now
- `payload`: structured diff or draft content appropriate to the kind

Example shapes (adapt to the enquiry):

```json
create_proposal({
  "task_token": "<minted-token>",
  "kind": "enquiry.requirement_update",
  "payload": { "enquiry_id": "<uuid>", "requirements": { "minDesks": 10, "corridor": "Bandra" } },
  "rationale": "Caller stated 10 desks in Bandra on the 2026-08-12 activity; pack id … confirms.",
  "evidence": ["<enquiry-uuid>", "<pack-row-id>"]
})
```

```json
create_proposal({
  "task_token": "<minted-token>",
  "kind": "message.draft",
  "payload": { "enquiry_id": "<uuid>", "channel": "email", "subject": "…", "body": "…" },
  "rationale": "Draft follow-up summarising matched spaces from search_spaces results.",
  "evidence": ["<enquiry-uuid>", "<space-uuid>"]
})
```

⑥ **Tell the user what happened.** Report the returned `proposalId` and that a human must approve it
at `/proposals` before anything is sent or applied. **Never send email or WhatsApp** — approval and
execution are human-only.

## Pitfalls

- **Never invent facts.** Every requirement, space detail, and timeline in your rationale must come
  from a context-MCP tool result this turn — no citing figures from memory or a previous session.
- **Do not call `get_campaign_performance`.** That tool is for the `performance` profile's ClickHouse
  analytical path and is not on the `leads` allowlist.
- **Do not call Google Ads `propose_change` from this skill.** Campaign changes belong to the
  `ads-agent-campaign-strategy` skill, not enquiry triage.
- **Empty evidence is rejected by the server** (`evidence_empty`). Every `evidence` entry must be an
  identifier present in the context pack, never free-text rationale.

## Verification

After calling `create_proposal`, confirm the tool returned a `proposalId` (a UUID). If it returned
an error instead (`invalid_kind`, `evidence_empty`, `evidence_not_identifier`, `not_found`), read
the message and fix the input rather than retrying blindly.
