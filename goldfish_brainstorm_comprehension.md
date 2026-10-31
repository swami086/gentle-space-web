# Goldfish Comprehension — BRAINSTORM

**Target:** feature concept ("don't put Mastra/LangGraph/Claude Agent SDK under the spend path") as framed in `framework_review.md`.
**Scope read:** `framework_review.md` only. `concepts_brief.md` and the design doc were not read or edited, per instruction.

A fresh reader gets the headline ("don't let a generic agent loop touch spend") but loses it in the supporting prose, because four or five project terms do the same job under different names and two terms are never defined at all.

---

### Finding 1
**Severity:** Blocker
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "Spend path" is the load-bearing term in both the concept sentence and the doc's own Hypothesis ("Do not put an agent framework under the spend path"), and it is never defined. A reader can't tell if it means "the one function that submits the platform write" or "any code that touches budget data" — which changes the verdict on the copy/explainer model calls the doc later says are fine to leave alone. Those calls also sit near spend data; are they "under the spend path" or not?
**Ergonomic Requirement:** Define "spend path" once, inline, as the specific call(s) it denotes (e.g., "the function that submits a budget change to Meta/Google") before using it as a boundary.

### Finding 2
**Severity:** Blocker
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "That loop does not know the ceiling, the kill switch, or the allowlist" — three project-specific safety mechanisms, asserted as the reason agent loops are dangerous, with zero description anywhere in this document of what any of the three actually are or do. A reader cannot evaluate the risk claim; they just have to take it on faith.
**Ergonomic Requirement:** One clause each: what the ceiling bounds, what the kill switch stops, what the allowlist restricts.

### Finding 3
**Severity:** Major
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "The existing proposal worker already waits for a text approval" reads as "approval of the ad copy text." The doc's own later reference to "a durable wait for a WhatsApp code" suggests it actually means "approval delivered via a text message." Those are different things (approving content vs. approving via a channel), and the sentence as written supports the wrong one.
**Ergonomic Requirement:** Say "approval received by text message" or name the channel, not "text approval."

### Finding 4
**Severity:** Major
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** The same budget-check step is named three different ways with no statement that they're the same thing: "a daily share move" (workflow list), "the share sum" (Hypothesis section), "the share-budget move" (the feature concept itself). A reader has to assume these are one mechanism rather than two or three.
**Ergonomic Requirement:** Pick one name for this step and use it everywhere it's referenced, including in the feature concept wording.

### Finding 5
**Severity:** Major
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** Workflow list says "paused build"; the robustness paragraph says "paused create." Nothing states these are the same stage. Read naively, they look like two different pauses.
**Ergonomic Requirement:** Use one term for the pause-before-platform-write step.

### Finding 6
**Severity:** Major
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** The doc never maps "the undo window" (on `worker:proposals`), "text approval" (workflow step), and "paused build/create + read-back" into one ordered sequence. A reader can't tell if this is one wait described three ways, or two or three distinct waits happening at different points in the pipeline — which matters for judging whether a second "approval" engine would actually create "two places that can decide an action is approved."
**Ergonomic Requirement:** One ordered list: wait name → what it waits for → where it sits in Intake→...→switch-on.

### Finding 7
**Severity:** Major
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "Approved" is used for two different events without distinguishing them: the proposal getting approved (the text/WhatsApp wait) and an "approved ceiling" (a budget number someone signed off on). The sentence "a second engine means two places that can decide an action is approved" doesn't say which "approved" is at risk of a second decision-maker — the content approval, or the spend-amount approval.
**Ergonomic Requirement:** Use distinct terms, e.g. "proposal approval" vs. "approved budget ceiling."

### Finding 8
**Severity:** Major
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "A tool-calling agent loop can spend outside the approved ceiling" and "the share-budget move stays a deterministic sum check" both leave their key noun unscoped. What is the ceiling measured over (per day, per campaign, total budget)? What is summed in the "sum check," and against what? Without that, "deterministic" is an unverifiable claim — a reader can't check the arithmetic the sentence is defending.
**Ergonomic Requirement:** State the unit of the ceiling and the two (or more) quantities the sum check compares.

### Finding 9
**Severity:** Nit
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** Closing paragraph introduces "the citation gate," "the explainer," and "the parser" with no description of what each checks or produces — only inferable from the component name.
**Ergonomic Requirement:** One clause per component, e.g. "the citation gate (blocks copy claims without a source)."

### Finding 10
**Severity:** Nit
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "Gentle Space's live campaigns already use it" is the only place the product is named "Gentle Space"; everywhere else it's "the repo" or `ads-agent`. A reader meeting it cold can misread it as a separate client or company.
**Ergonomic Requirement:** Tie the name back on first use, e.g. "ads-agent (Gentle Space's live product)."

### Finding 11
**Severity:** Nit
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "The same comparison treats the strong version as Python" (re: LangGraph) reads as "the better-performing edition of LangGraph is a Python product tier." The intended meaning is closer to "the mature, production implementation is in Python; a TypeScript port would be new and unproven here." As written, a reader can walk away thinking LangGraph ships two differently-capable versions.
**Ergonomic Requirement:** Replace "the strong version" with "the mature/production implementation."

### Finding 12
**Severity:** Nit
**Dimension:** UX & Developer Ergonomics
**Usability Friction:** "Tracing can wrap the worker" (concept) vs. "Tracing can be a span around the existing worker" (doc) — the concept's looser wording doesn't rule out the reading that a framework's own tracing/observability layer (which the doc argues against adopting) is what's being proposed. Only the doc's "span" wording clarifies it means instrumentation, not framework replacement.
**Ergonomic Requirement:** Use "a tracing span" rather than "wrap" in the concept-level summary, to match the doc and foreclose the framework-adoption reading.
