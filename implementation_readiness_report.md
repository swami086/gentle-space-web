# Implementation Readiness Review Report

**Target:** `docs/designs/phase-1-listing-campaign-service.md` (lines 299–478, `## Detailed Implementation Plan` to end)
**Mode:** REVIEW · Stage 9 (Implementation Readiness)
**Readiness verdict:** **NO.** A fresh implementer cannot build only the remaining first-campaign "Create" work from this plan without rewriting files that already exist, and the create path as described cannot execute end to end against the code on disk.

## Reviewer Status

| Reviewer | Model | Status |
| --- | --- | --- |
| `egm-implementation-readiness` | claude-opus-4-8-thinking-high | completed |
| `egm-codebase-details` | claude-sonnet-5-5-high | completed |
| `egm-style` | composer-2.5-fast | completed |

**Torbit queried:** yes. Namespace `user-torbit`, `project_id = 1672773718350201492`, branch `main`, graph `commit_sha ad63d64316a50852503cd8a408350391d4ddfd2c` = git HEAD. Every query filtered on that `project_id`.

### Graph-vs-HEAD reconciliation (resolves a reviewer conflict)

The two codebase reviewers disagreed on what the graph contains. Direct check settles it: the Torbit graph **indexes the working tree**, so `gl_file` returns the untracked "Create" files, but `git cat-file -e HEAD:<path>` fails for every one of them — they are **uncommitted on disk, not at HEAD**. The synthesizer confirmed this (`git cat-file` on `store.ts`, `monitor/reallocate.ts`, `outbound/sender.ts`, `app/l/[token]/page.tsx`, `migrations/113_connections.up.sql` → all `NOT_AT_HEAD`). Material point is identical either way: **the files the plan labels `Create` already exist on disk**, so following the labels literally overwrites existing work. The `implementation-readiness` reviewer's phrasing ("already exist at HEAD") is corrected to "already exist on disk, uncommitted."

### Torbit queries behind the code claims in this report

- **Q1** `gl_file` filtered on the 16 cited `Create`/`Modify` paths → all present in working-tree graph (`store.ts`, `monitor/reallocate.ts`, `outbound/sender.ts`, `rules/india.ts`, `rules/australia.ts`, `inbound/parser.ts`, `inbound/router.ts`, `connectors/unified-sandbox.ts`, `app/l/[token]/page.tsx`, migrations 113/114/115/116, `executor/execute.ts`, `decision-engine/cycle.ts`, `tracing/otlp-sink.ts`).
- **Q2** `gl_definition WHERE name IN (...)` → `distributeByLeads` (`reallocate.ts:31`), `distributeEqualMinor` (`execute.ts:292`), `reallocateListing` (`reallocate.ts:65`), `executeShareMove` (`execute.ts:459`), `activateUnifiedCampaign` (`unified-sandbox.ts:191`), `otlpSpanSink` (`otlp-sink.ts:69`), `createMetaListingShares` (`meta.ts:165`), `createGoogleShareCampaign` (`google-ads.ts:60` and `mcp/google-ads-server/tools.ts:282`), `scheduleProposal` (`proposals.ts:277`), `putConnection` (`store.ts:84`), `assertAccountAllowed` (`store.ts:162`). **No row named `distribute`.**
- **Q3** `gl_imported_symbol` for `cycle.ts` → imports `reallocateListing`, `ReallocateListingInput`, `ReallocateMove` from `../monitor/reallocate`.
- **Q4** `git cat-file -e HEAD:<path>` on five `Create` files → all `NOT_AT_HEAD` (uncommitted).
- Behavioural claims (payload shapes, hardcoded args, template text, unwired callers) rest on the codebase reviewer's disk `Read`/`Grep`, cited inline.

---

## Prioritized Findings (Blockers → Major → Nits)

### B1. A dozen files labelled `Create` already exist on disk
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Items 1 (113), 2 (114), 2b (115), 3 (`connections/store.ts`+test), 7 (`monitor/reallocate.ts`+test), 13 (`inbound/router.ts`, `parser.ts`), 14 (`outbound/sender.ts`), 15 (`app/l/[token]/page.tsx`), 17 (`rules/india.ts`, `australia.ts`); item 6b `unified-sandbox.ts` labelled `Modify` is also brand-new on disk.
* **Discrepancy Description:** Q1 returns every path in the graph; Q4 confirms none is at HEAD — they are finished, uncommitted drafts (e.g. `reallocate.ts` 145 lines already implements the day-3 / same-day / ceiling-day / spend-floor / sum rules; `page.tsx` 192 lines already has the HMAC token check, 7-day cap and preview). An implementer executing the `Create` labels overwrites this work or stalls on "create what already exists."
* **Rationale & Recommendation:** This is the direct answer to the readiness question. Replace the `Create`/`Modify` labels with an `Exists / Modify / Verify` table reconciled against a baseline commit of the working tree, and state current contents are the baseline. Commit the working tree first so "Modify from committed baseline" cannot clobber the drafts.

