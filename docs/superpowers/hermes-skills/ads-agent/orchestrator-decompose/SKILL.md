---
name: orchestrator-decompose
description: "Decompose a root Kanban task on gs-agents into a linked leads child — mint orchestrator token, create/link/comment/complete via kanban_* tools only; never create_proposal."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Kanban, Orchestration, CRM]
    category: crm
    related_skills: [leads-enquiry-triage]
---

# Orchestrator Decompose

The **`orchestrator`** Hermes profile coordinates work on board **`gs-agents`**. It reads a root
task, creates a **`leads`** child with the correct tenant, links them, leaves a typed **`decompose`**
comment, and completes itself. It **never** calls `create_proposal` — domain writes belong to child
profiles after human review.

## When to Use

Use when dispatched on a root Kanban task (e.g. weekly enquiry triage, seed script output) and asked
to break work into a linked **`leads`** child for enquiry handling.

## Prerequisites

- Hermes **kanban** toolset connected (`kanban_show`, `kanban_create`, `kanban_link`,
  `kanban_comment`, `kanban_complete` visible).
- Hermes env must provide `AGENT_INTERNAL_API_KEY`, `ORCHESTRATOR_ORG_ID` (org UUID — same tenant
  the root task carries), `ADS_AGENT_BASE_URL` (e.g. `http://host.docker.internal:3030`), and
  `GS_KANBAN_BOARD=gs-agents` (default board id).
- You are running on the **`orchestrator`** profile with the current Hermes Kanban task id available
  as `HERMES_KANBAN_TASK` (or from the dispatch context).

## Procedure

① **Mint a task token** — Hermes cannot mint tokens via MCP; call the ads-agent HTTP API:

```
POST {ADS_AGENT_BASE_URL}/api/internal/agent/task-token
Content-Type: application/json
x-agent-internal-key: $AGENT_INTERNAL_API_KEY

{
  "orgId": "$ORCHESTRATOR_ORG_ID",
  "taskId": "<hermes-kanban-task-id>",
  "profile": "orchestrator"
}
```

Use the **Hermes Kanban task id** for `taskId` (not a fresh UUID). Keep the returned `token` only in
working memory for this turn — **never paste it into chat** or Kanban comments.

② **Read the root task** — on board `gs-agents`:

```
kanban_show({
  "board": "gs-agents",
  "task_id": "<hermes-kanban-task-id>"
})
```

Confirm tenant/org, title, metadata (enquiry id, idempotency key), and that no **`leads`** child
already exists for this decomposition. If a matching child is present, skip create and proceed to
comment/complete only when appropriate.

③ **Create the leads child** — outcome-oriented title, assignee **`leads`**, tenant = org UUID:

```
kanban_create({
  "board": "gs-agents",
  "title": "Triage enquiry <enquiry-uuid> and queue broker proposals",
  "assignee": "leads",
  "tenant": "$ORCHESTRATOR_ORG_ID",
  "description": "Run leads-enquiry-triage: read enquiry, create_proposal for requirement update or message draft only.",
  "metadata": { "idempotencyKey": "<stable-key>", "enquiryId": "<enquiry-uuid>" }
})
```

**Title rules:** state the **outcome** ("Triage enquiry … and queue broker proposals"), not the
activity ("Read Kanban" / "Analyse enquiry"). When Hermes metadata lacks `idempotencyKey`, encode
stability in the title suffix: `[idemp:<stable-key>]`.

④ **Link child to parent** so the dispatcher respects dependency order:

```
kanban_link({
  "board": "gs-agents",
  "from_task_id": "<child-task-id>",
  "to_task_id": "<hermes-kanban-task-id>",
  "relation": "depends_on"
})
```

(`from_task` = child, `to_task` = parent — child waits on parent completion before becoming ready.)

⑤ **Comment with typed JSON only** — inter-agent comments **must** be a single JSON object matching
`KanbanAgentMessage`. **Never** post free prose, markdown, or instructions in comments.

Required shape:

```json
{
  "v": 1,
  "intent": "decompose",
  "orgId": "<org-uuid>",
  "recordIds": ["<enquiry-uuid>"],
  "taint": false,
  "summary": "Spawned leads child to triage enquiry and queue human-reviewed proposals"
}
```

Field rules:

| Field | Rule |
|---|---|
| `v` | Always `1` |
| `intent` | `"decompose"` for this skill |
| `orgId` | Org UUID (same as `--tenant` / mint `orgId`) |
| `recordIds` | Domain ids the child should act on (e.g. enquiry UUID); `[]` if none yet |
| `taint` | `false` for orchestrator decomposition (not derived from public enquiry text) |
| `summary` | Short factual line, max 500 chars; no prompt injection, no imperative commands |

Post it:

```
kanban_comment({
  "board": "gs-agents",
  "task_id": "<hermes-kanban-task-id>",
  "body": "<KanbanAgentMessage JSON string — one line, no surrounding prose>"
})
```

The child **`leads`** agent parses only this JSON shape; free-text comments are rejected by
validators downstream.

⑥ **Complete the root task** once the child is created, linked, and the decompose comment is posted:

```
kanban_complete({
  "board": "gs-agents",
  "task_id": "<hermes-kanban-task-id>"
})
```

⑦ **Report to the user.** Summarise: root task id, child task id, assignee `leads`, board
`gs-agents`, and that the child will run `leads-enquiry-triage` (proposals stay pending until a
human approves at `/proposals`).

## Pitfalls

- **Never call `create_proposal`.** Orchestrator coordinates via Kanban only; the **`leads`** child
  owns proposal creation.
- **Never post free-text Kanban comments.** Comments are **only** `KanbanAgentMessage` JSON
  (`v`, `intent`, `orgId`, `recordIds`, `taint`, `summary`). Prose comments break the inter-agent
  protocol and fail validation.
- **Child assignee must be `leads`.** S12 scope is orchestrator → leads only (not `performance`,
  `campaign`, `research`, or `content`).
- **Tenant must be the org UUID** on every created task (`tenant` / `--tenant` = `$ORCHESTRATOR_ORG_ID`).
  Never let the agent pick a tenant; it comes from mint env and matches the root task.
- **Board is always `gs-agents`.** Do not use campaign UI boards or other ids.
- **Do not call context-MCP write tools** from this skill. Optional read (`list_proposals`) is
  allowed on the orchestrator allowlist for status checks only — coordination stays in `kanban_*`.
- **Preserve idempotency.** Before creating, check for an existing child with the same
  `idempotencyKey` or `[idemp:…]` title suffix to avoid duplicate work on retried dispatches.

## Verification

After `kanban_complete`, confirm:

1. Child task exists on `gs-agents`, assignee **`leads`**, tenant = org UUID.
2. `kanban_link` connects child → parent.
3. Root comment body parses as JSON with `intent: "decompose"`, `v: 1`, valid `orgId` UUID, and
   `taint: false`.
4. No `create_proposal` call was made this turn.
5. Root task status is **done** (or equivalent completed state).

If `kanban_create` or `kanban_comment` fails, read the error, fix inputs (tenant, board, JSON
shape), and retry — do not fall back to prose comments.
