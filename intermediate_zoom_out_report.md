# Goldfish Review Report — Stage 8 (Intermediate Zoom Out)

**Target:** `docs/designs/phase-1-listing-campaign-service.md` (full file; FeatureRange lines 1-298, DetailedRange lines 299-end)
**Mode:** REVIEW · Lens: Zoom-Out (Skeptical Architect) · Second zoom-out pass
**Date:** 2026-11-02

> This is the SECOND zoom-out. It reads `zoom_out_report.md`, `comprehension_report.md`, and `critic_report.md` and reports a prior finding only where the design **still** carries it **and** it still makes the build bigger than "Create on the existing executor." New findings target what the design added or failed to shrink.

## Code graph (Torbit)

- **Queried:** yes. Namespace `user-torbit`, `project_id = 1672773718350201492`, branch `main`, manifest `commit_sha` **`ad63d64316a50852503cd8a408350391d4ddfd2c`** (present in `_orbit_manifest`, equals git HEAD).
- Every query filtered on `project_id = 1672773718350201492`. `gl_edge` has no `project_id`, so edge joins filter on the joined definitions (`s.project_id` / `t.project_id`).
- The graph includes dirty working-tree files; disk may differ from the manifest commit. `execute.ts`, `proposals.ts`, and the listing page were corroborated against the reviewer's on-disk Read.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `zoom-out` (egm-zoom-out, cursor-grok-4.6-high-fast) — Intermediate Zoom-out Reviewer | completed |

Severity breakdown: 0 Blocker · 7 Major · 2 Nit.

**The one-line answer to this pass's question.** The listing **Create executor path already exists and is already wired**: `executeProposal → executeListingCreateCampaign` (`execute.ts:237`) → `createPausedUnifiedCampaign`. The genuinely remaining work is thin — a web Create surface that calls the already-built `buildListingCreateProposal` (`proposals.ts:104`, **no production caller**), persist the returned Unified ids onto `listing_shares`, and call `activateUnifiedCampaign` (`unified-sandbox.ts:191`, **no production caller**) only when `can_activate` is true (false for Stage 0 / sandbox). Everything the design still frames as greenfield enlarges the build past that.

---

## Prioritized Findings (Blockers → Major → Nits)

### M1 — The whole 21-item / 6-wave build plan rebuilds code that already exists and is tested — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Target Files items 1-21 (lines 313-432); Parallel implementation Waves 1-6 (lines 452-473); "What is new, and what is reused" (line 107, still pinned to commit `3f22c76`).
* **Discrepancy Description:** The first zoom-out said "relabel Create → Modify." After the comprehension and critic passes that is no longer enough: the modules are not just present, the **listing Create path is dispatched end to end at HEAD**. Torbit shows every module the plan calls "Create"/"new" already exists with tests: migrations 113-116; `putConnection` (`connections/store.ts:84`); `reallocateListing` / `distributeByLeads` (`monitor/reallocate.ts:65,31`); `executeShareMove` (`execute.ts:459`), `executeListingCreateCampaign` (`execute.ts:237`), `executeListingOnUnifiedSandbox` (`execute.ts:187`), `executeListingBudgetChange` (`execute.ts:329`), `distributeEqualMinor` (`execute.ts:292`); `buildListingCreateProposal` (`proposals.ts:104`); `activateUnifiedCampaign` (`unified-sandbox.ts:191`); `routeInbound` (`router.ts:11`) + `parseInboundText` (`parser.ts:9`); `renderOutbound` (`sender.ts:76`); `setWritesEnabled` (`org-settings.ts:65`); `runDecisionCycle` (`cycle.ts:48`); `app/l/[token]/page.tsx`; `rules/india.ts` + `australia.ts`. Edges confirm wiring: `executeProposal → executeListingCreateCampaign`; WhatsApp `POST → routeInbound → parseInboundText`; `executeShareMove → reallocateListing`; `runDecisionCycle → reallocateListing`. `execute.ts` imports only the Unified helpers (not the Meta/Google share writers).
* **Supporting queries:** `SELECT name, file_path, start_line FROM gl_definition WHERE project_id = 1672773718350201492 AND name IN ('putConnection','reallocateListing','executeShareMove','executeListingCreateCampaign','executeListingOnUnifiedSandbox','buildListingCreateProposal','activateUnifiedCampaign','setWritesEnabled','routeInbound','parseInboundText','renderOutbound','runDecisionCycle')`; `SELECT DISTINCT s.name, s.file_path, t.name FROM gl_edge e JOIN gl_definition s ON e.source_id=s.id JOIN gl_definition t ON e.target_id=t.id WHERE s.project_id=1672773718350201492 AND t.project_id=1672773718350201492 AND t.name IN ('executeListingCreateCampaign','buildListingCreateProposal','activateUnifiedCampaign','executeShareMove')`.
* **Rationale & Recommendation:** An implementer who follows 21 Target Files and 6 waves will rewrite working, tested code. **Collapse the remaining work to web Create on the existing executor.** Leave items 1-3, 7, 11, 13-15, 17, 19-20 as *already built / no-change*. Defer items 8-9, 12, 18, 21 and Order item 2 (WhatsApp/SMS Create) until after the first web build. Refresh the `3f22c76` inventory or drop it.