### B2. The first-campaign Create cannot execute end to end
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Items 6 and 10; opening paragraphs (301–304); `execute.ts:111–158, 185–233`; `types.ts:82`; `proposals.ts:~104`.
* **Discrepancy Description:** Two code facts make the approved create fail: (1) `buildListingCreateProposal` builds a payload of `{traceId, ceilings, shares}` only — `ListingCreatePayload` has no `listingId` — yet `executeListingCreateCampaign` → `readListingBuildConfig` throws unless the payload carries `endTimeIso`, `pageId`, a `google` template and `metaShares` with `imageHash`. Those are exactly the Meta ad / creative / Google keyword fields lines 302–304 say are **not** sent. (2) No non-test `lib`/`app` code inserts `adsagent.listings`, `listing_ceilings`, `listing_shares` or `listing_build_steps`; `executeListingOnUnifiedSandbox` creates paused campaigns but never stores `external_campaign_id`; `spend_minor`/`lead_count` are never written. `executeShareMove` and `executeListingBudgetChange` therefore throw "has no external_campaign_id" on first run.
* **Rationale & Recommendation:** The plan enumerates `Create` migrations and an executor claim but never names who inserts the listing/ceiling/share rows or who feeds the counters, and it mandates a payload the executor rejects. Add `listingId` to `ListingCreatePayload`, remove the `readListingBuildConfig` ad-field requirement, and name the writer that persists listing/ceiling/share rows and `external_campaign_id`.

### B3. The move / cycle path is wired to nothing; "remaining work" is misstated
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Items 6 and 8; "A move" paragraph (309, 368–369); `cycle.ts:83`, `execute.ts:459, 514, 518`; `app/api/cycle/run/route.ts`.
* **Discrepancy Description:** Q3 confirms `cycle.ts` imports and calls `reallocateListing` (line 83), but `runDecisionCycle` only acts on `options.shareMoves`/`options.applyMove`, and `route.ts` calls `runDecisionCycle(scope)` with no options, so a move never runs. Nothing builds `ReallocateListingInput[]` from `listing_shares`/`listing_ceilings`. `executeShareMove` re-calls `reallocateListing` internally (double evaluation) and hardcodes `ceilingChangedToday: false` (line 518) and `writesEnabled: true` (line 514), so the ceiling-change skip (308, 368) and the kill switch have no data source; migration 114 records only `last_share_move_on`. Item 8's claim that the only remaining work is the `applyMove` body is false.
* **Rationale & Recommendation:** Specify how the cycle's `shareMoves` input is built, where `ceilingChangedToday` and `writesEnabled` come from (a column vs the hardcoded literals), and remove the duplicate `reallocateListing` evaluation. State precisely what is done vs. to-do against the committed baseline.

### B4. `distribute` in `reallocate.ts` does not exist
* **Reviewer Lens:** `egm-codebase-details` (Blocker), `egm-implementation-readiness` (Nit)
* **Affected Scope:** Intro line 299/303, item 7 (361), Verification (438) — "the remainder rule in `distribute`".
* **Discrepancy Description:** Q2 returns no symbol `distribute`. The remainder routine is `distributeByLeads` (non-exported, `reallocate.ts:31`), and a separate copy, `distributeEqualMinor`, lives at `execute.ts:292`. The plan cites `distribute` three times as current-state code.
* **Rationale & Recommendation:** A cited current-state reference that does not exist. Severity split across reviewers; retained as Blocker because the doc presents it as an existing shared function to follow and to test against. Rename to `distributeByLeads`, or extract one shared function from `distributeByLeads` + `distributeEqualMinor` and reference that.

---

