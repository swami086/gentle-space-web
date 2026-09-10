# Broker OS PSW product UI screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **Figma-first** (file `bZ7LkDipySdYsNGH0YBtGu`); screenshot QA replaces unit tests. Do not invent React screens unless a later plan asks for them.

**Goal:** Build eight product UI assets (4 chaos + 1 unified desk + 3 lifecycle desk states) on an asset board, then embed them into Problem / Solution / How it works sections on `Broker OS / Marketing` (`28:2`).

**Architecture:** Clone the canonical desk `34:3` for Solution/How-it-works screens; build Problem screens as foreign UI lookalikes with no Broker OS chrome. Assets live in a sibling frame `Asset / PSW Product Screens` next to `48:6`. Marketing page sections then embed scaled clones. Page order: Nav → Hero → Platform logos → Problem → Solution → How it works → The suite → Agents → Closing CTA.

**Tech Stack:** Figma Plugin API via `use_figma` (`figma-use` + `figma-generate-design` skills), file key `bZ7LkDipySdYsNGH0YBtGu`, page `BrokerDesk Waitlist`. Docs under `docs/superpowers/specs/`.

## Global Constraints

- **Problem = chaos only:** P1–P4 must never show Broker OS wordmark, Approve button, or unified sidebar.
- **Solution/HIW = desk clones:** S1, H1–H3 start from cloning `34:3`. Colors: window `#191A1B`, sidebar `#141416`, border `#373740`, radius `14`.
- **Approve visible:** S1 and H2 must show Approve uncropped (learn from hero fix: overlay left of far-right edge; no rotate on H1–H3).
- **Language:** consultant / practice / enquire / approve. Never Ryze, Lofty, autopilot, "AI runs your ads".
- **Copy source:** `docs/superpowers/specs/2026-09-05-broker-os-problem-solution-how-it-works.md` (PSW). Do not rewrite unless a one-line clash with a visual.
- **Commits:** Do not `git commit` unless the user explicitly asks. Figma changes are the deliverable; doc updates stay working-tree until asked.
- **Models:** Opus-class for Figma composition (Tasks 2–7). Faster model OK for doc-only Task 8.

## File / node map

| Artifact | Location | Responsibility |
|----------|----------|----------------|
| Design spec | `docs/superpowers/specs/2026-09-05-broker-os-psw-product-ui-screens-design.md` | Locked inventory |
| PSW copy | `docs/superpowers/specs/2026-09-05-broker-os-problem-solution-how-it-works.md` | Section headlines/body |
| Marketing messaging | `docs/superpowers/specs/2026-09-05-broker-os-marketing-messaging-design.md` | Append v13 when shipped |
| Product marketing | `ads-agent/.agents/product-marketing.md` | Note asset IDs when shipped |
| Canonical desk | Figma `34:3` | Source clone for S1/H1–H3 |
| Hero slant ref | Figma `96:2` | Optional S1 embed tilt only |
| Existing asset | Figma `48:6` | Placement neighbor |
| Marketing page | Figma `28:2` | Embed target (grows past 3872px) |
| New asset board | Figma `Asset / PSW Product Screens` | Holds P1–P4, S1, H1–H3 |

---

### Task 1: Scaffold asset board

**Model:** any (read + one create call)  
**Skills:** `figma-use`  
**Files / nodes:**
- Create: Figma frame `Asset / PSW Product Screens` on page `BrokerDesk Waitlist`
- Read: `48:6`, `28:2`, `34:3`

**Interfaces:**
- Consumes: existing page layout (`48:6` at x≈3300)
- Produces: `assetBoardId` (string), placeholder child frames named exactly:  
  `P1 Chaos / Scattered leads`, `P2 Chaos / Campaign setup`, `P3 Chaos / Blind spend`, `P4 Chaos / Missed follow-up`, `S1 Desk / Unified practice`, `H1 Desk / Capture & Enrich`, `H2 Desk / Draft & Approve`, `H3 Desk / Track & Follow-up`

- [ ] **Step 1: Inspect placement**