### M2 — `readListingBuildConfig` forces unsent creatives, blocking reuse of the existing Create builder — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** `readListingBuildConfig` (`execute.ts:112`, called by `executeListingCreateCampaign` at `execute.ts:237`); One listing's path step 2 (line 121); Target Files item 6; Verification "drafter's copy."
* **Discrepancy Description:** `ListingCreatePayload` / `assertListingCreatePayload` on disk are `traceId + ceilings + shares` only, and `executeListingOnUnifiedSandbox` sends name/budget/period/channel/goal only. But `readListingBuildConfig` still requires `endTimeIso`, `pageId`, a Google creative template (keywords, headlines, geo, language, ad group) and Meta `imageHash/message/link` — then discards them; tests pad the slim payload to satisfy it. The design's step 2 ("Keywords, headlines, location, and radius are written onto the proposal") feeds this dead field set.
* **Supporting query:** `SELECT s.name, t.name FROM gl_edge e JOIN gl_definition s ON e.source_id=s.id JOIN gl_definition t ON e.target_id=t.id WHERE s.project_id=1672773718350201492 AND t.project_id=1672773718350201492 AND t.name='readListingBuildConfig'` → only caller is `executeListingCreateCampaign`.
* **Rationale & Recommendation:** Create-on-the-existing-executor cannot cleanly use the built Create path while this helper demands fields Unified never sends. **Cut `readListingBuildConfig` and the "write keywords/headlines/location onto the proposal" sentence.** Do not invent a richer Create shape to feed it.

### M3 — Putting the drafter + citation gate + rule packs on the Create path is work with no platform effect — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** One listing's path step 2 (lines 120-121); Target Files items 16-17 (lines 405-413); Verification "drafter's copy is checked by the rule packs."
* **Discrepancy Description:** The first zoom-out treated grounding/citation/rule packs as correct reuse. At the altitude of *what still needs building*, wiring them onto listing Create now enlarges the slice: copy is never sent to Unified in this phase, so a drafter + citation gate + "rules must pass before the build" gate has no platform consequence. Torbit: `buildGroundingPack` / `assertCitationsAllowed` are called only from `lib/generative/call-prep.ts` (lead-call prep, a later phase); `checkIndiaCopy` / `checkAustraliaCopy` have no production callers; `createPausedUnifiedCampaign` body is name/status/budget/goal only.
* **Supporting query:** `SELECT s.name, s.file_path, t.name FROM gl_edge e JOIN gl_definition s ON e.source_id=s.id JOIN gl_definition t ON e.target_id=t.id WHERE s.project_id=1672773718350201492 AND t.project_id=1672773718350201492 AND t.name IN ('checkIndiaCopy','checkAustraliaCopy','assertCitationsAllowed','buildGroundingPack') AND s.file_path NOT LIKE '%test%'`.
* **Rationale & Recommendation:** Leave `india.ts` / `australia.ts` / `grounding-pack` / `citation-gate` as *already built*, but do not place them on the Create build path until Unified accepts copy. Remove the pre-build copy-gate from the remaining Create work.

### M4 — Three Meta campaigns per listing still overrides the brief and the built 1+1 fixture — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Overview (line 21), The ceiling / Starting shares (lines 126-128, 301-307).
* **Discrepancy Description:** Caught in both prior zoom-out and critic (N3) and still present. `executeListingOnUnifiedSandbox` loops `listing.shares` with no hardcoded 3; the on-disk `execute.test.ts` fixture is **1 Meta share + 1 Google share**. The brief (§3.1, §10 decision 5) says "One live Meta campaign per listing." The doc still starts every listing with 3 Meta campaigns, tripling live Meta objects as a workaround for Unified having no ad-set object.
* **Rationale & Recommendation:** Cut "every listing starts with 3 Meta shares." One Meta Unified campaign this phase; Google stays one Search campaign per share. Do not build a 3-way Meta split to stand in for missing ad sets. (Repeat finding — retained because it still enlarges the build.)

### M5 — Generated images (Order item 3) remain on the Phase 1 ladder against the brief and the doc's own Non-Goals — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Order item 3 (line 448); conflicts with Non-Goals (line 57) and item 16 ("No image generator").
* **Discrepancy Description:** Caught by prior zoom-out and comprehension; still on the build ladder. Brief §3.2 lists generated property images as out; its creative rules state "There is no generated imagery." Not a code-existence claim.
* **Rationale & Recommendation:** Cut Order item 3. Generated images are not deferred Create work and must not sit in the Phase 1 sequence. (Repeat finding — retained because it still enlarges the build.)