### M1. `otlpSpanSink` exists but is unwired; the plan leaves the span design to the implementer
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Item 6, line 357; `otlp-sink.ts:69`.
* **Discrepancy Description:** Q2 confirms `otlpSpanSink` at `otlp-sink.ts:69` (committed), but `execute.ts` has no tracing import (only a vitest mock in `execute.test.ts:107`). The plan says "pass the trace id into the existing `otlpSpanSink`" without saying where the span is emitted or which `SpanSink` interface to use.
* **Rationale & Recommendation:** Zero-Decision violation. Name the emission point and interface.

### M2. The kill switch is half-wired and contradicts item 11
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Items 2b, 11, 12; `execute.ts:440`, `org-settings.ts`.
* **Discrepancy Description:** Only `executeShareMove` calls `readWritesEnabled` (`execute.ts:440`); `executeProposal` (create, pause, `budget_change`, negative keyword) never checks it. Item 11 says engaging the switch "blocks every write except a stop," but line 357 only has `executeShareMove` throw. `org-settings.ts` writes_enabled read/write and migration 115 are uncommitted (HEAD has 0 matches; disk has 5), so "already reads and writes" is true only on the working tree.
* **Rationale & Recommendation:** Either wire the check into `executeProposal` for all write kinds or correct item 11 to match the move-only behaviour.

### M3. Inbound router and parser do not do what item 13 says
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Item 13 (391–392); `inbound/parser.ts`, `inbound/router.ts` (uncommitted, 28 and 37 lines).
* **Discrepancy Description:** The parser matches only `^\d{6}$`, PAUSE, STOP, RESUME, LEASED. There is no "daily spend limit + goal" detection, which the settled facts make the first-campaign Create approval. `routeInbound` does `void input.orgId` — no phone-to-org resolution before parsing. `noteWrongCode(previousCount)` is stateless with nothing storing the count. The "unmatched number keeps renter enquiries" branch is absent.
* **Rationale & Recommendation:** The Create-by-text path is unspecified and unbuilt. Define the spend-limit+goal grammar, the phone→org resolution, and durable wrong-code counting.

### M4. `sender.ts` template contradicts the no-code-before-first-build rule
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Item 14, line 398; `sender.ts` `renderApproval`.
* **Discrepancy Description:** `renderApproval` renders "Reply {code} to build. Share moves … run without a new code." The plan and the settled facts say Create sends no code. The file also only renders — nothing sends WhatsApp/SMS, and `executeShareMove` just `console.info`s the body. `renderMove` prints the raw `(${ceilingMinor})` after the formatted ceiling.
* **Rationale & Recommendation:** Resolve the template-vs-plan contradiction and name the transport that actually sends.

### M5. `classifyInboundLead` would drop every live lead under Unified create
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Item 18, line 418; `enquiries.ts` (uncommitted).
* **Discrepancy Description:** `classifyInboundLead({formId, googleAssetId, isTest})` returns `store:false` when both ids are null. The plan says "do not add a form id or a Google asset id in this phase," and Unified create produces neither — so every live lead is dropped. No caller found.
* **Rationale & Recommendation:** Following "Modify" literally leaves a function that fights the plan. Define how listing leads are stored without those ids.

### M6. `rules.ts` findings and `ProposalKind` lack end-early / extend-end-date
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Item 9, line 371; `rules.ts:39,87,108,139`, `types.ts:60`, `execute.ts:100–111`.
* **Discrepancy Description:** `rules.ts` emits only `pause`, `budget_change`, `add_negative_keyword`, `create_campaign`. `ProposalKind` has no end-early or extend-end-date kind; `execute.ts` sends unknown kinds to a `default:` throw. The plan's "extend end date and ending early can be approved and stored, then marked failed" depends on a kind and payload shape the plan never defines.
* **Rationale & Recommendation:** Define the proposal kind and payload for the two stored-then-failed actions, or drop the claim.

### M7. Connection selection, allowlist and credentials are underspecified (design decisions)
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Items 3 and 6, lines 318, 339, 351; `store.ts:84,162`.
* **Discrepancy Description:** `assertAccountAllowed` (`store.ts:162`) has no caller and no paging mechanism, so "pages the owner and does not run" is unbuilt. `credentials_sealed` is `BYTEA NOT NULL` and `putConnection` requires a `Buffer`, but the plan says no token is stored and `putConnection` does not call `sealSecret` — leaving the implementer to choose placeholder bytes. `resolveUnifiedConnection` refuses a `stage0-pending` sentinel the plan never defines. Connection choice is `listCurrent(scope).find(c => c.platform === platform)` (first match), while the unique index is `(platform, external_account_id)`, not `(org, platform)` — an org can hold several current rows per platform. Live/test mode comes from an in-process `connectionModes` Map, so "same connection id never used for both" has no durable enforcement. No app code calls `putConnection`.
* **Rationale & Recommendation:** Several Zero-Decision violations. Pre-decide placeholder credential bytes, the `stage0-pending` contract, the connection-selection key, and the durable mode store.

