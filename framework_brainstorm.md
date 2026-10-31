# No agent framework on the spend path

* **Author:** swami086
* **Date:** 2026-10-30
* **Status:** Goldfish review complete. Does not replace [concepts_brief.md](concepts_brief.md) or [docs/designs/phase-1-listing-campaign-service.md](docs/designs/phase-1-listing-campaign-service.md).

## Overview

The listing service writes ad spend only through the existing proposal worker. Mastra, LangGraph, and the Claude Agent SDK stay off that path. The model writes copy and a short explanation. It does not choose Meta or Google calls, and it does not move money.

"Spend path" means the code that creates, pauses, switches on, or changes a budget on Meta or Google. Copy, the explanation, and the reply parser are not on that path.

The ceiling is the total the consultant approved for one listing. The kill switch stops every write except a stop. The allowlist is the list of Meta and Google calls the service is allowed to make.

## Analysis

Six reviewers read [framework_review.md](framework_review.md) and the Phase 1 design. All six agree an agent loop must not sit on a platform write. They do not agree that the current worker is already proven.

The worker today is a database timestamp and a 15-second poll. A due row is claimed with a lock and then run through a fixed switch: create, pause, budget change, and so on. There is no suspended graph and no model call in that file. Mastra's suspend-and-resume would replace that poll with a second store that can also say "approved." The design already refuses to resume a crashed build: mark it failed, archive the objects, and ask for a new approval. A framework whose default is to resume would reopen that choice.

What the review did not prove:

* No test shows what happens if the process dies after Meta has created three of five shares, or after switch-on but before the database records it. Refusing a framework does not make that state machine correct. The design's answer is still archive and re-approve, and that answer needs a test at each crash point.
* The daily share move is not built. Nothing says what happens if that job runs twice in one day. The move needs a "already moved today" check before it writes budgets. That check is arithmetic, not a workflow engine.
* Two writers can touch the same share: the daily move, and an approved lower ceiling. The design does not say which runs first.
* Tracing already exists in `ads-agent/lib/tracing/` and sends spans to Langfuse. The missing piece is one span on the proposal's life, from approval through the platform call. That is a call into code that is already there. It is not a reason to adopt a framework.
* A reader of the earlier note could think "framework" means only "let the model pick tools." Checkpointing the deterministic steps is a different feature. The code review says there is no partial run to checkpoint: the wait is a row, and the run is one switch. If the crash tests fail, the fix is still those tests and the archive rule, not a model with tools.

The planner script scored a supervisor with a file manager and a code executor. That output is discarded. It is not evidence for a second agent.

## Goals vs. Non-Goals

* **In-Scope Goals:** Keep platform writes in the proposal worker. Prove crash-then-archive with tests. Make the daily share move run at most once per listing per day. Record one trace per proposal. Name the order between a ceiling change and a share move.
* **Out-of-Scope Non-Goals:** Adopting Mastra, LangGraph, or the Claude Agent SDK for creates, pauses, switch-on, or budget changes. Resuming a half-built campaign. Letting a chat connector call Meta or Google except through the existing proposal insert. Merging the ad-spend ceiling with the existing agent-cost ceiling in `agent-cost.ts`. Copying this note into `concepts_brief.md`.

## Alternatives Weighed

* **Agent loop on the spend path.** Rejected. The executor is a closed switch. A loop would have to be fenced back into that same switch, and could skip the kill switch.
* **Mastra suspend/resume as the approval wait.** Rejected. The wait is already a row. A second store can disagree about approval. The design refuses resume after a crash.
* **LangGraph in Python beside this app.** Rejected for this service. It adds a second language for a poll that already works. That is a maintenance cost, not a proof the graph is unsound.
* **Claude Agent SDK for the copy step.** Not adopted. Copy already goes through the citation gate. The SDK was not compared line by line with that gate, and it is not required to ship Phase 1.
* **Checkpoint only the deterministic steps, no tool choice.** Not adopted now. There is no partial graph state. Revisit only if a crash test shows archive-and-re-approve cannot be made to hold.

## Key Decisions & Staging for Next Steps

The decision stands: no agent framework under platform writes.

Before implementation, the design doc records these rules, not a new runtime:

1. Crash tests for each point in claim, paused build, read-back, switch-on, and archive.
2. The share move refuses a second run for the same listing on the same day.
3. A ceiling change and the daily move do not run on the same listing in the same cycle. The ceiling change wins that cycle.
4. One trace id from proposal creation through the platform call, using the tracing code already in the repo.

Deploy the new proposal shape only when no proposal is scheduled, executing, or inside its undo window. Do not run the down migration of the share table after a share has a live campaign id.

The open question from the research note is closed. Mastra's suspend does not fix a failure the worker has that a smaller change does not. The smaller changes are the rules above. They were written into `design_draft.md` and `docs/designs/phase-1-listing-campaign-service.md` on 2026-10-30. The first build runs on the owner's laptop against that same commit. A framework is not what makes localhost able to call Meta or Google.
