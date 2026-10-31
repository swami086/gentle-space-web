# Zoom-Out Brainstorm: keep agent frameworks out of the spend path

**Mode:** BRAINSTORM. **Verdict on the concept:** correct, and under-defended rather than over-built. The reasoning in `framework_review.md` holds up against the codebase. The findings below are where it should go further, not where to walk it back.

## Findings

**1. Severity: Nit — Dimension: Codebase reuse.**
Challenge/Risk: `framework_review.md` says "Tracing can wrap the worker" in a tone that reads as a future task — which leaves room for someone to later argue a framework is needed "for the tracing story." That argument would be wrong on current facts.
Alternative/Reuse: Tracing already exists and already runs. `ads-agent/lib/tracing/otlp-sink.ts` and `redact.ts` emit OTel GenAI-convention spans to a self-hosted Langfuse (shipped in S9/S9a, commit `22eb4af`). Wrapping `worker:proposals` is one more call site into code already in production, not new infrastructure. State that as done, not planned, so "add a framework for the observability" has no foothold.

**2. Severity: Major — Dimension: Contrarian / YAGNI.**
Challenge/Risk: "Add a framework for robustness" treats robustness as a property a runtime grants. The robustness this design actually needs — idempotency keys, paused-create-then-read-back-then-switch-on, a kill switch, one connection per customer, an allowlist — is already specified as plain database and state-machine work, with no framework. None of it is "the model picked the wrong tool and something needed to supervise the loop," because the model never gets a loop: it writes copy and a reason string, behind a rule pack, and stops. A framework governs a decision loop. There is no decision loop here to govern. The robustness conversation and the framework conversation are about two different things, and the design doc already answers the robustness one without the framework.
Alternative: Don't carry "evaluate a framework if the design needs more robustness" forward as a contingency. If an actual agent decision loop gets proposed later, that proposal is the trigger to look at Mastra/LangGraph — not a vague appeal to robustness now.

**3. Severity: Major — Dimension: Architectural dead-end avoidance.**
Challenge/Risk: Mastra's headline fit for this problem is workflow suspend/resume. The design doc already has a rejected alternative with the same shape: "Resume a build that crashed," rejected because it "needs extra locking so two workers cannot both finish the same build." A framework whose main idiom is suspend/resume pulls implementers toward that idiom by default. Adopting it would reopen a problem the design paid to close, not solve a new one.
Alternative: Keep the current worker contract as specified — 5-minute claim, no renewal, mark-failed-and-archive on crash, ask for a fresh approval. It's already narrower and safer than what the framework would encourage by convention.

**4. Severity: Nit — Dimension: Pattern consistency / reuse.**
Challenge/Risk: the design's ceiling check ("sum of share budgets equals the approved ceiling") is not a new pattern. `ads-agent/lib/db/agent-cost.ts` already has `assertWithinCeiling`, a per-tenant deterministic sum check (spend-so-far vs. stored ceiling) that gates LLM token cost today. The new ad-spend ceiling is structurally the same shape. That's a point in favor of the no-framework position, not a reason to unify the two.
Risk to flag explicitly: the two ceilings guard different bills — agent inference cost vs. ad-platform spend — and someone could "generalize" them into one ceiling service because they look alike. That generalization is the actual over-engineering trap here: a shared abstraction serving two unrelated compliance requirements (AI cost containment vs. India/Australia ad-spend approval law).
Alternative: name them distinctly wherever they're discussed — ad-spend ceiling, agent-cost ceiling — and keep them as two separate deterministic checks.

**5. Severity: Nit — Dimension: Scope boundary / future non-goal.**
Challenge/Risk: the design correctly bars a chat assistant from approving or switching on a campaign, but leaves the beta connector able to "create a draft and request a stop." That is still a tool-calling surface reachable by an external model (ChatGPT or Claude), even with no spend power. It's the most likely place someone later reaches for the Claude Agent SDK "since the connector already talks to Claude," which is exactly the risk this review is meant to close off.
Alternative: when that connector ships, state in one line that its writes go through the existing proposal/finding insert paths — no new executor or reallocater entry point, no model-driven call into a platform API, ever.

**6. Severity: Nit — Dimension: Close the open question instead of carrying it.**
Challenge/Risk: `framework_review.md` ends by deferring its own hardest question to "if the Goldfish review is run": is there a failure of the current proposal worker that Mastra's suspend actually fixes? That review is this one. Leaving the question open in a document that then gets cited by the Phase 1 design invites it to be re-litigated later as if unresolved.
Answer, stated plainly: no. The worker's claim/expiry/archive/no-resume contract is already stricter than generic suspend/resume, and the one scenario suspend/resume would help with (resuming a crashed build) is the scenario the design deliberately rejected (see #3). Resolve the question in the record; don't hand it forward as a hedge.

**7. Severity: Nit — Dimension: Don't overreach the ban.**
Challenge/Risk: the three frameworks also carry adoption costs independent of the spend-path argument — Mastra's own cited comparison notes docs lagging releases to the point tutorial snippets don't compile; LangGraph's mature version is Python, so a TypeScript port adds a second language dialect to a single-stack Next.js repo; the Claude Agent SDK is Claude Code's loop, not a durable wait for a WhatsApp code. Good supporting evidence, but worth being precise about what's actually being ruled out, so this review doesn't calcify into "never use these, anywhere, for anything" without re-review.
Alternative: scope the rule to what's actually justified — no framework sits between a decision and a write to Meta or Google. Leave room for a framework to be evaluated on its own merits for something that isn't on the spend path (an internal tool, a non-spend chat surface) without reopening this argument.

## Bottom line

The concept is right: no Mastra, LangGraph, or Claude Agent SDK under the spend path, because there's no agent decision loop under the spend path to put one under. "Add a framework for robustness" misdiagnoses the problem — the robustness is already built as ordinary application code, and the one framework feature that looks relevant (suspend/resume) would reopen a failure mode the design already closed. The gap isn't in the conclusion; it's in leaving the counter-argument's door ajar (open question, "beta connector," tracing framed as future work) instead of shutting it.
