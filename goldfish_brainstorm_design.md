# Goldfish Design Critique — Mode: BRAINSTORM

**Target:** framework_review.md + docs/designs/phase-1-listing-campaign-service.md
**Question:** keep agent frameworks (Mastra/LangGraph/Claude Agent SDK) off the spend path, true durable-wait stays the existing proposal worker, tracing wraps it, share-budget move is a deterministic sum check.

Read-only review. No files edited.

---

## Risks of refusing a framework

1. **Severity: Blocker**
   **Dimension:** Architectural bottleneck — unverified crash recovery
   **Risk:** The proposal worker is already a hand-rolled durable-execution engine: claim-with-5-minute-expiry, paused-build-then-readback-then-switch-on in one run, "mark failed + archive + re-approve" on crash, idempotency keys that explicitly do NOT cover Instant Form creation. None of the 21 target files or the verification plan include a test for crash-mid-build (e.g., Meta succeeds on 3 of 5 shares, process dies before switch-on, or dies after switch-on but before the DB write records it). Refusing a framework is fine; refusing to prove the hand-rolled replacement is correct is not. Right now "no framework" means "no framework and no proof the custom state machine handles partial failure," which is worse than either choice made deliberately.
   **Mitigation:** Add an explicit state-transition table for the executor (claimed → paused-built → read-back → switched-on → failed-archived) and a test for every crash point in that table, not just the happy path. This is required whether or not a framework is adopted.

2. **Severity: Major**
   **Dimension:** Architectural bottleneck — reallocation job idempotency
   **Risk:** `monitor/reallocate.ts` is described as running "on the daily insights check," but nothing specifies what happens if the job fires twice in one day (duplicate cron trigger, redeploy mid-run). The design doc guarantees the share-sum invariant on a single application of the move but says nothing about detecting an already-applied move today. This is exactly the at-least-once-with-dedup problem that workflow engines solve by default; a hand-rolled daily job needs that dedup written explicitly, and it isn't shown.
   **Mitigation:** Add a "has this listing already moved today" check (or a moves-per-day-per-listing uniqueness constraint) before the reallocation job writes budgets.

3. **Severity: Major**
   **Dimension:** Cost & token economics — observability is asserted, not built
   **Risk:** The rebuttal to the "Mastra has traces/evals" counter-argument is "tracing can be a span around the existing worker." No tracing task appears anywhere in the 21 target files. By the time this is a pilot-facing system across two markets and two platforms, "why did listing X's build fail at 2am" needs more than log grep. The document treats observability as free (a wrapper you add later) while explicitly rejecting the framework that would have given it for free now.
   **Mitigation:** Put an explicit tracing/span task in the target file list before Stage 1, not as a someday-wrapper.

4. **Severity: Nit**
   **Dimension:** Cost & token economics — this actually supports "refuse"
   **Risk:** none against the decision — noting for completeness: a fixed pipeline (planner → drafter → rule pack) has a bounded, predictable token cost per listing. A ReAct-style tool-calling loop retries and replans unpredictably, which is a real quota risk the review doesn't quantify but could have cited as a positive argument for its own position.
   **Mitigation:** None required; strengthens the existing conclusion if cited.

## Risks of adopting a framework

1. **Severity: Blocker**
   **Dimension:** Architectural bottleneck — the review's own framing is a false binary
   **Risk:** The argument conflates "agent loop with tool-calling autonomy" (correctly rejected for the spend path) with "durable workflow checkpointing" (a different feature, e.g. LangGraph's state persistence, that has nothing to do with letting a model choose a platform write). A framework could checkpoint the deterministic executor steps above — exactly the gap in Risk #1 above — while the spend decision stays a server-side function the model never touches. The review never evaluates that middle position; it only evaluates "give the LLM a tool loop over Meta/Google calls" and rejects that (correctly), then treats the rejection as covering frameworks generally.
   **Mitigation:** If adopting anything, scope it explicitly to checkpointing of already-deterministic steps, never to tool selection over platform-write calls. State that scoping as a rule, not just a vibe.

2. **Severity: Major**
   **Dimension:** Architectural bottleneck — maturity risk is correctly flagged but not quantified
   **Risk:** Mastra hit 1.0 in Jan 2026 with docs reportedly lagging releases. Correct to keep it off money movement. But the review doesn't say what it would cost to adopt it later for non-spend orchestration (intake conversation, retries) — "revisit later" has no migration-cost estimate, so it's a deferred decision with no criteria for when "later" is.
   **Mitigation:** Name a concrete trigger (e.g., "Mastra 1.x has N months of production use with no breaking changes") before any later adoption, even for non-spend paths.

3. **Severity: Major**
   **Dimension:** Architectural bottleneck — LangGraph rejection conflates language cost with architecture cost
   **Risk:** LangGraph is waved off as "really Python" and a TS port as "a second dialect beside this repo." That's a real team-maintenance argument, but it's being presented as though it were an architectural flaw of agent frameworks. A Python orchestration microservice calling into this Next.js app via internal API is architecturally possible and common; it wasn't actually evaluated on its merits, only rejected for adding a second language. If "no second language in the critical path" is the real reason, the review should say that plainly instead of letting it read as a technical disqualification of LangGraph's checkpointing model.
   **Mitigation:** Separate "second language we don't want to maintain" from "architecturally unsound" in the written rationale.

4. **Severity: Nit**
   **Dimension:** Cost & token economics — Claude Agent SDK dismissal is a straw man for one step
   **Risk:** "It is not a durable wait for a WhatsApp code, and it is not a spend cap" is true of every general-purpose tool and proves nothing about whether it's useful for the one step where it might actually fit: the drafter, which already needs grounding/citation-gated context management over listing facts. The review never compares the SDK's built-in context management against the hand-rolled grounding-pack/citation-gate the design doc says already exists. If the team is re-building a smaller version of what the SDK gives for free, that's worth one paragraph of actual comparison, not a blanket dismissal based on the spend-path argument alone.
   **Mitigation:** Evaluate the SDK narrowly against the drafter step's existing context-management code, separately from the spend-path question.

---

## Strongest counter-argument

The system described across both documents is already a hand-rolled durable-execution engine — proposal lifecycle, undo window, claim-based locking with expiry, crash recovery by archive-and-reapprove, idempotency keys with a stated gap (Instant Form), and a daily reallocation job with no stated dedup — spread across roughly ten files, with zero crash-interleaving tests in the verification plan. That is precisely the correctness surface that checkpointed-workflow tooling (the state-persistence half of LangGraph, or equivalent) exists to remove. Rejecting the *agent-loop* half of these frameworks because an LLM could pick a platform write outside the ceiling is correct and should stand. But the review never separately evaluates the *checkpointing* half against the currently-unverified gap in the hand-rolled executor, and instead treats "framework" as one indivisible thing to reject. If the crash-recovery gap in Risk #1 turns out to be real once someone writes the missing tests, the correct fix is checkpointing around the deterministic steps that already exist — not more hand-rolled locking, and not an agent loop either. The review wins the headline argument (no model agency over spend) without checking whether it's also discarding a different, unrelated capability (verified exactly-once execution) that the project currently lacks and has not proven it doesn't need.
