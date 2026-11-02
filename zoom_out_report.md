# Goldfish Review Report — Stage 5 (Initial Zoom Out)

**Target:** `docs/designs/phase-1-listing-campaign-service.md` (full file; FeatureRange lines 1-298, DetailedRange lines 299-end)
**Mode:** REVIEW · Lens: Zoom-Out (Skeptical Architect)
**Date:** 2026-11-02

> This report replaces the earlier `zoom_out_report.md` that was written without the code graph. Torbit was queried this time.

## Code graph (Torbit)

- **Queried:** yes. project_id `1672773718350201492`, branch `main`, manifest commit `ad63d64316a50852503cd8a408350391d4ddfd2c` (= git HEAD).
- Schema confirmed via `get_graph_schema`. Note: `gl_edge` has no `project_id` column, so edge joins filter on the joined definitions' `project_id` (`s.project_id` / `t.project_id`).
- The graph includes dirty working-tree files; disk may differ from the manifest commit. Findings that depend on uncommitted files say so.
- Queries that supported the findings are named inline under each finding.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `zoom-out` (egm-zoom-out, cursor-grok-4.6-high-fast) | completed |

Severity breakdown: 0 Blocker · 4 Major · 2 Nit.

**Context sufficiency:** Pass. A fresh reader can state the objective (one lease listing; Create is the first approval; Unified is the only platform write path; in-ceiling share moves texted after the fact; later changes still coded; the shared Gentle Space login removed before a second customer). The design solves the root problem rather than patching a symptom. Create-as-approval, sandbox/`can_activate` false, executor-only writes, and the rejections of the Ryze GitHub repo and the read-only `google-ads-mcp` match the brief and the supplied design facts — these are not YAGNI misses.

## Prioritized Findings (Blockers → Major → Nits)

### Stale reuse inventory marks existing modules as "Create" — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Target Files items 1-3, 7, 13-15, 17; Technical Plan "What is new, and what is reused" (~line 107).
* **Discrepancy Description:** Line 107 still cites commit `3f22c76` (2026-10-30) and calls the kill switch, inbound router, listing page, outbound texts, and monitor "new" / "not in the code yet." The Target Files list still marks migrations 113-115, `connections/store.ts`, `monitor/reallocate.ts`, `inbound/router.ts`, `inbound/parser.ts`, `outbound/sender.ts`, `app/l/[token]/page.tsx`, and `lib/rules/india.ts` / `australia.ts` as **Create**. Torbit shows these already exist on disk: `putConnection` (`lib/connections/store.ts:84`), `reallocateListing` (`lib/monitor/reallocate.ts:65`), `renderOutbound` (`lib/outbound/sender.ts:76`), `setWritesEnabled` (`lib/db/org-settings.ts:65`), `executeShareMove` (`lib/executor/execute.ts:459`), `routeInbound` / `parseInboundText` in the inbound modules, plus the `app/l/[token]/page.tsx` file and the migration files. `runDecisionCycle` already calls `reallocateListing`. The graph is at commit `ad63d643`; git status confirms these paths are untracked/modified, so disk is dirty and already contains this design's modules.
* **Supporting queries:** `SELECT fqn, file_path, definition_type, start_line FROM gl_definition WHERE project_id = 1672773718350201492 AND name IN ('putConnection','reallocateListing','executeShareMove','setWritesEnabled','routeInbound','parseInboundText','renderOutbound')`; `SELECT path FROM gl_file WHERE project_id = 1672773718350201492 AND (path ILIKE '%113_connections%' OR path ILIKE '%app/l/%' OR path ILIKE '%rules/india%')`.
* **Rationale & Recommendation:** An implementer who follows "Create" / "not in the code yet" will rewrite working code. Relabel those items **Modify**, refresh the commit reference, and scope the remaining work to wiring (`applyMove` → `executeShareMove`, phone-to-org before parse, Create-from-text), not greenfield files.

### Generated images on the build ladder contradict the brief and the doc's own Non-Goals — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Order item 3 (line 448); conflicts with Non-Goals (line 57) and Target Files item 16 (line 407).
* **Discrepancy Description:** Order item 3 ("Generated images last. One pinned model, a cap, a provenance flag, and a ledger row.") schedules a feature the brief forbids. `concepts_brief.md` §3.2 lists "generated property images" as out, and its creative rules state "There is no generated imagery." This document's own Non-Goals (line 57, "invented photos of the property") and item 16 ("No image generator") say the same.
* **Rationale & Recommendation:** Speculative scope, not a deferred note. Remove item 3 from the build ladder. The brief wins on conflict, and here the doc already agrees with it everywhere except this line.

