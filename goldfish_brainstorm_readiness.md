# Goldfish — Implementation Readiness, Mode: BRAINSTORM

Read: `implementation-readiness.md` persona, `tool_access.md`, `framework_review.md`, and the "Parallel implementation" section of `docs/designs/phase-1-listing-campaign-service.md`. Read-only. `concepts_brief.md` not touched.

Mode is BRAINSTORM, so this is scored on two axes only: migration/schema compatibility, and rollout/rollback safety. Not a line-by-line actionability audit.

---

## A. If the hypothesis is accepted — no Mastra/LangGraph/Claude Agent SDK under the spend path

1. **Severity:** Blocker
   **Dimension:** Rollout & Rollback Safety
   **Compatibility Hazard:** The hypothesis's own mitigation — "tracing can wrap the worker" — has no file behind it. The 21 target files and 6 waves in the design doc contain zero tracing/observability task. Nothing names which span wraps `execute.ts`, what gets recorded, or where it's read. The argument against needing a framework's built-in tracing is "we can add our own," but "our own" is not in the plan.
   **Migration Requirement:** Add a tracing target file to the design doc (what wraps the executor, what a span records — proposal id, connection id, share id, platform, write outcome) before this is buildable, or drop the tracing claim from the hypothesis.

2. **Severity:** Blocker
   **Dimension:** Migration & Schema Compatibility
   **Compatibility Hazard:** Migrations 113/114 and the `proposals.ts`/`types.ts` rewrite change the proposal shape from one ceiling to a ceiling-plus-equal-shares model. The doc says nothing about proposals already sitting in the table before this ships — specifically any Gentle Space proposal that is scheduled, approved, or inside its undo window at deploy time. The old executor and the new share-reading executor cannot both be correct about the same in-flight row.
   **Migration Requirement:** State explicitly: deploy only when the proposal queue is empty, or write a compatibility shim that reads a pre-migration proposal as a single implicit share. One of these has to be in the doc, not assumed by the implementer.

3. **Severity:** Major
   **Dimension:** Rollout & Rollback Safety
   **Compatibility Hazard:** Removing the shared environment-variable login ("removed before a second customer exists") is a live cutover on a system that is already spending money for Gentle Space. No file or step describes the cutover order — backfill a `connections` row from the current env vars, verify a write succeeds through the new path, then delete the env var — versus a flag-day swap that can go wrong mid-write with no fallback.
   **Migration Requirement:** Add the cutover sequence (backfill → verify → delete) as an explicit step, not implied by "before any second customer."

4. **Severity:** Major
   **Dimension:** Rollout & Rollback Safety
   **Compatibility Hazard:** Two independent writers can touch the same share-budget row: the daily `reallocate.ts` move and an approved lower-ceiling change (which "scales shares down in proportion," per the rules.ts item). If both land in the same daily cycle, the doc does not say which runs first, or whether the proportional scale-down reads shares before or after that day's reallocation. The sum-equals-ceiling invariant depends on this ordering and it is not written down anywhere.
   **Migration Requirement:** Name the lock or ordering rule (e.g., ceiling changes always precede reallocation in the cycle, or reallocation is skipped the cycle a ceiling change lands) before `cycle.ts` (wave 6) can be written correctly.

5. **Severity:** Major
   **Dimension:** Migration & Schema Compatibility
   **Compatibility Hazard:** `113/114` follow the stated forward-only CHECK-widening convention from migrations 105/107. But a down-migration on `listing_shares` after live platform objects already carry real budgets would delete the database's only record of what ceiling was approved, while the Meta ad sets and Google campaigns still exist with those budgets live on the platform. The doc doesn't say what reconciles that gap if a rollback is ever needed post-launch.
   **Migration Requirement:** State that `114`'s down-migration is disallowed once any share has a non-null external campaign/ad-set id, same spirit as the forward-only CHECK rule.

---

## B. If a framework (Mastra / LangGraph / Claude Agent SDK) were added now

