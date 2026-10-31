# Goldfish brainstorm: frameworks vs. the existing spend path

Mode: BRAINSTORM. Scope read: `ads-agent/package.json`, `ads-agent/scripts/run-proposal-undo-worker.ts`, `ads-agent/lib/executor/execute.ts`, `ads-agent/lib/db/proposals.ts` (just the claim query), plus `framework_review.md` and `docs/designs/phase-1-listing-campaign-service.md`.

## What the code already does today

* **`package.json`** has no Mastra, LangGraph, Vercel AI SDK, OpenAI Agents SDK, or Claude Agent SDK. It does have `@modelcontextprotocol/*` packages, but those back the two private tool servers (`mcp/google-ads-server`, `mcp/app-data-mcp-server`), not an agent loop in the spend path. `framework_review.md`'s claim that no framework is present is correct as of this read.
* **The wait is a database column, not a framework feature.** `proposals` has an `undo_until` timestamp. `claimDueScheduledProposals` runs `SELECT ... WHERE status = 'scheduled' AND undo_until <= now() ... FOR UPDATE SKIP LOCKED`, flips the row to `executing`, cross-tenant, one transaction per org. `run-proposal-undo-worker.ts` runs that claim on a 15-second `node-cron` tick (`DEFAULT_SCHEDULE = "*/15 * * * * *"`), then calls `executeProposal` for each claimed row and counts executed/failed. There is no suspended process, no checkpoint, no resumable graph state — the "wait" is just a row sitting at `status='scheduled'` until its timestamp passes and a poller notices. Mastra's suspend/resume would replace a boring polling loop with a stateful workflow engine for a problem that doesn't need statefulness: nothing is suspended mid-execution, there's no partial progress to resume.
* **`execute.ts` is a closed switch statement, not a tool-calling loop.** `executeProposal` dispatches on `proposal.kind` through `executableProposalKind`: `create_campaign`, `pause`, `budget_change`, `add_negative_keyword`, `campaign_strategy` (no-op). Each branch calls one fixed connector function (`createMetaCampaign`, `pauseGoogleCampaign`, `updateMetaCampaignBudget`, etc.) with a payload already stored on the proposal row. There is no model call anywhere in this file, no tool selection, no loop — a `default` branch throws rather than falling through silently. This is the "closed list of platform writes" the design doc wants, already built. An agent loop (Claude Agent SDK, LangGraph, Mastra's agent mode) would reintroduce the thing this file was written to avoid: a runtime decision about which call to make, which then has to be re-constrained back down to this same fixed list via tool guards — i.e., rebuilding `execute.ts` a second time underneath the framework.

## What the design doc asks for that does not exist yet

This matters for the brainstorm because the framework question gets asked against code that is *already past* what a framework would add, but *short of* what the Phase 1 design assumes is already robust:

* **No share-budget model yet.** `execute.ts`'s `budget_change` case edits one `campaignId` to one `newDailyBudgetInr`. There is no concept of shares, no sum-equals-ceiling invariant, no floor-at-spend-so-far check. The design doc's "deterministic sum check" (share budgets always summing to the approved ceiling) is described as the Phase 1 replacement for this, not something `execute.ts` does today.
* **No `lib/monitor/reallocate.ts`.** The directory doesn't exist. The in-ceiling move job the design doc calls item #7 is unbuilt. So right now there is no unattended spend-moving code at all — today's gap isn't "a framework could move budget safely," it's "nothing moves budget without a human-initiated `budget_change` proposal that still goes through the same approval/undo/execute path as `create_campaign` or `pause`."
* **No paused-build/read-back/switch-on sequence.** `executeCreateCampaign` creates and activates in one call (`markCampaignActive` right after the connector call). The two-phase build-paused-then-switch-on flow in the design doc (item #6) isn't in this file yet.

So the honest framing: the spend path today is deterministic and closed (good, no framework needed there), but it's also simpler than the design assumes — the sum-check and reallocation logic the design leans on as the safety mechanism is still to be written. A framework wouldn't fill that gap either; it's a straightforward addition to `execute.ts` and a new `reallocate.ts` module, both plain arithmetic over DB rows.

## Any real gap a framework would fill

None found in the spend path itself. The closest candidate is tracing/observability across the fixed pipeline (intake → planner → drafter → rule check → approval → executor → monitor), which `framework_review.md` already concedes can be "a span around the existing worker" — i.e., OpenTelemetry instrumentation of the existing cron tick and `executeProposal` call, not a reason to adopt an orchestration runtime. Nothing read in `execute.ts`, the worker script, or the claim query shows multi-step reasoning, dynamic tool selection, or resumable long-running state that a graph/agent runtime is built for.

## Observability gaps worth flagging regardless of the framework question

1. **Severity: Major**
   **Dimension:** Observability & Operational SRE Debuggability
   **Operational Risk:** `runProposalUndoTick` logs `console.error` with `proposalId`/`orgId`/`error` on a per-item try/catch, and a summary line on batch completion — but there's no trace/span correlating a single proposal's full lifecycle (approval → `scheduled` → claimed → `executing` → `executed`/`failed`) across the inbound route, the cron tick, and the connector call. An oncall engineer debugging "consultant says campaign never went live" has to manually join console logs by `proposalId` across three different processes (API route, worker process, connector).
   **Mitigation Requirement:** A single trace/span ID generated at proposal creation, propagated through `executeProposal` and into the Meta/Google connector calls, so one trace shows the full path including which connector call failed.

2. **Severity: Major**
   **Dimension:** Observability & Operational SRE Debuggability
   **Operational Risk:** The design's planned sum-check and reallocation job (`reallocate.ts`) has no logging/alerting requirement specified beyond "texts the failure" to the consultant. A silent invariant violation (share sum drifting from ceiling due to a race or a partial platform write) has no stated detection path other than a human noticing the wrong ad spend.
   **Mitigation Requirement:** The Concepts Brief/PRD should require an assertion or metric that fires when stored share-budget sums diverge from the stored ceiling, independent of the consultant-facing text.

3. **Severity: Nit**
   **Dimension:** Observability & Operational SRE Debuggability
   **Operational Risk:** `claimDueScheduledProposals` claims are cross-tenant in one query but execute per-org in separate transactions; a failure in one org's `executeProposal` is caught and counted but the batch-level log line (`claimed X, executed Y, failed Z`) doesn't include which org or proposal failed — that detail is only in the per-item `console.error`, which could be lost if log aggregation doesn't correlate the two lines.
   **Mitigation Requirement:** Include failed proposal/org IDs in the batch summary log line, not just the count.