### M8. Executor never switches a share on; "starts only when `can_activate` is true" describes nonexistent behaviour
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Item 6, line 350; Order 1; Stage 1; `unified-sandbox.ts:191`.
* **Discrepancy Description:** `activateUnifiedCampaign` exists (Q2, `unified-sandbox.ts:191`) with the `can_activate` + Sandbox checks, but `execute.ts` does not import it; `executeListingOnUnifiedSandbox` always returns `activated:false` and no code reads `can_activate`. `ExecuteFaultPoint` defines `after_partial`/`after_readback`/`after_switch` but only `after_claim` is ever thrown.
* **Rationale & Recommendation:** Consistent with the settled "Stage 0 stays paused" fact for Stage 0, but the plan describes a Stage 1 switch-on path that is not wired. Name the wiring or scope it out explicitly.

### M9. "No change" items contradicted by the Waves list
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Items 19, 20 vs Waves 5 and 6; `ledger.ts`, `mcp/google-ads-server/tools.ts` (+252 uncommitted lines, Q2 shows direct-API `createGoogleShareCampaign` at `tools.ts:282`).
* **Discrepancy Description:** Item 19 says `ledger.ts` is "No change" while Wave 5 assigns it to an agent (it already has an uncommitted `listingUsageEntry`). Item 20 says "No change" to the MCP server while Wave 6 says "then the private MCP tool files." Direct-write share functions (`createMetaListingShares` `meta.ts:165`, Google equivalents in `google-ads.ts` and `tools.ts`) exist and are left live; the plan never says to delete or fence them beyond the negative-import test.
* **Rationale & Recommendation:** Reconcile the per-file "No change" labels with the wave assignments, and state whether the dormant direct-write functions are deleted or retained.

### M10. Schemas are outsourced to the migration files, not in the plan
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Items 1, 2, 2b (316, 322, 326).
* **Discrepancy Description:** Each says "The columns, types, and checks are the ones in `NNN_*.up.sql`. Do not restate them." A reader with only lines 299–end has no column list. The standard requires data schemas to be in the plan. Compounded by B1: the plan both tells the implementer to `Create` `113_connections.up.sql` and treats that file's body as the authoritative given.
* **Rationale & Recommendation:** Either inline the schema or mark the migrations as existing deliverables and point to them.

