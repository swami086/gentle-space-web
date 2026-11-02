# Critic Review Report (Stage 7)

**Target:** `docs/designs/phase-1-listing-campaign-service.md` (lines 1–298; `## Detailed Implementation Plan` at 299+ out of scope)
**Mode:** REVIEW · **Date:** 2026-11-02
**Standard:** `feature-spec-standard.md` applied to egm-design and egm-structural. Style ran against `agents/style.md` only (no style standard file exists).
**Torbit:** Queried. Graph at HEAD `ad63d64316a50852503cd8a408350391d4ddfd2c`, `project_id = 1672773718350201492`. Dirty working-tree files Read directly where a finding depended on them.

## Reviewer Status

| Reviewer | Shortname | Status |
| --- | --- | --- |
| Skeptical Architect Reviewer (opus-4-8-thinking-high) | `egm-design` | completed |
| Structural Reviewer (composer-2.5-fast) | `egm-structural` | completed |
| Style Reviewer (composer-2.5-fast) | `egm-style` | completed |

**Torbit-verified code claims (`egm-design`):** confirmed real at HEAD — `executeProposal` (`ads-agent/lib/executor/execute.ts`), `createMetaCampaign` (`ads-agent/lib/connectors/meta.ts`), `claimDueScheduledProposals` (`ads-agent/lib/db/proposals.ts`), `putConnection` (`ads-agent/lib/connections/store.ts`), `sealSecret` (`ads-agent/lib/context-graph/envelope.ts`), `CampaignDraftChat`, and files `rules/india.ts`, `rules/australia.ts`, `decision-engine/cycle.ts`, `decision-engine/campaign-chat.ts`. No false code-existence claims found. The doc's own `3f22c76` inventory is stale vs HEAD (Finding M7).

---

## Prioritized Findings (Blockers → Major → Nits)

### 🔴 Blocker

#### B1 — Unified.to is an unmitigated single point of failure for every write, including the safety-critical stop
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §Technical Plan (106–107, 140), §Risks (158–166)
* **Discrepancy Description:** The design makes Unified.to "the only platform write path … for the no-spend test and for production," and a stop executes *through Unified* (status→PAUSED). Risks covers our service being down, Google refusing a budget, and the stop *text* not arriving — but never Unified itself being down, rate-limited, or quota-exhausted. During a Unified outage nothing can be created, switched on, moved, **or stopped**, which breaks the asserted invariant "a stop still runs."
* **Rationale & Recommendation:** For a system spending customer money, the one path that bounds the downside depends entirely on a third party whose availability is never discussed. Add a Unified-unavailability risk: state that the stop is best-effort during a Unified outage and that the pre-set platform budgets / ceiling are the real backstop; document Unified rate-limit and quota behaviour.

### 🟡 Major

#### M1 — Alternatives Rule violated on the largest architecture decision: Unified-only vs the existing direct SDKs
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §Technical Plan (106), §Alternatives Considered (170–296)
* **Discrepancy Description:** Routing 100% of platform writes through Unified.to — displacing the `google-ads-api` and `facebook-nodejs-business-sdk` the repo already uses (Torbit-confirmed `createMetaCampaign` in `connectors/meta.ts`) — is the load-bearing choice of the phase, yet it appears nowhere in the ~25-entry Alternatives list. The standard fails a spec that proposes a single path without weighing viable alternatives.
* **Rationale & Recommendation:** Add an Alternatives entry for direct-SDK vs Unified with the real trade-off (uniform multi-platform surface and per-customer connections vs added vendor SPOF and the untested create-shape constraints in M6).

#### M2 — Internal contradiction: direct-SDK writes asserted as current reality in the same doc that bans them
* **Reviewer Lens:** `egm-design` (overlaps comprehension prior note at ~line 192)
* **Affected Scope:** line 191 vs 106–107 / 140
* **Discrepancy Description:** Line 191 states the service "already writes through `google-ads-api` and `facebook-nodejs-business-sdk`, and only from the proposal executor." Lines 106–107 and 140 state Unified is the only write path and those two APIs "are not used in this phase." A fresh reader cannot tell which is true.
* **Rationale & Recommendation:** Disambiguate tense/scope: the legacy Gentle Space path writes via SDKs and is being *replaced* by the Unified-only path, so both statements are not simultaneously "current." (Confirms the comprehension-stage concern; genuinely in-scope at 191.)

#### M3 — Crash-recovery compensation is asserted but has no actor, trigger, or detection mechanism
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §One listing's path step 4 (123), §Risks "Crash during build" (163)
* **Discrepancy Description:** The doc promises a crash after switch-on but before the DB write "pauses those objects through Unified" and that paused objects are archived. But if the crash precedes the DB write, the database has no record of which Unified objects were created/switched on — nothing can know what to pause or archive. No reconciliation sweeper, idempotency key on the per-platform multi-campaign create, or read-back-from-Unified recovery pass is described. A partial build (some of 3 Meta/3 Google shares, then crash) leaves orphaned paused campaigns with no owning row.
* **Rationale & Recommendation:** Specify the recovery actor and how it discovers orphaned/switched-on objects (correlation id / idempotency key on create plus a reconciliation read against Unified), or state that orphans are accepted and how they are found.