```js
const page = figma.root.children[0];
await figma.setCurrentPageAsync(page);
const neighbor = await figma.getNodeByIdAsync("48:6");
return {
  neighbor: neighbor && { x: neighbor.x, y: neighbor.y, w: neighbor.width, h: neighbor.height },
  rightEdge: Math.max(...page.children.map((n) => n.x + n.width)),
};
```

Expected: neighbor near x=3300; rightEdge ≥ 4580.

- [ ] **Step 2: Create board + 8 placeholder frames**

Create `Asset / PSW Product Screens` at `x = rightEdge + 200`, `y = 100`, size `2800 × 2200`, fill `#0B0B0D`. Inside, place 8 frames with `placeholder = true`:

| Name | Size | Grid slot |
|------|------|-----------|
| P1–P4 | 560 × 360 | Row 1, 4 columns, gap 40 |
| S1 | 1120 × 624 | Row 2 left |
| H1–H3 | 560 × 360 | Row 3, 3 columns |

Return `{ assetBoardId, placeholders: [{ name, id }] }`.

- [ ] **Step 3: QA**

`get_screenshot` on `assetBoardId`. Confirm 8 labeled placeholders, no overlap with `48:6`.

---

### Task 2: Build P1 Chaos / Scattered leads

**Model:** Opus-class  
**Skills:** `figma-use`  
**Files / nodes:**
- Modify: placeholder `P1 Chaos / Scattered leads` inside asset board

**Interfaces:**
- Consumes: `assetBoardId`, P1 frame id from Task 1
- Produces: finished P1 (no Broker OS strings in any TEXT node)

- [ ] **Step 1: Clear placeholder and build three overlapping cards**

Inside P1 (fill `#1A1A1C`, radius 12):

1. **Email strip** (back): gray header "Inbox", rows with unread badge `7`, subject "Re: Whitefield office availability"
2. **Meta notification** (middle, offset +24,+18): blue accent bar, "New lead form response", badge `3`
3. **WhatsApp chat** (front, offset +48,+36, micro-tilt ≤ 6° via `relativeTransform` on this card only): green `#25D366` accents, bubble "Is the Whitefield space still available?", time `11:42 PM`, badge `12`

No "Broker OS" text. No Approve.

- [ ] **Step 2: Screenshot QA**

`get_screenshot` on P1. Fail if Broker OS wordmark appears, or if badges are missing.

- [ ] **Step 3: Set `placeholder = false` on P1**

---

### Task 3: Build P2–P4 chaos screens

**Model:** Opus-class  
**Skills:** `figma-use`  
**Files / nodes:**
- Modify: P2, P3, P4 placeholders

**Interfaces:**
- Consumes: P2/P3/P4 ids
- Produces: finished P2–P4

- [ ] **Step 1: P2 Chaos / Campaign setup**

Ads Manager lookalike (blue `#1877F2` accents, light or mixed chrome — not Broker OS dark desk):

- Left nav: Campaigns / Ad sets / Ads
- Main: "New campaign" with empty Audience, Creative dashed box "Add creative", Budget blank
- Top calendar strip: three day cells crossed out (strikethrough or X)

- [ ] **Step 2: P3 Chaos / Blind spend**

- Large metric "₹50,000" labeled Spend
- Metric "???" labeled Enquiries
- Line "Which ad?" with empty attribution row
- Do **not** copy Broker OS analytics chart styling from `34:3`

- [ ] **Step 3: P4 Chaos / Missed follow-up**

- WhatsApp-style thread: contact "Priya Menon", property "Whitefield office"
- Last inbound bubble dated 6 days ago
- Pill badge: `Missed · 6 days` (use middle-dot or hyphen; no em-dash)

- [ ] **Step 4: Screenshot QA each of P2, P3, P4**

Fail if any TEXT contains `Broker OS`, `Approve`, or competitor names.

- [ ] **Step 5: `placeholder = false` on P2–P4**

---

### Task 4: Build S1 Desk / Unified practice

**Model:** Opus-class  
**Skills:** `figma-use`  
**Files / nodes:**
- Clone: `34:3` → rename into S1 slot (or replace S1 contents with clone)

**Interfaces:**
- Consumes: `34:3`, S1 placeholder id
- Produces: S1 id with Approve visible

