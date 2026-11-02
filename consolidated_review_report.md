# Consolidated review: Phase 1 listing campaign design

**Target:** `docs/designs/phase-1-listing-campaign-service.md` (full file)

**Date:** 2026-11-02

**Graph:** Torbit `project_id` `1672773718350201492`, commit `ad63d643`, which is `git HEAD`. Uncommitted files are on disk and show up in the graph; they are not in that commit.

**Verdict:** Do not implement this plan as written. The first campaign is still Create on the existing executor. The plan, as labelled, would rebuild files that already exist and would still fail to create a campaign end to end.

## Reviewer status

| Stage | Report | Status |
| --- | --- | --- |
| 5 Zoom out | `zoom_out_report.md` | completed |
| 6 Comprehension | `comprehension_report.md` | completed |
| 7 Critic | `critic_report.md` | completed (design, structural, style) |
| 8 Intermediate zoom out | `intermediate_zoom_out_report.md` | completed |
| 9 Implementation readiness | `implementation_readiness_report.md` | completed (readiness, codebase, style) |

## Action items

### Blockers

1. **Stop treating finished files as new.** Migrations 113–116, `connections/store.ts`, `monitor/reallocate.ts`, the inbound router and parser, `outbound/sender.ts`, `app/l/[token]/page.tsx`, and the India and Australia rule packs are on disk. The plan marks them `Create`. Following that label overwrites them. Relabel against the working tree, and commit that tree before anyone edits it.
2. **The existing Create call cannot finish.** `executeListingCreateCampaign` calls `readListingBuildConfig`, which throws unless the payload has Meta and Google ad fields the plan says are never sent. Nothing outside tests inserts listing, ceiling, or share rows, or stores `external_campaign_id`. A share move and a budget change then throw. The remaining work is to drop that field requirement, persist the rows and the campaign id, and call the executor that already exists. It is not a new writer.
3. **The daily move does not run.** `runDecisionCycle` only moves shares when it is given options. The cycle route calls it with none. `executeShareMove` hardcodes the ceiling-change flag and the kill switch. Item 8's claim that the only leftover is `applyMove` is false.
4. **A stop depends on Unified.to being up.** Every write, including pause, goes through Unified. The risks section never says what happens when Unified is down. The platform budgets already set are the backstop. Say that. Do not add a second writer to paper over it.

### Major

5. **Weigh Unified-only against the direct SDKs, in the alternatives.** The repo already has `google-ads-api` and `facebook-nodejs-business-sdk`. Line 191 says the service already writes through them. The rest of the design says listing writes go only through Unified. One of those sentences has to name the old path and the other the listing path.
6. **One Meta campaign per listing.** The brief says one live Meta campaign. The design starts three. The on-disk test fixture is one Meta share and one Google share. Cut the "three Meta shares" rule.
7. **Take generated images off this phase.** Order item 3 schedules them. The brief and the design's own non-goals forbid a generated photo of the property. They are not the next item after Create.
8. **Do not put the drafter or the rule packs on the first Create.** Unified campaign create in this phase does not send copy. `checkIndiaCopy` and `checkAustraliaCopy` have no production callers. Leave those files. Do not make them a gate in front of a build that cannot carry the words.
9. **Do not edit the private MCP writers in this phase.** Wave 6 tells an agent to edit files item 20 says not to touch. Those files call the direct Google writers. That is a second writer.
10. **Leave the corridor campaign path alone.** It already creates through Unified. It is not the listing Create slice.
11. **Name `distributeByLeads`.** The plan cites `distribute`. That function is not in the graph. The remainder split is `distributeByLeads` in `reallocate.ts`. A second copy is `distributeEqualMinor` in `execute.ts`.
12. **Say who recovers a crashed build.** A crash after switch-on and before the database write leaves objects the database cannot name. Name the recovery read, or say orphans are accepted and how they are found.
13. **Define the allowlist and who may set `can_activate`.** Isolation and the paused-to-live gate both depend on those, and neither is specified in the feature half.
14. **A share move is still the executor.** The monitor must not write budgets itself. If the move stays, it is a proposal the existing executor runs.
15. **Fix the inbound and outbound text against Create.** The router does not yet treat a spend limit and a goal as Create. `sender.ts` still reads as if the first build waits for a code. That work is the phone step, after web Create.

### Nits

16. One word for the spend cap, one word for a later approval, and one name for the page that never approves. "Listing page" and "campaign page" are not defined as the same surface.
17. Relative links from `docs/designs/` to the repo-root briefs are missing `../../`.
18. Cut the agent-runbook paragraphs and the duplicated Google-budget paragraph under Risks.

## Traceability

| Action | Sources |
| --- | --- |
| 1 Relabel existing files | Zoom-out stale inventory; critic M7; intermediate M1; readiness B1 |
| 2 Create cannot finish | Intermediate M2; readiness B2 |
| 3 Daily move unwired | Critic M4; readiness B3 |
| 4 Unified outage and stops | Critic B1 |
| 5 Unified vs SDKs | Comprehension finding 2; critic M1, M2 |
| 6 One Meta campaign | Zoom-out three-campaigns; intermediate M4 |
| 7 No generated images | Zoom-out; comprehension finding 1; intermediate M5 |
| 8 Drafter not on Create | Intermediate M3 |
| 9 No MCP wave | Zoom-out wave 6; intermediate M6 |
| 10 Leave corridor path | Intermediate M7 |
| 11 `distributeByLeads` | Zoom-out nit; comprehension finding 3; intermediate N1; readiness B4 |
| 12 Crash recovery | Critic M3 |
| 13 Allowlist and `can_activate` | Critic M5; readiness M8 |
| 14 Move through the executor | Critic M4 |
| 15 Phone text after web Create | Readiness M3, M4 |
| 16–18 Wording, links, weeds | Critic M8, M9, M10; zoom-out and intermediate nits |

## What the review did not overturn

Create, with a daily spend limit and a goal, is the approval for the first campaign. There is no text code before that build. Sandbox and Stage 0 stay paused. Later changes still need a code. A stop needs no code. The proposal executor is the only writer. `concepts_brief.md` wins where this design disagrees.
