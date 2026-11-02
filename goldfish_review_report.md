# Goldfish Annotated Review Report

**Target:** `docs/designs/phase-1-listing-campaign-service.md` (full file)
**Status:** resolved. Applied the proposed fixes below. The instruction was to apply the consolidated review.
**Graph:** Torbit `project_id` `1672773718350201492`, commit `ad63d643`.

## Prioritized Findings & AI Suggestions

### [1] [implementation readiness] - Severity: High
* **Affected Scope:** Target files 1, 2, 2b, 3, 7, 13, 14, 15, 17.
* **Discrepancy Description:** Those files are marked Create. They are already on disk and uncommitted.
* **Rationale:** Following the label overwrites them.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Torbit `gl_file` lists migrations 113–116, `connections/store.ts`, `monitor/reallocate.ts`, `inbound/router.ts`, `inbound/parser.ts`, `outbound/sender.ts`, `rules/india.ts`, `rules/australia.ts`, and `app/l/[token]/page.tsx`.
* ***Proposed Edit:***
    * Location: Each of those headings, and the reuse paragraph.
    * Change: Mark them on disk. Do not recreate them.

### [2] [implementation readiness] - Severity: High
* **Affected Scope:** `executeListingCreateCampaign`, item 6.
* **Discrepancy Description:** Create cannot finish. `readListingBuildConfig` requires ad fields the plan says are never sent, and nothing stores `external_campaign_id`.
* **Rationale:** The only caller is `executeListingCreateCampaign` (`execute.ts` line 237). `buildListingCreateProposal` stores `traceId`, ceilings, and shares.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** The function throws without `endTimeIso`, `pageId`, a Google creative template, and `metaShares`.
* ***Proposed Edit:***
    * Location: Item 6 and Order item 1.
    * Change: Do not require those fields. After Unified returns the campaign id, store it on the share row. Insert the listing, ceiling, and share rows in that same function.

### [3] [implementation readiness, design critic] - Severity: High
* **Affected Scope:** Item 8, the cycle route, the move sections.
* **Discrepancy Description:** The daily move does not run, and a direct write from the monitor would be a second writer.
* **Rationale:** `app/api/cycle/run/route.ts` calls `runDecisionCycle(scope)` with no `shareMoves` and no `applyMove`. `runDecisionCycle` only moves shares when those options are passed.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** The product rule stays. This slice does not ship the move. When it ships, it is a proposal the executor runs.
* ***Proposed Edit:***
    * Location: Moves, item 8, item 10, wave 6.
    * Change: Say the route passes no options. Do not edit the cycle to apply a move in this slice.

### [4] [design critic] - Severity: High
* **Affected Scope:** Risks, stops.
* **Discrepancy Description:** A stop depends on Unified.to being up, and the risks section does not say what happens then.
* **Rationale:** Every write, including pause, goes through Unified.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** The platform budgets already set are the backstop. A second writer is not the fix.
* ***Proposed Edit:***
    * Location: Risks.
    * Change: If Unified is down, the call fails, the proposal is marked failed, and spend stays inside the budgets already on the platform.

### [5] [design critic, comprehension] - Severity: High
* **Affected Scope:** The open-source alternative, line 192.
* **Discrepancy Description:** That line says the service already writes through the direct SDKs. The rest of the design says listing writes go only through Unified. The alternatives never weigh the two.
* **Rationale:** `executeCreateCampaign` already calls `createPausedUnifiedCampaign`. The direct SDK writers are a different path.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Firecrawl, 2026-11-02: Unified writes campaigns on Google Ads and Meta Ads, and ads are a separate object ([Best Unified API for Advertising in 2026](https://unified.to/blog/best_unified_api_for_advertising_in_2026)).
* ***Proposed Edit:***
    * Location: That alternative, plus a new direct-API alternative.
    * Change: The corridor path is the older writer. The listing path is Unified. Reject calling the Google Ads API and the Meta Marketing API for a listing create.

### [6] [zoom out] - Severity: High
* **Affected Scope:** Overview, ceiling, detailed plan.
* **Discrepancy Description:** The design starts three Meta campaigns. The brief says one live Meta campaign per listing.
* **Rationale:** `executeListingOnUnifiedSandbox` loops `listing.shares`. It does not hardcode three.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** One Meta campaign. One Google campaign when the listing is a commercial office.
* ***Proposed Edit:***
    * Location: Those sections.
    * Change: Replace every "3 shares" rule with one campaign per platform.

### [7] [zoom out, comprehension] - Severity: High
* **Affected Scope:** Order item 3, items 16 and 17, path step 2.
* **Discrepancy Description:** Generated images, the drafter, and the rule packs are on the first build. Copy is not sent.
* **Rationale:** `checkIndiaCopy` and `checkAustraliaCopy` have no production callers in the graph. `buildGroundingPack` is called from `call-prep.ts` only.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** The files stay. They do not gate Create.
* ***Proposed Edit:***
    * Location: Order, step 2, items 16 and 17.
    * Change: Remove generated images from this phase's order. Leave the drafter and the rule packs off Create.

### [8] [zoom out] - Severity: High
* **Affected Scope:** Wave 6, item 20, the corridor path.
* **Discrepancy Description:** Wave 6 edits the private MCP writers. The corridor rewrite is not this slice.
* **Rationale:** Item 20 says no change to those files.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Those files call the direct Google writers.
* ***Proposed Edit:***
    * Location: Wave 6 and Order.
    * Change: Do not edit the MCP files. Do not rewrite `executeCreateCampaign`.

### [9] [comprehension] - Severity: Medium
* **Affected Scope:** `distribute`.
* **Discrepancy Description:** The plan cites `distribute`. That function is not in the graph.
* **Rationale:** The remainder split is `distributeByLeads` in `reallocate.ts`. `distributeEqualMinor` in `execute.ts` is a second copy.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Name the function that exists.
* ***Proposed Edit:***
    * Location: Detailed plan and the verification plan.
    * Change: `distributeByLeads`.

### [10] [design critic] - Severity: High
* **Affected Scope:** Path step 4, Accounts.
* **Discrepancy Description:** A crash after switch-on has no actor if the database write did not happen. `can_activate` and the allowlist are unnamed.
* **Rationale:** Migration 113 defines `can_activate BOOLEAN NOT NULL DEFAULT false` and `allowlist TEXT[] NOT NULL DEFAULT '{}'`.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** A reader cannot tell who pauses an orphan or who may turn activation on.
* ***Proposed Edit:***
    * Location: Step 4 and Accounts.
    * Change: Name the worker, then the read-back of campaigns with no stored id. Name the two columns. Nothing in this phase sets `can_activate` true.

### [11] [design critic] - Severity: Low
* **Affected Scope:** Relative links, the duplicated move paragraph under Google refuses a total budget.
* **Discrepancy Description:** Links from `docs/designs/` to repo-root briefs omit `../../`. The Google risk repeats the move paragraph.
* **Rationale:** The links do not resolve. The paragraph is already under Moves.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Both are local text fixes.
* ***Proposed Edit:***
    * Location: Those links and that risk bullet.
    * Change: Prefix `../../`. Delete the repeated sentences.

### [12] [zoom out, design critic] - Severity: Low
* **Affected Scope:** Wording of "listing page" and section order.
* **Discrepancy Description:** Terminology and section order.
* **Rationale:** The listing page is already `app/l/[token]/page.tsx`, and the document is readable.
* ***AI Suggestion:*** DECLINE
* ***Justification:*** The high findings rename the objects that were actually ambiguous. A section reorder does not change the build.
