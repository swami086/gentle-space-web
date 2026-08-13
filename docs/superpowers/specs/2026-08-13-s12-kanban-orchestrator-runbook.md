# S12 — Kanban orchestrator runbook

Date: 2026-08-13  
Status: operational  
Build step: **S12** ([`2026-08-12-build-sequence.md`](2026-08-12-build-sequence.md))  
Plan: [`2026-08-13-s12-kanban-orchestrator.md`](../plans/2026-08-13-s12-kanban-orchestrator.md)

Deterministic CI covers protocol + mint + `simulateLinkedChain` (`ads-agent/scripts/s12-chain-gate.ts`).
Full two-profile Hermes E2E remains **manual** (same posture as S10).

## Prerequisites

- ads-agent running with context-mcp and `AGENT_INTERNAL_API_KEY` set.
- Hermes agent container with API server enabled (`HERMES_API_SERVER_ENABLED=true`).
- Postgres enquiry row for the target org (for leads triage).
- **Never log raw task tokens or SHA-256 digests.**

## Hermes profiles

Create two Hermes profiles on the gateway host:

| Profile | Toolsets | Notes |
|---|---|---|
| `orchestrator` | `kanban`, … | Coordinates via `kanban_*` only; **no** `create_proposal`. Mint allowlist is read-only (`list_proposals`). |
| `leads` | `kanban`, context-mcp | Domain writes via `create_proposal` only; see [`leads-enquiry-triage`](../../hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md). |

Skills:

- [`orchestrator-decompose`](../../hermes-skills/ads-agent/orchestrator-decompose/SKILL.md)
- [`leads-enquiry-triage`](../../hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md) (Kanban child section)

## Board and dispatcher

- **Board id:** `gs-agents` (`GS_KANBAN_BOARD=gs-agents`).
- **Single dispatcher:** Hermes gateway owns Kanban dispatch (`kanban.dispatch_in_gateway: true`).
- ads-agent schedules seed + wake when `HERMES_WAKE=1`; **no** second Hermes cron for GentleSpace automation (S12-D1).

Every Kanban task must carry **`--tenant=<org-uuid>`** (soft tenant label). Hard isolation remains RLS via minted task tokens.

## ads-agent env (see `ads-agent/.env.example`)

```bash
HERMES_WAKE=1
HERMES_KANBAN_BIN=hermes          # or absolute path to Hermes CLI
GS_KANBAN_BOARD=gs-agents
AGENT_INTERNAL_API_KEY=<secret>
ORCHESTRATOR_ORG_ID=<org-uuid>    # tenant for orchestrator mint + board tasks
LEADS_ORG_ID=<org-uuid>             # same org when child runs leads profile
ADS_AGENT_BASE_URL=http://host.docker.internal:3030
```

Optional wake/seed CLI env:

- `HERMES_KANBAN_TASK` — Kanban task id for leads child runs (from dispatch context).

## Manual E2E gate

**Goal:** two agents complete one linked task chain; a **pending** proposal appears in `/proposals`.

1. **Seed root task** (stub logs command unless `HERMES_WAKE=1`):

   ```bash
   cd ads-agent
   npx tsx scripts/seed-orchestrator-task.ts \
     --org-id=<org-uuid> \
     --enquiry-id=<enquiry-uuid> \
     --idempotency-key=manual-e2e-1
   ```

2. **Confirm board** — root task on `gs-agents` with tenant = org UUID and outcome-oriented title (not “Analyse …”).

3. **Dispatch orchestrator** — gateway assigns `orchestrator` profile to the root task. Orchestrator skill:
   - Mints token (`profile: orchestrator`, `taskId` = Hermes Kanban task id).
   - Creates linked **leads** child with same tenant.
   - Comments typed JSON (`decompose`, `taint: false`).
   - Completes root task.

4. **Dispatch leads child** — gateway assigns `leads` to child task:
   - Mints token (`profile: leads`, `taskId` = child Kanban task id).
   - Reads enquiry via context-mcp; `create_proposal` with evidence IDs.
   - Comments typed JSON (`findings`, `taint: true`, `recordIds: [enquiryId]`).
   - Completes child task.

5. **Verify** — open ads-agent `/proposals`: one **pending** proposal for the enquiry; status must not auto-approve (tainted findings path stays human-reviewed).

6. **Deterministic gate (no Hermes):**

   ```bash
   cd ads-agent && npx vitest run scripts/s12-chain-gate.test.ts
   ```

## Abort criteria

**Refuse and stop** if any Kanban task is missing a tenant (`--tenant` / org UUID):

- Do not mint tokens for tasks without tenant metadata.
- Do not dispatch orchestrator or leads until tenant is set on root **and** child.
- Log the task id and board; fix tenant on the Hermes task before retrying.

Also abort if:

- Unknown profile requested at mint (`403 forbidden_profile`).
- Kanban comment is free prose (not valid `KanbanAgentMessage` JSON).
- `HERMES_WAKE=1` but `HERMES_KANBAN_BIN` unset when attempting live kanban invoke.

## Out of scope

- `performance` / `campaign` profiles (S14).
- Campaign UI Kanban (`components/pencil/KanbanBoard*`).
- Postgres Kanban mirror (state stays in Hermes `kanban.db`).
