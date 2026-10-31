# Comprehension Test — Phase 1 listing campaign service

**Target:** `docs/designs/phase-1-listing-campaign-service.md`
**Stage:** 6. Reviewer: [comprehension](5d6fd844-94a5-4d9e-bb8a-61200d117097).

**What this proposes**

A new workflow service that does a real-estate lease consultant's paid-ads job for them: the consultant sends listing facts by text or a web page, the service drafts a Meta (and, for commercial offices, Google) ad campaign, shows a preview, and only builds it on the platforms after the consultant replies with an approval code that sets a single spending ceiling. Once live, the service is allowed to shift budget between that listing's own ads — but never above the approved ceiling, never extending dates, and never changing copy or audience — without asking again, and it texts the consultant after each such move; any other change (raising the ceiling, ending early, new copy, etc.) still needs a fresh code, and a stop command needs no code at all. The Detailed Implementation Plan half translates this into concrete database migrations, connector changes, an executor rewrite, and a list of specific files, grouped into ordered "waves" of parallel automated coding work.

**How the existing system works, per this document**

Per the document, the company already has a working codebase ("ads-agent") that drafts and runs ad campaigns, but only for the owner's own business (Gentle Space), using one shared login per platform — so a second customer's spend would currently land on Gentle Space's account. It already has an approval/proposal mechanism (a proposal store, a 15-second polling worker, a fixed set of allowed write actions, a 60-second undo window, tracing, and a WhatsApp inbound route), and campaigns are currently created as one active campaign with a single daily budget rather than today's planned "paused → read back → switch on" sequence split across several budget "shares." This phase's job is to add a per-customer connections layer, a kill switch, the share-splitting logic, a budget-reallocation job, and the inbound/outbound text and listing-page surfaces, while reusing the existing proposal/executor machinery rather than building a second approval system.

## Findings

**Severity:** Major
**Affected Scope:** The term "finding" — used in the architecture diagram and "Moves inside the ceiling" paragraph (Feature range) and in Detailed Implementation Plan's move-rule description and §9 "Finding rules" (Detailed range)
**Discrepancy Description & Rationale:** "Finding" is used repeatedly as a load-bearing term (findings "recommend pause, end early, lower ceiling, raise ceiling and extend end date," and "still need a code") but it is never defined inline anywhere in this document. The only path to a definition is inferring it from the one-time citation of `concepts_brief.md` §6 much earlier in the document. A reader who hasn't read that external brief cannot tell what produces a finding, how a finding differs from the "move" the ceiling-change exception creates, or how a finding becomes something the consultant can approve by code.

**Severity:** Major
**Affected Scope:** "No-spend test" / "two-week live test" (Goals, Feature range) vs. "Stage 0" / "Stage 1" (Technical Plan "Accounts" paragraph and Verification Plan, Feature and Detailed range)
**Discrepancy Description & Rationale:** The Goals section promises an owner-run "no-spend test" followed by a "two-week live test," while the Technical Plan and Verification Plan describe "Stage 0" (new, never-activated accounts) and "Stage 1" (Gentle Space's existing accounts, two weeks). The details line up well enough to guess these are the same two milestones under different names, but the document never states that equivalence. A reader could reasonably conclude there are three phases before a pilot (no-spend test, Stage 0, Stage 1) instead of two.

**Severity:** Major
**Affected Scope:** "Parallel implementation" section (Detailed range) — "skill picker," "router," "subagents," and named skills like `senior-backend`, `nextjs-developer`, `saas-scaffolder`
**Discrepancy Description & Rationale:** This section describes the entire mechanism by which the code gets written — automated "subagents" each loading one "skill" via a "router" picked by "the skill picker," organized into numbered "waves" — but none of these terms are defined anywhere in the document. A reader cannot tell what a "skill" is in this context, what the skill picker actually does, or why tools like `php-pro` or `laravel-specialist` would ever have been candidates for a Next.js/TypeScript repo. This section assumes the reader already works inside the same AI-agent tooling the author used to draft it.

**Severity:** Nit
**Affected Scope:** "The Desk" — first appears in the Technical Plan's laptop setup paragraph (Feature range), recurs in Detailed Implementation Plan #12 (Detailed range)
**Discrepancy Description & Rationale:** Capitalized as a proper noun ("serves the Desk at `http://localhost:3030`," "Desk approval remains for Gentle Space only") but never explicitly described as the internal manual-approval web UI, as distinct from the text/SMS approval flow. A first-time reader has to guess what it is from context.

**Severity:** Nit
**Affected Scope:** "Ryze" — Overview section (Feature range)
**Discrepancy Description & Rationale:** Introduced only by negation ("not Ryze's whole product," "Ryze is not built around one lease listing") and backed by a link to `ryze_capability_map.md`. The link technically satisfies the definition requirement, but the main document never states even in one clause what Ryze actually is (a competing product? an internal reference system?), so it doesn't stand on its own.

**Severity:** Nit
**Affected Scope:** "Mumbai" reference — Technical Plan, laptop-build paragraph (Feature range)
**Discrepancy Description & Rationale:** "Not in Mumbai. Mumbai is for a later hosted pilot." This is the only mention of hosting geography in the entire document; nothing earlier establishes why Mumbai specifically matters (team location, data residency, etc.).

**Severity:** Nit
**Affected Scope:** "Instant Form" (Detailed Implementation Plan #4) and "responsive search ad" (Detailed Implementation Plan #5) — Detailed range
**Discrepancy Description & Rationale:** These are specific Meta/Google ad-product names used with no gloss. A reader unfamiliar with those ad platforms can't tell that an Instant Form is a native in-ad lead form or that a responsive search ad is Google's auto-assembled text-ad format.

**Severity:** Nit
**Affected Scope:** "Rex Software's Australian lead-price figure" — Alternatives Considered (Feature range)
**Discrepancy Description & Rationale:** Named once to justify rejecting an alternative ("Rex's figure is for sellers asking for an appraisal, not for renters") with no indication of what Rex Software is or why its figure was ever a candidate input.