### Three Meta campaigns per listing overrides the brief's one-campaign rule silently — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** The ceiling / Starting shares (lines 126-128, 301-307).
* **Discrepancy Description:** The plan starts every listing with 3 Meta Unified campaigns (plus 3 Google shares for a commercial office). `concepts_brief.md` §3.1 and §10 decision 5 say "One live Meta campaign per listing. Google may be one Search campaign per share." Three Meta campaigns is a workaround for Unified having no ad-set object, not a brief rule, and it triples the live Meta objects. The document's own header says the brief wins on conflict, yet this is an unflagged divergence.
* **Rationale & Recommendation:** Either conform to the brief (one Meta campaign this phase; defer Meta share-moves until an ad-set shape exists; Google can still be one Search campaign per share) or state explicitly that the owner amended the brief to allow 3 Meta campaigns. As written it neither matches the brief nor records the exception.

### Wave 6 edits private MCP files that item 20 says not to touch — Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Target Files item 20 (lines 425-428) vs Parallel implementation Wave 6 (line 471).
* **Discrepancy Description:** Item 20 says "No change" to `mcp/google-ads-server/tools.ts` and the app-data MCP server, and that the listing executor does not use that server for platform writes. Wave 6 says the last agent edits "the private MCP tool files." Torbit shows `registerWriteTools` in `mcp/google-ads-server/index.ts` calls `createFullGoogleCampaign`, `createGoogleShareCampaign`, `enableGoogleShareCampaign`, and `updateGoogleShareBudget` — the direct platform writers the design explicitly keeps off the listing path. Editing those files in Wave 6 is forbidden work and risks introducing a second writer.
* **Supporting query:** `SELECT s.fqn, s.file_path, t.fqn, e.relationship_kind FROM gl_edge e JOIN gl_definition s ON e.source_id = s.id JOIN gl_definition t ON e.target_id = t.id WHERE s.project_id = 1672773718350201492 AND t.project_id = 1672773718350201492 AND t.name IN ('createFullGoogleCampaign','createGoogleShareCampaign','enableGoogleShareCampaign','updateGoogleShareBudget')`.
* **Rationale & Recommendation:** Make Wave 6 stop after `cycle.ts` / the cycle route. Drop "then the private MCP tool files" so the plan and item 20 agree and the single-writer invariant holds.

### `distribute` helper name does not exist; two equivalents already do — Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Lines 301 and 309 (references to `distribute` in `reallocate.ts`).
* **Discrepancy Description:** No symbol named `distribute` exists. The floor-then-largest-fraction remainder rule is `distributeByLeads` (`lib/monitor/reallocate.ts:31`, called by `reallocateListing`) and is also copied as `distributeEqualMinor` (`lib/executor/execute.ts:292`, called by `executeListingBudgetChange`).
* **Supporting query:** `SELECT fqn, file_path, definition_type, start_line FROM gl_definition WHERE project_id = 1672773718350201492 AND name ILIKE '%distribute%'`.
* **Rationale & Recommendation:** Name the existing function(s) precisely. Do not add a third helper; if anything, note the existing duplication rather than inventing a new name.

### Agent-runbook process details are altitude weeds in a design doc — Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Parallel implementation (lines 452-473).
* **Discrepancy Description:** Composer 2.5 slugs, skill-picker routers, and the `saas-scaffolder` / `payload` / `php-pro` / `laravel-specialist` exclusions do not affect architecture, data flow, or reuse.
* **Rationale & Recommendation:** Move these to an agent runbook. Keep the design at the architecture/interface altitude.

## Reuse the design got right (graph-backed — do not "fix" these)

- `executeProposal` (`execute.ts:566`) and `claimDueScheduledProposals` (`proposals.ts:380`) exist; `runProposalUndoTick` calls `executeProposal`. Keeping the existing proposal engine is correct.
- `execute.ts` imports `createPausedUnifiedCampaign`, `pauseUnifiedCampaign`, `updateUnifiedCampaignBudget` from `unified-sandbox` and does **not** import the Meta/Google share writers (`createMetaListingShares`, `updateMetaAdSetLifetimeBudget`, `createGoogleShareCampaign`, `updateGoogleShareBudget`, `enableGoogleShareCampaign`, `createFullGoogleCampaign`). Items 4-6 "do not call" are already true on disk.
- `putConnection` does not import `sealSecret`; `sealSecret` is only called from `provisionSnapshotStorage` (`snapshot-iam.ts`). The envelope claim in the design holds.
- `otlpSpanSink` exists (`otlp-sink.ts:69`); wiring the proposal trace id into it is reuse, not a new sink.
- `campaign-chat.ts` and `CampaignDraftChat.tsx` exist; leaving them unchanged is correct.
- `enquiries.ts` already has `listing_id`; item 18 reuses that column.
- `grounding-pack.ts` and `citation-gate.ts` exist; using them on the listing path is reuse.
- New `inbound/parser.ts` (consultant commands: 6-digit code, PAUSE/STOP) is not a clone of `inbound/process.ts` (`parseInboundPayload` / `processInboundEvent`, which turn WhatsApp payloads into renter enquiries). Two layers, not a missed reuse.
- No older outbound send helper beyond `renderOutbound`; no older consultant listing page (`lib/listings/*` is Gentle Space public listings, a different product). The new sender and `app/l/[token]/page.tsx` are justified.

---

*Synthesized with EGM*
