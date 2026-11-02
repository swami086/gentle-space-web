# Comprehension report

Target: `docs/designs/phase-1-listing-campaign-service.md`  
Feature range: lines 1–298 (through Alternatives Considered).  
Detailed range: line 299 through end (`## Detailed Implementation Plan`).  
Brief anchor: Amendment 2026-11-02 in `concepts_brief.md` (Create is the approval for the first campaign; brief wins on conflict).  
Torbit: queried at `project_id` 1672773718350201492, commit `ad63d64316a50852503cd8a408350391d4ddfd2c` (matches git HEAD). Uncommitted local edits are not a new commit; existence claims below are from the graph at HEAD unless noted.

## What this proposes

Phase 1 is a listing-scoped paid-ads workflow for lease consultants in India and Australia. The consultant supplies listing facts (text and photos on a signed listing page), sets a daily spend limit and a goal, then presses **Create** on the web app—or sends the same limit and goal by WhatsApp (India) or SMS (Australia). Per the **2026-11-02 brief amendment** (which overrides any older “code before first build” wording), that act **is** the approval for the first campaign: the agent writes ad copy from listing facts, then the service builds through **Unified.to** only (not direct Meta/Google APIs for this phase). There is no second step that shows a finished ad and waits for a code before the first build. On a live connection the campaign is switched on when `can_activate` is true; in Stage 0 / sandbox, `can_activate` stays false so campaigns stay paused. Each listing gets **three equal “shares” per platform**—each share is **one Unified campaign** (not an ad set or ad group). The approved **ceiling** is the sum of those campaign budgets. After go-live, the monitor may **move unspent budget between shares inside that ceiling** without a new approval and texts afterward; raising the ceiling, end-date changes, copy/audience changes, and pausing an ad still need a **later Approve/Reject card** and a **text code**. **Stop** needs no code. Gentle Space runs first on the owner’s laptop (Stage 0 synthetic Unified data, then Stage 1 two weeks on real accounts); pilots attach their own Unified connections so spend cannot cross onto Gentle Space’s account.

## How the existing system works, per this document

The `ads-agent` package already serves **one organisation** (Gentle Space) using **shared environment-variable platform logins**, so a second customer would spend on Gentle Space’s account until replaced. The document reuses a **proposal engine**: proposals schedule, pass a **60-second undo window** on `org_cron_settings`, then a **`worker:proposals`** process runs **`executeProposal`** (Torbit: `ads-agent/lib/executor/execute.ts`). **`claimDueScheduledProposals`** lives in `ads-agent/lib/db/proposals.ts`. There is an existing **Desk** admin site at localhost:3030, a **WhatsApp inbound route**, a **daily cycle** in `ads-agent/lib/decision-engine/cycle.ts` (the “daily check” that can text **findings**), and **Desk chat** in `campaign-chat.ts` that drafts **one Google Search setup card** but is explicitly **not** Create. Corridor campaigns are legacy Gentle Space automation, not listing shares. This phase adds per-customer **connections** (Unified connection id, no platform token in `credentials_sealed`; **`putConnection`** does not call **`sealSecret`** in `envelope.ts`), **listing shares** in the database, inbound routing/parser, outbound templates, a listing page, India/Australia **rule packs**, and retargets listing execution to **Unified HTTP** while **not** calling existing direct **`createMetaCampaign`** / Google share helpers on the listing path. A org-level **`writes_enabled`** kill switch (migration 115 in the plan) blocks writes except stop. Three terminals on the laptop: `dev`, `worker:proposals`, and `worker` only after **`cron_enabled`** is turned on for the daily move.

---

## Findings

### 1. Major — Order § “Generated images last” (lines 446–448)

**Affected scope:** Detailed Implementation Plan → Order, item 3.

**Discrepancy:** Items 1–2 describe Create, Unified listing builds, WhatsApp/SMS, and explicitly defer image generation elsewhere in the doc (Overview, Non-Goals: no generated property photos this phase). Item 3 introduces a full “generated images” rollout (model, ledger, proposal) as if it were part of the same ordered Phase 1 sequence. A reader can believe Phase 1 ends with shipping an image generator, contradicting the feature half’s scope.

---

### 2. Major — Alternatives Considered, Ryze MCP rejection (line 192)

**Affected scope:** Alternatives Considered → “Vendor the GitHub repo…”

**Discrepancy:** That bullet states the service **already writes through `google-ads-api` and `facebook-nodejs-business-sdk`** from the proposal executor. The rest of the design (Overview, Accounts, Detailed Plan, executor items 4–6) insists listing Phase 1 uses **Unified.to only** and must **not** call Meta Marketing API or Google Ads API on the listing path. A reader cannot tell whether legacy direct API writes remain live for listings or only for corridor/Gentle Space paths without re-reading the entire architecture section.

---

### 3. Major — Remainder helper name (lines 301, 309, 438)

**Affected scope:** Detailed Implementation Plan (ceiling split and verification).

**Discrepancy:** The plan repeatedly names a function **`distribute`** in `ads-agent/lib/monitor/reallocate.ts`. At Torbit HEAD, `reallocateListing` and **`distributeByLeads`** exist in that file; no symbol named **`distribute`**. Someone implementing from the detailed section alone may search for the wrong export or assume the helper is not yet written.

---

### 4. Major — “Reuse” baseline date (line 108)

**Affected scope:** Technical Plan → “What is new, and what is reused.”

**Discrepancy:** The section says it was “Checked against the local code index on 2026-10-30, commit `3f22c76`” and that **`writes_enabled` is not in the code yet**. Torbit at HEAD `ad63d643` already lists migrations **`113_connections` through `116_executing_until`**, **`ads-agent/lib/connections/store.ts`**, **`reallocate.ts`**, **`executeShareMove`** in `execute.ts`, and related paths. A reader treating that paragraph as current inventory will misjudge what is proposed versus already landed at HEAD (graph at HEAD; dirty working tree may differ).

---

### 5. Nit — Brief vs design on first-build deliverables

**Affected scope:** Overview (lines 12–13, 21–22) vs `concepts_brief.md` §2 Overview (lines 33–38).

**Discrepancy:** The **brief** still describes drafting lead forms, photo-based Meta variants, radius, and keywords as part of the service narrative. **This design** states Unified campaign create in Phase 1 **cannot** send photos, lead forms, keywords, headlines, location, ad sets, or ad groups—they stay on the proposal/listing side only. **Brief wins** on approval mechanics (2026-11-02 amendment: Create, not a pre-build code); for **what actually hits the platform in Phase 1**, the design is narrower. A reader who reads only the brief overview may overestimate live ad richness relative to this document.

---

### 6. Nit — Finding vs share move (lines 83–84, 130–133)

**Affected scope:** Technical Plan (Architecture) and “Moves inside the ceiling.”

**Discrepancy:** The doc defines both terms, but both are “things the daily check / monitor does” and both involve budgets. The explicit rule “a share move is **not** a finding” helps; still easy to merge “daily cycle texts me about money” into one approval model unless the reader remembers: **findings → code; in-ceiling share moves → no code, text after**.

---