#### M4 — Share-move writer identity is unspecified and appears to violate "the proposal executor is the only writer"
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §Moves inside the ceiling (130–134), diagram (100–101)
* **Discrepancy Description:** The monitor "may shift spend … It then texts what it did" and "A move edits those share budgets," but the design never says the move is an auto-approved proposal executed by the executor. As written it reads as the monitor writing budgets directly — a second writer racing the executor and the daily cycle on the same share budgets (15s proposal worker vs the daily worker).
* **Rationale & Recommendation:** Per the decided fact that the executor is the only writer, state that a share move is materialised as an auto-approved proposal through the single executor, and describe serialization against a concurrently-executing code-gated ceiling change on the same shares.

#### M5 — Cross-tenant spend isolation and the paused→live gate rest on undefined mechanisms
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §"What is new/reused" (108), §Isolation (154–156), switch-on gate (41, 123, 140)
* **Discrepancy Description:** The highest-stakes property — "a second organisation cannot spend on Gentle Space's account" — is justified only by "that separate row and its allowlist," and the allowlist is never defined (what it keys on, who populates it, how a write validates connection↔org before calling Unified). Separately, `can_activate` is the single gate between a paused build and real spend, yet its storage, owner, and flip-authority are never stated in 1–298.
* **Rationale & Recommendation:** Specify the allowlist check performed before every write, and define where `can_activate` lives and who may set it true.

#### M6 — "Unified create cannot take" creative/targeting/lead-form is a load-bearing assumption with no evidence trail
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §Overview (12), steps (121, 125), §Accounts (140)
* **Discrepancy Description:** The whole scope (copy written but not sent; no photo; no lead form; keywords/headlines/location/radius not sent) hangs on the claim that Unified's campaign create accepts only budget/status. Unlike the Ryze behaviours (cited to dated help-docs), this Unified constraint carries no citation; the sandbox test proves only a paused create read back, not that Unified *rejects* (vs silently ignores) creative/targeting, and synthetic data is disclaimed as unrepresentative.
* **Rationale & Recommendation:** Cite Unified's create schema or a tested real payload.

#### M7 — "What is new/reused" inventory is stale against the working tree (kill switch already implemented)
* **Reviewer Lens:** `egm-design` (Torbit + dirty-file Read; graph at HEAD)
* **Affected Scope:** §"What is new/reused" (108), pinned to commit `3f22c76`
* **Discrepancy Description:** It says "the kill switch is not in the code yet … table today has `cron_enabled`, `last_run_at`, `undo_window_seconds`, `approval_threshold_inr` only." On disk at HEAD `ad63d64`, `ads-agent/lib/db/org-settings.ts` already selects/writes `writes_enabled` and `ads-agent/lib/executor/execute.ts` already reads and enforces it on share moves.
* **Rationale & Recommendation:** Refresh the snapshot and its commit pin, or mark the inventory as "HEAD-at-drafting" and re-verify. (Overlaps the zoom-out prior note that files marked "new/Create" may already exist.)