### M6 — Wave 6 edits the private MCP files item 20 says not to touch, risking a second writer — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Target Files item 20 (lines 425-428) vs Wave 6 (line 471).
* **Discrepancy Description:** Caught by prior zoom-out; still present. `mcp/google-ads-server/index.ts` imports and calls the direct Google writers `createFullGoogleCampaign`, `createGoogleShareCampaign`, `enableGoogleShareCampaign`, `updateGoogleShareBudget`. Item 20 says "No change" to those files; Wave 6 says the last agent edits "the private MCP tool files."
* **Supporting query:** `SELECT s.fqn, t.fqn FROM gl_edge e JOIN gl_definition s ON e.source_id=s.id JOIN gl_definition t ON e.target_id=t.id WHERE s.project_id=1672773718350201492 AND t.project_id=1672773718350201492 AND t.name IN ('createFullGoogleCampaign','createGoogleShareCampaign','enableGoogleShareCampaign','updateGoogleShareBudget')`.
* **Rationale & Recommendation:** Cut "then the private MCP tool files" from Wave 6. If Wave 6 survives at all, it stops at `cycle.ts`. (Repeat finding — retained because it still enlarges the build and endangers the single-writer invariant.)

### M7 — Corridor Unified rewrite pulls a second product into the Create slice — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Accounts (line 140) — corridor Unified create, and the pause / budget-change / negative-keyword shapes.
* **Discrepancy Description:** The Accounts section specifies corridor create plus pause, budget change, and `targeting.content.excluded_keywords` behaviour as if new. Torbit shows corridor already writes through Unified: `executeCreateCampaign` (`execute.ts:261`) calls `createPausedUnifiedCampaign` for corridor payloads; `addUnifiedNegativeKeyword` (`unified-sandbox.ts:146`) already exists and is imported by `execute.ts`. Listing create is a separate branch (`isListingCreatePayload`).
* **Supporting query:** `SELECT name, file_path, start_line FROM gl_definition WHERE project_id=1672773718350201492 AND name IN ('executeCreateCampaign','addUnifiedNegativeKeyword')`.
* **Rationale & Recommendation:** Leave `executeCreateCampaign` as-is. Cut corridor payload/keyword/negative-keyword rules from the remaining listing Create work — they belong to a product that already ships, not to Create-on-the-executor.

### N1 — `distribute` helper name does not exist; two equivalents already do — Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Lines 301, 309, 438 (references to `distribute` in `reallocate.ts`).
* **Discrepancy Description:** Prior nit, still present. No symbol `distribute` exists. The remainder rule is `distributeByLeads` (`reallocate.ts:31`) and is duplicated as `distributeEqualMinor` (`execute.ts:292`).
* **Supporting query:** `SELECT name, file_path, start_line FROM gl_definition WHERE project_id=1672773718350201492 AND name ILIKE '%distribute%'`.
* **Rationale & Recommendation:** Name `distributeByLeads` precisely. Do not add a third helper.

### N2 — Agent-runbook process details are altitude weeds — Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Parallel implementation (lines 452-473); laptop ops (lines 144-150).
* **Discrepancy Description:** Prior nit, still present. Composer 2.5 slugs, skill-picker routers, `saas-scaffolder` / `payload` / `php-pro` / `laravel-specialist` exclusions, three-terminal setup, `AUTH_BYPASS`, and compose ports do not affect architecture, data flow, or reuse.
* **Rationale & Recommendation:** Move to an agent runbook. Keep the design at the architecture/interface altitude.

---

## Leave as already built — do not schedule as remaining work (graph-backed)

- Migrations 113-116 (all present on disk).
- `putConnection`, the `can_activate` flag, and the allowlist row (`connections/store.ts`).
- `writes_enabled` kill switch (`setWritesEnabled`, `org-settings.ts:65`; enforced in `execute.ts`).
- Listing page `app/l/[token]/page.tsx` (preview only, no Create button — confirmed on disk).
- Inbound parser (`parseInboundText`: code/pause/stop only; no spend+goal Create type) and `routeInbound`, already wired to the WhatsApp route.
- Outbound templates (`renderOutbound`).
- Rule packs `india.ts` / `australia.ts` (built; just not on the Create path — see M3).
- `reallocateListing` / `distributeByLeads` and `executeShareMove` (built; wiring them is later than Create — see below).
- Listing health read and Desk chat (`campaign-chat.ts` / `CampaignDraftChat`) — unchanged.

## Do not add, even where the critic asked (later than Create)

- A crash-reconciliation sweeper (critic M3), a new auto-approved proposal kind for share moves (critic M4), and the `applyMove → executeShareMove` wiring (design item 8). `executeShareMove` and `reallocateListing` already exist; `executeShareMove` has **no production caller** today, but wrapping it now is later than Create. Build Create first; wire the move after a paused build reads back.

---

*Synthesized with EGM*
