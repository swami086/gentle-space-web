# Structural Goldfish — BRAINSTORM review of framework_review.md

Target: `/Users/swami/Documents/GentleSpace_Web/framework_review.md`. Not edited. `concepts_brief.md` and `docs/designs/phase-1-listing-campaign-service.md` not edited.

## Direct answers

**Is this note a safe input to a later design change?** Partly. The decision content (keep Mastra/LangGraph/Claude Agent SDK out of the spend path, reuse the existing proposal worker, treat the share-budget move as a deterministic sum check, tracing as a wrapper not a replacement) is sound and low-coupling. The *document* is not yet safe to feed forward as-is, because it labels its own conclusion "Hypothesis" while writing it in imperative voice ("Do not put an agent framework under the spend path"), and it buries the actual decision gate (the one open question that would overturn the conclusion) inside a paragraph under an unrelated heading. A reader who copies by heading name will carry the hedge-worded label or drop the falsifiability question — either way the thing that moves into `concepts_brief.md` is not the thing the author meant to assert.

**What heading or decision is missing?** A `Decision` (or `Recommendation — Pending Review`) heading, separate from `Hypothesis`. As written, "Hypothesis" is doing two jobs: exploratory reasoning and the de facto recommendation. Also missing: a `Scope / Non-Goals` heading stating whether this applies only to the Phase 1 listing campaign service or to future phases/services too, and an `Open Question for Reviewer` heading for the one sentence that currently decides whether the whole argument holds.

**What must not be copied into concepts_brief.md?**
1. The planner script's output (supervisor, two agents, 8–12 weeks, file manager/data analyzer/code executor tools) — explicitly discarded in this doc, but it reads as a sourced data point. Copied without the rejection context, it becomes a zombie fact someone resurrects later.
2. The claim that a blog ranks Mastra "first for TypeScript production agents" — a vendor-comparison blog citation, not evidence about this codebase. Copying it without the source caveat lends it authority it hasn't earned.
3. The word "Hypothesis" attached to the no-framework conclusion, if the conclusion itself is copied — the conclusion should travel as a decision with its reasoning, not as an unresolved guess, once it survives the Goldfish review this document is explicitly gating on.
4. The last paragraph's question, if dropped silently — it is the actual falsifiability test for the whole hypothesis ("is there a failure of the current proposal worker that Mastra's suspend actually fixes, and that a smaller change to the worker does not"). Losing it while keeping the conclusion turns an open, reviewable claim into a closed one.

## Findings

1. **Severity:** Major
 **Dimension:** Long-Term Tech Debt & Maintainability
 **Tech Debt Description:** The document's only decision-shaped section is titled "Hypothesis" but contains an imperative instruction ("Do not put an agent framework under the spend path"). Confidence level and actionability are conflated in one heading.
 **Maintainability Requirement:** Split into `Hypothesis` (reasoning, falsifiable) and `Decision` or `Recommendation (pending review)` (the instruction), so a downstream doc copies the right one and knows which it copied.

2. **Severity:** Major
 **Dimension:** Long-Term Tech Debt & Maintainability
 **Tech Debt Description:** "Tracing can wrap the worker" has no attachment point. Without a stated boundary (span at worker entry/exit vs. spans threaded through business logic), tracing instrumentation is free to creep into the approval and spend-check code paths later, which recreates coupling this note argues against.
 **Maintainability Requirement:** State the tracing boundary explicitly (e.g., "wraps the worker's run method; does not read or alter approval state") before this note is used to justify a tracing implementation.

3. **Severity:** Major
 **Dimension:** Long-Term Tech Debt & Maintainability
 **Tech Debt Description:** The note argues the existing proposal worker's approval wait is sufficient, but does not point to where that worker's state machine (states, persistence, who sets `approved`) is documented. Two years out, a new engineer unfamiliar with that worker is the exact person likely to reach for Mastra/LangGraph suspend-resume — reintroducing the dependency this note rejects — because the alternative was never written down anywhere findable.
 **Maintainability Requirement:** The design doc (not this note) must carry an explicit, named reference to the proposal worker's state contract, so "we already have this" is checkable rather than tribal knowledge.

4. **Severity:** Nit
 **Dimension:** Long-Term Tech Debt & Maintainability
 **Tech Debt Description:** The rejected planner-script findings and the rejected vendor-ranking citation sit in the same prose flow as kept information, with no visual/structural separation (e.g., a "Considered and rejected" heading). Risk is low now (the author flags rejection inline) but compounds if this file is read out of context later.
 **Maintainability Requirement:** Rejected alternatives get their own heading, separate from the reasoning that's actually being carried forward.