#### M8 — Terminology drift across four concepts (spend cap, later-consent gate, UI surface, reallocation unit)
* **Reviewer Lens:** `egm-style` (reallocation-unit overlaps `egm-design` #11)
* **Affected Scope:** spend cap: 12–16, 23, 41–45, 81–83, 101; consent gate: 23, 43–45, 55, 81–83, 122, 214–216; UI surface: 41, 90, 116, 120–121, 162; reallocation unit: 14, 23, 45, 81, 101, 132–133
* **Discrepancy Description:** One concept carries several interchangeable labels: the cap is "daily spend limit" / "spend limit" / "ceiling" / "approved ceiling" / "approved amount" (Goals define ceiling = sum of share budgets, but Overview/Technical Plan still say "inside the spend limit"); the later gate is "a code" / "text code" / "a new code" / "without a new approval" / "recorded approval" / "approval codes"; the surface is "listing page" (never approves, 41/90/162) vs "campaign page" (missing-fact prompt, 116/120–121); reallocation moves "that listing's ads" while the defined unit is a "share."
* **Rationale & Recommendation:** Fix one term per concept (or state "X = Y" once). A reader cannot currently tell whether "spend limit" and "ceiling" are the same number, or whether "listing page" and "campaign page" are one surface or two.

#### M9 — Duplicated technical prose: in-ceiling move mechanics repeated under Risks
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** §Moves inside the ceiling (132–133) vs §Risks (161)
* **Discrepancy Description:** The Google total-budget / lead-count / "no live cost" / cost-lag sentence under Risks repeats the paragraph from "Moves inside the ceiling" almost verbatim.
* **Rationale & Recommendation:** Risks should state the risk and point back, not re-paste the mechanism.

#### M10 — Broken relative links from `docs/designs/` to repo-root briefs
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** lines 6, 18, 25, 85, 172 (and similar)
* **Discrepancy Description:** `[concepts_brief.md](concepts_brief.md)`, `[ryze_capability_map.md](ryze_capability_map.md)`, `[concepts_brief_full_service.md](concepts_brief_full_service.md)` resolve from `docs/designs/` to siblings, but those files live at the repo root. Line 212 correctly uses `../../framework_brainstorm.md`, proving the convention.
* **Rationale & Recommendation:** Use `../../concepts_brief.md` (etc.) or root-anchored paths so renderers resolve them.

#### M11 — Section order and non-canonical H2 titles vs the standard outline
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** §Risks (158) before §Alternatives (170); H2 titles throughout
* **Discrepancy Description:** The standard lists Alternatives Considered before Risks & Mitigations; the doc reverses them. H2 titles diverge from the named areas ("The Problem" vs Problem Statement; split "Goals"/"Non-Goals" vs "Goals & Non-Goals"; "Technical Plan (Architecture)" vs Proposed Architecture; "Risks" vs Risks & Mitigations). All content is present and correctly H2/H3-leveled with a valid closed ```text diagram — this is template-compliance, not a content gap.
* **Rationale & Recommendation:** Reorder Alternatives before Risks and/or align H2 titles for strict template and automated section mapping. (No blocker; mandatory content areas all pass.)

### 🟢 Nit

#### N1 — Production switch-on is never exercised before real money
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §Accounts (140), §Goals (46)
* **Discrepancy Description:** `can_activate` is false throughout Stage 0 and synthetic data cannot prove activation, so the first real execution of the Unified status→active path is Stage 1 on Gentle Space's live account. Not listed in Risks.
* **Rationale & Recommendation:** Add a controlled minimal-budget activation check and list the untested-activation risk.

#### N2 — Ceiling-lowering guard depends on the cost data the design calls unreliable
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** §"What still needs a code" (138) vs (131, 161)
* **Discrepancy Description:** "If any share's new budget would be below that share's spend, the whole ceiling change is refused" needs per-share spend (live cost), which the design elsewhere says lags for Google and deliberately does not read for moves.
* **Rationale & Recommendation:** Clarify the data source and staleness tolerance for the refusal check.

#### N3 — "3 paused Unified campaigns on Meta" risks reading against the brief's "one live Meta campaign per listing"
* **Reviewer Lens:** `egm-design` (overlaps zoom-out prior note)
* **Affected Scope:** lines 21, 127
* **Discrepancy Description:** A reader sees "3 shares = 3 Meta campaigns." If the brief caps a listing at one live Meta campaign, the share-vs-live-campaign vocabulary reads as contradictory.
* **Rationale & Recommendation:** Reconcile the share-vs-campaign vocabulary in-doc (brief governs on conflict).

#### N4 — Horizontal-rule placement is inconsistent
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** lines 8, 77, 156, 168
* **Discrepancy Description:** Long `---` separators appear before Technical Plan, Risks, and Alternatives, but not between Overview / Problem / Goals / Non-Goals / Open Questions.
* **Rationale & Recommendation:** Use HRs uniformly as H2 dividers, or drop the partial use.

#### N5 — H3 heading punctuation is mixed
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** lines 106–152, 294
* **Discrepancy Description:** Architecture H3s end with periods ("### Chat draft.", "### The ceiling."); Alternatives H3s omit them.
* **Rationale & Recommendation:** Pick one convention for same-level headings.

#### N6 — Uneven Alternatives subsection shape
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** lines 174–297
* **Discrepancy Description:** First two alternatives use Pros / Cons / Reason-for-rejection; later entries are rejection-only; "### Deferred, not rejected" is bullets without the template. Satisfies the Alternatives Rule but is internally asymmetric.
* **Rationale & Recommendation:** Optional — normalise the block or keep the two-tier shape deliberately.

#### N7 — Rhetorical / unmeasured phrases
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 25 ("a hundred write actions"), line 192 ("The authoritative open-source server"), line 33 ("Doing that by hand … does not happen"), line 176 ("fully hands-off manager")
* **Discrepancy Description:** Round unverified count (25), subjective vendor judgment (192, prefer "Google-maintained"), absolute behavioral claim without in-doc evidence (33, contrast the qualified premise at 37), and a mild marketing idiom in a Pros bullet (176).
* **Rationale & Recommendation:** Replace with sourced numbers, neutral descriptors, or owner-observation framing.

---

### Scope / dedupe notes
* Out-of-scope by design: Order item 3 scheduling generated images, and the `## Detailed Implementation Plan` (299+) — all three reviewers confirmed these are not independently visible as defects within 1–298. The generated-images-forbidden fact was treated as decided and not reopened.
* Comprehension prior note "readers may still expect a text code before the first build" was not reproduced as a finding: lines 23, 44, 95, 121 state "No text code before that build" repeatedly and clearly; treated as decided.
* M2 confirms the comprehension line-192 concern; M3/M7/N3 overlap zoom-out prior notes and are verified, not copied.