1. **Severity:** Blocker
   **Dimension:** Migration & Schema Compatibility
   **Compatibility Hazard:** A framework with its own suspend/resume (Mastra) or checkpoint model keeps its run state in its own store. The existing `proposals` table is the only system of record for "is this approved." Adding a framework creates two stores that can both claim to know approval state, with no reconciliation rule in either document for which one wins on disagreement.
   **Migration Requirement:** Cannot be scoped until one is named authoritative and the other is either removed or made a read-only mirror. No target file does this today.

2. **Severity:** Blocker
   **Dimension:** Rollout & Rollback Safety
   **Compatibility Hazard:** The existing design's crash story is explicit: build paused, read back, switch on in one run; if it crashes before switch-on, mark failed, archive, require a fresh approval, never resume. A framework's agent loop (Claude Agent SDK, or Mastra's own retry) has its own resume/retry semantics for a failed tool call. Nothing reconciles "framework auto-resumes a half-finished platform write" against "this system refuses to resume, by design, because resuming a partial build needs extra locking the team explicitly rejected." These are opposite recovery philosophies sitting on the same spend path.
   **Migration Requirement:** Pick one recovery model before writing any executor code. Running both means the idempotency-key strategy in `meta.ts`/`google-ads.ts` has to defend against retries from two different callers instead of one.

3. **Severity:** Blocker
   **Dimension:** Rollout & Rollback Safety
   **Compatibility Hazard:** The kill switch (`writes_enabled`), the connection allowlist, and `can_activate` are checks inside `execute.ts` and `store.ts` today — plain function calls the executor cannot skip. A tool-calling loop means each of these has to become a tool the model chooses to call, which means a tool the model can also choose not to call, or call out of order. No file in either document names which guard becomes which tool, or what stops the loop from reaching the write tool before the guard tool.
   **Migration Requirement:** This isn't a wave of file edits, it's a re-architecture of where every safety check lives. Nothing in the 21 target files allocates work for it, so it is not buildable at the current scope — it needs its own design pass, not a slot in wave 5.

4. **Severity:** Major
   **Dimension:** Rollout & Rollback Safety
   **Compatibility Hazard:** `framework_review.md` already names the open question — "is there a failure of the current proposal worker that Mastra's suspend actually fixes, and that a smaller change to the worker does not" — and leaves it unanswered. Introducing a new runtime dependency into a path that currently has none (confirmed: no LangGraph/Mastra/Vercel AI SDK/OpenAI Agents SDK/Claude Agent SDK in `package.json`), on a system already spending Gentle Space's live money, with no flag to fall back to the plain executor if the framework misbehaves mid-rollout, is a rollback gap on its own, independent of whether the framework works.
   **Migration Requirement:** Answer the open question in writing, and add a kill-flag that routes around the framework back to the plain executor, before this can be staged.

5. **Severity:** Major
   **Dimension:** Migration & Schema Compatibility
   **Compatibility Hazard:** The wave plan in "Parallel implementation" gives `execute.ts` exactly one writer (wave 4) and enforces "no two agents edit the same file." A framework wiring into the spend path almost certainly also touches `execute.ts` (that's where the loop would have to sit to call the platform connectors). The current wave plan has no slot for this, no skill assignment for it (`senior-backend`/`senior-frontend` don't cover framework integration), and would break the single-writer invariant the whole parallel build depends on.
   **Migration Requirement:** The wave plan would need a full re-cut, not an added line, before Composer 2.5 subagents could be dispatched against it.

---

## Bottom line

Accepting the hypothesis leaves five real gaps, but all five are closeable with text added to the existing design doc — a tracing target file, a stated deploy-ordering rule for in-flight proposals, a cutover sequence for the shared login, a lock rule between reallocation and ceiling changes, and a down-migration guard. None of them require new architecture.

Adding a framework now does not have five gaps of the same kind. Three of its five are architectural: a second source of truth for approval state, a second recovery philosophy on the same crash path, and every safety check re-platformed as something the model can choose to skip. These aren't missing paragraphs in a doc — they're missing designs. The framework path cannot be scoped into the current wave plan; the no-framework path can be scoped into it today.