- [ ] **Step 1: Clone desk into S1**

```js
const [src, slot] = await Promise.all([
  figma.getNodeByIdAsync("34:3"),
  figma.getNodeByIdAsync("S1_ID"),
]);
const clone = src.clone();
clone.name = "S1 Desk / Unified practice";
clone.x = 0;
clone.y = 0;
slot.appendChild(clone);
// remove empty placeholder chrome if any
return { s1CloneId: clone.id };
```

- [ ] **Step 2: Emphasize unified state**

On the clone only (never mutate source `34:3`):

- Sidebar Inbox badge visible
- Agent overlay text includes approval wait state
- Approve + Edit draft buttons present
- Overlay x far enough left that Approve clears the right edge by ≥ 40px

- [ ] **Step 3: Screenshot QA**

Confirm Approve readable. Confirm clone did not alter `34:3` (spot-check source id still exists, same child count).

- [ ] **Step 4: `placeholder = false` on S1**

---

### Task 5: Build H1–H3 desk states

**Model:** Opus-class  
**Skills:** `figma-use`  
**Files / nodes:**
- Clone `34:3` three times into H1, H2, H3 slots; retarget Main + overlay

**Interfaces:**
- Consumes: `34:3`, H1–H3 ids
- Produces: H1–H3 finished states

- [ ] **Step 1: H1 Capture & Enrich**

- Sidebar: Inbox active (highlight)
- Main: enriched lead card — firm, role, source WhatsApp, property context (e.g. Peak Labs / Whitefield)
- Overlay (optional): `Enriched Peak Labs from an inbound WhatsApp.`
- No Approve required

- [ ] **Step 2: H2 Draft & Approve**

- Sidebar: Campaigns active
- Main: campaign draft summary (Meta / Google / LinkedIn, budget, creative line)
- Overlay required: `Drafted a Meta campaign for the Whitefield offices — waiting for your approval.`  
  (If em-dash ban for marketing copy conflicts, use: `Drafted a Meta campaign for the Whitefield offices. Waiting for your approval.`)
- Buttons: Approve + Edit draft, Approve uncropped

- [ ] **Step 3: H3 Track & Follow-up**

- Sidebar: Analytics or Enquiries active
- Main: spend → enquiries with **named** creatives (not `???`); follow-up queue with one stale nudge
- Overlay: nudge only, or hide Approve

- [ ] **Step 4: Screenshot QA H1, H2, H3 in order**

Pass criteria from design spec: sequence reads Capture → Approve → Track without body copy. H1–H3 flat (no rotation).

- [ ] **Step 5: `placeholder = false` on H1–H3**

---

### Task 6: Insert Problem / Solution / How it works sections into `28:2`

**Model:** Opus-class  
**Skills:** `figma-use`, `figma-generate-design`  
**Files / nodes:**
- Modify: `28:2` Broker OS / Marketing
- Insert after `66:2` Platform logos; shift `28:16` Product proof / `29:2` The suite / later sections down

**Interfaces:**
- Consumes: finished P1–P4, S1, H1–H3 ids; PSW copy
- Produces: section frame ids `Problem`, `Solution`, `How it works (PSW)`

**Copy (verbatim from PSW):**

**Problem**
- Headline: `Does this sound familiar?`
- Cards: Leads scattered everywhere / Campaigns take days to build / You don't know what's working / Follow-ups fall through the cracks  
  (short body lines from PSW §I)

**Solution**
- Eyebrow/badge: `THE AI OPERATING SYSTEM FOR REAL ESTATE CONSULTANTS`
- Headline: `One desk. Your entire practice.`
- Pillars: All leads in one place / Campaigns drafted for you / See what works, what wastes
- Control line: `Agents draft and nudge. You approve what spends and what sends.`

**How it works**
- Headline: `How it works`
- Sub: `Three steps. One desk. Human-approved every time.`
- Steps: Capture & Enrich / Draft & Approve / Track & Follow-up (concise lines from PSW §III)

- [ ] **Step 1: Measure current section Y positions**

Return y/height for `66:2`, `28:16`, `29:2`, `29:26`, `29:41`, `29:46`. Compute insert start Y = logos bottom + gap (80).

