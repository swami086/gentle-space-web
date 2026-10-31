# Goldfish — Implementation Readiness (BRAINSTORM)

Scope: extend `campaign-chat.ts` and `CampaignDraftChat.tsx` (wave 5) so the setup card takes listing facts, a ceiling, and Meta copy. Create Proposal stays a button. Chat cannot launch, apply a finding, raise the ceiling, or move shares. Laptop test: `npm run dev` on port 3030, `AUTH_BYPASS` outside production.

Read: "Chat draft" paragraph and "Parallel implementation" section of `docs/designs/phase-1-listing-campaign-service.md`.

## If this concept is accepted, what blocks a build

1. **Severity: Blocker — Dimension: Schema compatibility.** The design names the two files in wave 5 but never gives them a Target Files entry (unlike items 1–21, which each get a proposed-changes block). There is no stated shape for "listing facts," "ceiling," or "Meta copy" on the setup card: which fields, which table they come from (presumably migration 114's listing/share rows, but that is inferred, not written), and how a per-platform ceiling is represented in card state next to the existing Google-only fields. An implementer must invent this struct — a Zero-Decision Rule violation, not just a nit.

2. **Severity: Blocker — Dimension: Migration & backward compatibility.** Today's chat is "Google Search only" and its product paragraph is "hardcoded to Gentle Space." The design says the same chat should use listing facts instead of that paragraph and should add Meta copy. It does not say how Gentle Space's existing non-listing campaigns keep working through that change — no flag, no fallback path, no note on what the card shows when there is no listing (Gentle Space's own ongoing use). The doc's own goal ("Gentle Space's existing campaigns keep working") is not threaded down into this file pair.

3. **Severity: Major — Dimension: Rollout ordering.** Wave 5 depends on wave 3's new proposal shape (ceiling per platform, equal starting shares) and on migrations 113–115 from wave 2. The Order section says the new proposal shape only ships "when no proposal is scheduled, executing, or inside its undo window" — a cutover rule for the backend, but nothing says what the chat's Create Proposal button does if it is used during that cutover window, or whether wave 5 is blocked from merging until that condition holds in the running system, not just in wave order.

4. **Severity: Major — Dimension: Test plan.** The Verification Plan lists unit tests for share sums, the day-3 gate, the kill switch, and the four executor crash points. It names no test for the chat/UI change itself — nothing confirms the setup card renders listing facts, ceiling, and Meta copy correctly, or that Create Proposal still produces a valid proposal in the new shape. The Standard requires specific test cases per changed surface; this surface has none.

## If launch-on-create were added, what blocks a build

1. **Severity: Blocker — Dimension: Contradicts the accepted design.** The document rejects this by name: "Launch-on-create, and a default of skipping approvals, are rejected. Ryze does both." There is no schema or state machine for it anywhere in the plan, because the plan assumes it never happens.

2. **Severity: Blocker — Dimension: Proposal engine invariant.** The executor only claims a proposal that is already "scheduled" — meaning it already has a code and has passed the 60-second undo window. Launch-on-create means a proposal would have to reach a launch-ready state without ever being approved, which breaks the one state transition the whole engine assumes (approve → undo window → execute). No alternate transition is designed, so there is nothing for an implementer to build against.

3. **Severity: Blocker — Dimension: Rule-pack timing.** The rule packs (`india.ts`, `australia.ts`) are specified to hold a proposal "until the owner clears it. No code is sent before the check passes." Launch-on-create has no code step at all, so there's no defined point where the rule check runs, or what blocks the launch if it fails. This is a real compliance gap (discriminatory wording, Australia's fixed-rent rule), not just a process one.

4. **Severity: Blocker — Dimension: Activation permission & rollback.** `can activate` on a connection is the flag that currently lets the executor flip paused objects live after a code-approved build. Launch-on-create has no described check against that flag, so a Stage 0 (no-spend) connection could be switched live with real money, and once live there is no undo — the design's own undo window exists specifically to catch mistakes before anything is live, and launch-on-create removes that window entirely. No rollback plan exists for money already spent through this path.

5. **Severity: Major — Dimension: Audit record.** Every other spend path (build, switch-on, in-ceiling move) leaves a stored proposal or a texted move as its record. A direct launch from chat has no proposal row to fail or archive against, so a crash mid-launch has nothing for the existing crash-recovery logic (archive paused objects, pause if already live, ask for a new approval) to act on.

---

**In plain English:** accepting the stated concept is buildable in direction but not yet buildable as written — the two chat files have no concrete data shape, and the transition from Gentle Space's current Google-only chat to a listing-aware Meta+Google chat is undocumented. Adding launch-on-create is not a readiness gap to fix with more detail — it contradicts a rejected design decision and removes the undo window and rule-pack check that are the only safeguards between a chat message and real ad spend.