### M11. "No production code is written by this design step" contradicts the Create/Modify items
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`
* **Affected Scope:** Verification Plan, line 437, vs items 1–21.
* **Discrepancy Description:** The doc asserts no production code is produced, yet enumerates production files to Create/Modify and those files already exist committed/uncommitted on disk.
* **Rationale & Recommendation:** Clarify that the step reconciles already-written code; the no-op framing misrepresents the work.

### M12. Undefined or overloaded referents force the implementer to guess
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Opening (301–307), "Starting shares" (307), item 1 (318), item 6 (353), item 11 (383), item 16 (408), items 12–14 (388–398), Order 2 (447), closing (450).
* **Discrepancy Description:** Terms that drive behaviour are never anchored in this section: "later card" (Desk UI vs WhatsApp vs proposal type), "this build"/"the build" (first create vs any executor run vs share creation), "Create" used as an undefined proper-noun process, "undo window" (gates shipping, appears once), "the drafter" (no module named), "a stop" (item 11 — no mechanism named), "crashed build" / "the fault point … after the claim" (what is resumed, which recovery path). `can write` "stored on the row" (line 318) reads like a column name but uses a space and is not tied to `writes_enabled`.
* **Rationale & Recommendation:** Add one-line anchors for each term the first time it appears in this section, and name the `can write` column precisely.

### M13. Keywords-vs-negative-keyword and consultant-vs-owner contradictions within the section
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Closing (450) vs Wave 1 (466); "A move" (309) vs Stage 1 (441).
* **Discrepancy Description:** The closing paragraph says keywords (and headlines, location) "stay unsent until Unified campaign create accepts them," while Wave 1 lists "negative-keyword calls" in `execute.ts` — the implementer cannot tell whether negative keywords are in phase-1 scope. The move notification goes to "the consultant" (309) but Stage 1 success "texts the owner" (441) — same recipient or two roles is unstated, which matters for templates and tests.
* **Rationale & Recommendation:** State explicitly whether negative keywords are in scope, and unify the recipient role.

---

### N1. Wave ordering has a backward dependency
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Waves (464–472) vs item 6.
* **Discrepancy Description:** `execute.ts` is edited in wave 1 but `executeShareMove` calls `reallocateListing`, and `monitor/reallocate.ts` is scheduled in wave 5 (consumer before producer). Covered only by the wave-4 "close a gap" escape hatch; moot today because both exist on disk.
* **Rationale & Recommendation:** State the dependency so a from-scratch rebuild does not wire `executeShareMove` against a not-yet-created `reallocate.ts`.

### N2. Single-writer guarantee is a negative-test perimeter, not removal
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Items 4, 5, 20.
* **Discrepancy Description:** The direct-write functions remain live (Q2); single-writer rests on one test asserting `execute.ts` does not import them plus item 20 keeping the MCP server unused. Correct guard, but any new importer re-opens a second write path.
* **Rationale & Recommendation:** Add a one-line note that the guarantee is a negative-import perimeter; not a defect for this phase.

### N3. Unwired callers and undefined config
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Items 15, 16, 21; `.env.example`.
* **Discrepancy Description:** `listingSharesHealthy` (`google-ads-health.ts`, item 21) has no caller. The rule packs `rules/india`, `rules/australia` have no caller, so "the first build does not start until the check passes" has no enforcement point. `page.tsx` reads `LISTING_PAGE_SECRET`, absent from the plan and `.env.example`. `grounding-pack.ts`/`citation-gate.ts` (item 16) are committed and read the enquiry flow; "On the listing path" is undefined.
* **Rationale & Recommendation:** Name the call sites that enforce the rule-pack gate and the health read, and add `LISTING_PAGE_SECRET` to config.

### N4. Wave path and label slips
* **Reviewer Lens:** `egm-codebase-details`, `egm-style`
* **Affected Scope:** Wave 5 (`campaign-chat.ts`), Parallel implementation (460).
* **Discrepancy Description:** `campaign-chat.ts` is at `ads-agent/lib/decision-engine/campaign-chat.ts`; the plan gives no path. "reallocater" (460) is a typo for reallocate.
* **Rationale & Recommendation:** Add the path; fix the typo.

### N5. Telegraphic phrasing and process-meta bulk
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** "A move" (309), Parallel implementation (454–462).
* **Discrepancy Description:** "The ceiling change wins that cycle" is recoverable from the adjacent skip rule but terse. The subagent/Composer/skill-picker block is process meta that dilutes the file-level requirements engineers need.
* **Rationale & Recommendation:** Optional: tie "wins" to "move skipped"; consider moving the process-meta block to an appendix.

---

## Checked and explicitly NOT flagged (consistent with the settled facts / brief)

* **Single writer:** the proposal executor remains the only listing writer; direct-write functions are fenced by a negative-import test and item 20. Not reopened (N2 is a note, not a violation).
* **Generated images:** item 16 "No image generator," Order 3 defers them and "does not start with item 1," Verification "No image-generator test." Properly fenced.
* **Three Meta campaigns:** the design's three **paused** Unified campaigns match `concepts_brief.md`; Stage 0 keeps `can_activate` false, so nothing is shipped or activated. Not a brief violation.
* **Create-is-approval / no text code before the first build / Sandbox + Stage 0 paused:** stated consistently across the plan body, Order 1, and items 6/12/13.
* **Verified present at HEAD/disk (not Non-Existent References):** `scheduleProposal` (`proposals.ts:277`, approve route passes `decidedBy: userId`), `otlpSpanSink`, `sealSecret`, `app/api/proposals/*`, `claimDueScheduledProposals` (claims only `status='scheduled'`, sets `executing_until = now()+5min`, no renewal). `putConnection` does not call `sealSecret` and `executeShareMove` throws when `writes_enabled` is false, both as the plan states.

---

*Synthesized with EGM · reviewers: [Implementation Readiness Reviewer](1df00e3d-efc6-4c79-93be-b06aaa48623e), [Codebase Details Reviewer](07687ca5-e3a6-4f68-ba50-ec3e34c11098), [Style Reviewer](c61b4b6f-cd7b-4d33-b355-a5785b340ea8)*