- [ ] **Step 2: Create Problem section frame**

Width 1440, padding x=120, dark page fill matching `28:2`. Headline + 2×2 grid. Clone P1–P4 into grid cells scaled to ~420×280. Set section `placeholder = true` until embeds look right.

- [ ] **Step 3: Create Solution section below Problem**

Headline + 3 pillar text column + S1 embed (~880×490). Optional slant wrapper matching hero `96:2` at 6.5° **only if** Approve remains uncropped after tilt; otherwise flat.

- [ ] **Step 4: Create / replace How it works**

Prefer upgrading existing `29:26` in place if structure allows; else new `How it works (PSW)` and hide or delete obsolete step UI inside `29:26` after visual parity. Three columns H1–H3 flat ~360×240 with large labels `01` `02` `03`.

- [ ] **Step 5: Shift remaining sections down; grow `28:2` height**

Keep suite / agents / closing CTA. Update marketing frame height to fit (expect > 3872).

- [ ] **Step 6: Full-page screenshot QA of `28:2`**

Pass: Problem chaos vs Solution desk contrast in 2 seconds; H1→H2→H3 readable; Approve visible on Solution embed.

---

### Task 7: Final visual QA checklist

**Model:** Opus-class (inspection)  
**Skills:** `figma-use`, `get_screenshot`

- [ ] **Step 1: Per-asset screenshots** — P1–P4, S1, H1–H3
- [ ] **Step 2: Mechanical checks**

| Check | Expected |
|-------|----------|
| TEXT search "Broker OS" inside P1–P4 | 0 hits |
| TEXT search "Approve" on S1 and H2 | ≥ 1 each |
| H1–H3 rotation | none |
| Competitor names | 0 |
| Em-dash in marketing section headlines | 0 (use period/comma) |

```js
function collectText(node, out = []) {
  if (node.type === "TEXT") out.push({ id: node.id, characters: node.characters, parent: node.parent?.name });
  if ("children" in node) node.children.forEach((c) => collectText(c, out));
  return out;
}
// run on asset board + new sections; return mismatches
```

- [ ] **Step 3: Fix any failures before Task 8**

---

### Task 8: Documentation sync

**Model:** fast OK  
**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-broker-os-psw-product-ui-screens-design.md` (status → shipped; paste node IDs)
- Modify: `docs/superpowers/specs/2026-09-05-broker-os-marketing-messaging-design.md` (append v13)
- Modify: `docs/superpowers/specs/2026-09-05-broker-os-psw-summary.md` (mark Figma assets done)
- Modify: `ads-agent/.agents/product-marketing.md` (asset ID table)
- Modify: `openmemory.md` if a Patterns entry for PSW product screens is missing

- [ ] **Step 1: Record node IDs** from Tasks 1–6 into the design spec table
- [ ] **Step 2: Append v13** to marketing messaging: "PSW product UI screens shipped on asset board + embedded"
- [ ] **Step 3: Store OpenMemory project fact** (component/implementation) with file key + asset board id — no secrets
- [ ] **Step 4: Commit only if user asks**

---

## Parallelism note

- Tasks 2 and 3 can run as parallel subagents **only if** each owns disjoint node IDs (P1 vs P2–P4) and both write only inside the asset board.
- Tasks 4 and 5 can parallelize similarly (S1 vs H1–H3) after Task 1.
- Task 6 is serial after Tasks 2–5 pass screenshot QA.
- Do **not** parallelize two writers on `28:2`.

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| P1–P4 chaos, no Broker OS | 2, 3 |
| S1 unified desk + Approve | 4 |
| H1–H3 Capture / Approve / Track | 5 |
| Asset board approach | 1 |
| Embed into Problem / Solution / How it works | 6 |
| Visual QA + Approve uncropped | 7 |
| Docs update | 8 |
| No React / no mobile | out of scope (honored) |

Placeholder scan: none. Node names consistent across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-05-broker-os-psw-product-ui-screens.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task (Opus for Figma tasks), review between tasks  
2. **Inline Execution** — run tasks in this session with checkpoints  

Which approach?
