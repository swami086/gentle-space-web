# Broker OS PSW product UI quality rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **Figma-first** (file `bZ7LkDipySdYsNGH0YBtGu`); screenshot QA replaces unit tests. Do not invent React screens. Do not embed into marketing page `28:2` in this plan.

**Goal:** Archive the weak PSW asset board, build an official channel logo kit, then rebuild all eight product UI assets (P1–P4 chaos + S1 + H1–H3 desk states) to Linear-grade craft matching canonical desk `34:3`, using Mobbin-guided density and official logos.

**Architecture:** Approach 1 from the quality-rebuild spec: logo kit first → fresh asset board at the same spot → parallel chaos rebuilds → clone `34:3` for desk states. Weak board `116:2` becomes `Archive / PSW Product Screens v1 (weak)`.

**Tech Stack:** Figma Plugin API via `use_figma` (`figma-use` + `figma-generate-design`), file key `bZ7LkDipySdYsNGH0YBtGu`, page `BrokerDesk Waitlist`. Spec: `docs/superpowers/specs/2026-09-05-broker-os-psw-product-ui-quality-rebuild-design.md`.

## Global Constraints

- **Problem = chaos only:** P1–P4 must never show Broker OS wordmark, Approve button, or unified Broker OS sidebar.
- **Solution/HIW = desk clones:** S1, H1–H3 start from cloning `34:3`. Colors: window `#191A1B`, sidebar `#141416`, border `#373740`, radius `14`.
- **Approve visible:** S1 and H2 must show Approve uncropped (overlay inset from far-right edge; no rotate on H1–H3).
- **Official logos required:** Use components from `Asset / Official Channel Logos` — never blue circle + “f” placeholder or hand-drawn stand-ins.
- **Language:** consultant / practice / enquire / approve. Never Ryze, Lofty, autopilot, "AI runs your ads".
- **Copy source:** `docs/superpowers/specs/2026-09-05-broker-os-problem-solution-how-it-works.md`. Do not rewrite unless a one-line clash with a visual.
- **Commits:** Do not `git commit` unless the user explicitly asks. Figma changes are the deliverable.
- **Models:** Opus-class for Tasks 4–9 (Figma composition). Faster model OK for Tasks 1, 3, 10 (archive/scaffold/docs).
- **Verification:** No task is complete without a fresh `get_screenshot` that passes that task’s QA gate (`verification-before-completion`).

## Parallel execution map (max 8 subagents)

```
Wave A (serial gate):     Task 1 Archive
Wave B (serial after A):  Task 2 Logo kit  →  Task 3 Fresh board scaffold
Wave C (parallel ×4):     Task 4 P1 | Task 5 P2 | Task 6 P3 | Task 7 P4
Wave D (serial then ×3):  Task 8 S1 clone  →  Task 9a H1 | 9b H2 | 9c H3
Wave E (serial):          Task 10 Board QA + optional 66:2 + doc notes
```

Do **not** start Wave C until Tasks 2–3 return `logoKitId`, `assetBoardId`, and the eight placeholder IDs.

## File / node map

| Artifact | Location | Responsibility |
|----------|----------|----------------|
| Quality rebuild spec | `docs/superpowers/specs/2026-09-05-broker-os-psw-product-ui-quality-rebuild-design.md` | Locked decisions + Mobbin map |
| Original inventory | `docs/superpowers/specs/2026-09-05-broker-os-psw-product-ui-screens-design.md` | Screen names/content |
| PSW copy | `docs/superpowers/specs/2026-09-05-broker-os-problem-solution-how-it-works.md` | Section copy |
| Canonical desk | Figma `34:3` | Clone source for S1/H1–H3 |
| Weak board | Figma `116:2` | Archive in Task 1 |
| Logo kit | Figma `Asset / Official Channel Logos` (new) | Meta, Facebook f, WhatsApp, Google, LinkedIn |
| Fresh PSW board | Figma `Asset / PSW Product Screens` (new) | Eight screen frames |
| Platform strip | Figma `66:2` | Optional mark upgrade in Task 10 |

---

### Task 1: Archive weak board

**Model:** any  
**Skills:** `figma-use`  
**Files / nodes:**
- Modify: Figma `116:2`

**Interfaces:**
- Consumes: node `116:2`
- Produces: archived board still addressable; `archivedBoardId` (`116:2` or new id if Figma remaps — return actual id), cleared slot near `x=4780,y=100`

- [x] **Step 1: Switch page and rename + move**

```js
const page = figma.root.children.find((p) => p.name.includes("BrokerDesk") || p.name.includes("Waitlist")) || figma.root.children[0];
await figma.setCurrentPageAsync(page);
const board = await figma.getNodeByIdAsync("116:2");
if (!board || board.type !== "FRAME") throw new Error("116:2 missing");
board.name = "Archive / PSW Product Screens v1 (weak)";
const rightEdge = Math.max(...page.children.map((n) => n.x + n.width));
board.x = rightEdge + 400;
board.y = 100;
return { archivedBoardId: board.id, name: board.name, x: board.x, y: board.y };
```

- [x] **Step 2: QA**

`get_screenshot` on `archivedBoardId`. Confirm rename visible in metadata; original slot free for new board.

---

### Task 2: Build Official Channel Logos kit

**Model:** Opus-class  
**Skills:** `figma-use`, `firecrawl-cli` (if re-fetching SVG), Mobbin optional  
**Files / nodes:**
- Create: Figma frame `Asset / Official Channel Logos`
- Create: components `Logo / Meta`, `Logo / Facebook`, `Logo / WhatsApp`, `Logo / Google`, `Logo / LinkedIn`

**Interfaces:**
- Consumes: SVG strings from Wikimedia (or equivalent trademark-faithful paths)
- Produces: `logoKitId`, `logos: { meta, facebook, whatsapp, google, linkedin }` component node IDs

**SVG sources (download in shell, then paste path data into `createNodeFromSvg`):**

| Mark | Commons file |
|------|----------------|
| WhatsApp | `https://commons.wikimedia.org/wiki/Special:FilePath/WhatsApp.svg` |
| Facebook f | `https://commons.wikimedia.org/wiki/Special:FilePath/2021_Facebook_icon.svg` |
| Meta | `https://commons.wikimedia.org/wiki/Special:FilePath/Meta_Platforms_Inc._logo.svg` |
| Google G | `https://commons.wikimedia.org/wiki/Special:FilePath/Google_%22G%22_logo.svg` |
| LinkedIn | `https://commons.wikimedia.org/wiki/Special:FilePath/LinkedIn_icon.svg` |

- [x] **Step 1: Fetch SVG files locally**

```bash
mkdir -p .firecrawl/logo-kit
curl -fsSL -o .firecrawl/logo-kit/whatsapp.svg "https://commons.wikimedia.org/wiki/Special:FilePath/WhatsApp.svg"
curl -fsSL -o .firecrawl/logo-kit/facebook.svg "https://commons.wikimedia.org/wiki/Special:FilePath/2021_Facebook_icon.svg"
curl -fsSL -o .firecrawl/logo-kit/meta.svg "https://commons.wikimedia.org/wiki/Special:FilePath/Meta_Platforms_Inc._logo.svg"
curl -fsSL -o .firecrawl/logo-kit/google-g.svg "https://commons.wikimedia.org/wiki/Special:FilePath/Google_%22G%22_logo.svg"
curl -fsSL -o .firecrawl/logo-kit/linkedin.svg "https://commons.wikimedia.org/wiki/Special:FilePath/LinkedIn_icon.svg"
wc -c .firecrawl/logo-kit/*.svg
```

Expected: five non-empty SVG files.

- [x] **Step 2: Create kit frame + components via `use_figma`**

On page `BrokerDesk Waitlist`, create frame `Asset / Official Channel Logos` at `x = archivedBoard.x` (or rightEdge+200), `y = 2400`, size `1200 × 400`, fill `#0B0B0D`.

For each SVG: `const node = figma.createNodeFromSvg(svgString);` wrap in `figma.createComponent()`, name exactly `Logo / WhatsApp` (etc.), set `description` to the Commons source URL, resize mark to fit a 32×32 or 48×48 bounds while preserving aspect ratio, arrange in a horizontal auto-layout row with 40px gap.

Return `{ logoKitId, logos: { meta, facebook, whatsapp, google, linkedin } }`.

- [x] **Step 3: Screenshot QA**

`get_screenshot` on `logoKitId`. Fail if any mark is missing, monochrome placeholder, or illegible.

---

### Task 3: Scaffold fresh PSW asset board

**Model:** any  
**Skills:** `figma-use`  
**Files / nodes:**
- Create: `Asset / PSW Product Screens` + 8 placeholder frames

**Interfaces:**
- Consumes: free slot ~`x=4780,y=100` after Task 1
- Produces: `assetBoardId`, `placeholders: [{ name, id }]` for all eight names below

- [x] **Step 1: Create board + placeholders**

```js
const page = figma.root.children.find((p) => p.name.includes("BrokerDesk") || p.name.includes("Waitlist")) || figma.root.children[0];
await figma.setCurrentPageAsync(page);

const board = figma.createFrame();
board.name = "Asset / PSW Product Screens";
board.resize(2800, 2200);
board.x = 4780;
board.y = 100;
board.fills = [{ type: "SOLID", color: { r: 0.043, g: 0.043, b: 0.051 } }];
page.appendChild(board);

const specs = [
  { name: "P1 Chaos / Scattered leads", w: 560, h: 360, x: 80, y: 80 },
  { name: "P2 Chaos / Campaign setup", w: 560, h: 360, x: 680, y: 80 },
  { name: "P3 Chaos / Blind spend", w: 560, h: 360, x: 1280, y: 80 },
  { name: "P4 Chaos / Missed follow-up", w: 560, h: 360, x: 1880, y: 80 },
  { name: "S1 Desk / Unified practice", w: 1120, h: 624, x: 80, y: 520 },
  { name: "H1 Desk / Capture & Enrich", w: 560, h: 360, x: 80, y: 1224 },
  { name: "H2 Desk / Draft & Approve", w: 560, h: 360, x: 680, y: 1224 },
  { name: "H3 Desk / Track & Follow-up", w: 560, h: 360, x: 1280, y: 1224 },
];

const placeholders = [];
for (const s of specs) {
  const f = figma.createFrame();
  f.name = s.name;
  f.resize(s.w, s.h);
  f.x = s.x;
  f.y = s.y;
  f.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.11 } }];
  f.cornerRadius = 12;
  board.appendChild(f);
  placeholders.push({ name: s.name, id: f.id });
}
return { assetBoardId: board.id, placeholders };
```

- [x] **Step 2: QA**

`get_screenshot` on `assetBoardId`. Confirm 8 frames, no overlap with archive.

---

### Task 4: Rebuild P1 Chaos / Scattered leads

**Model:** Opus-class  
**Skills:** `figma-use`, `figma-generate-design`, `high-end-visual-design`, Mobbin refs in spec  
**Parallel:** Wave C (with Tasks 5–7)

**Interfaces:**
- Consumes: P1 placeholder id, `logos.facebook` or Meta mark, `logos.whatsapp`
- Produces: finished P1 id

- [x] **Step 1: Clear children; build denser three-layer stack**

Inside P1 (fill `#1A1A1C`, radius 12), build:

1. **Email strip** (back, ~340×230 at 24,44): header "Inbox" + green/gray unread badge `7`; ≥3 rows with subject + preview (Mobbin Gmail/Apple Mail hierarchy). Subjects include "Re: Whitefield office availability".
2. **Meta notification** (middle, +24,+18): left blue accent `#1877F2`; **instance of official Facebook/Meta logo** (not text “f” on circle); title "New lead form response"; subtitle "Whitefield · 2,400 sq ft · Peak Labs"; badge `3`.
3. **WhatsApp chat** (front, +48,+36, ≤6° tilt via `relativeTransform` on this card only): official WhatsApp mark in header; contact "Lead · Whitefield"; bubble "Is the Whitefield space still available?"; time `11:42 PM`; badge `12`; green `#25D366` accents.

No "Broker OS". No Approve.

- [x] **Step 2: Screenshot QA**

`get_screenshot` on P1. Fail if logos missing, badges missing, Broker OS text present, or sparse vs Mobbin WA/Mail density.

---

### Task 5: Rebuild P2 Chaos / Campaign setup

**Model:** Opus-class  
**Skills:** `figma-use`, Mobbin Google Ads / Semrush refs  
**Parallel:** Wave C

**Interfaces:**
- Consumes: P2 placeholder id, `logos.meta` and/or `logos.facebook`
- Produces: finished P2 id

- [x] **Step 1: Build light Ads Manager lookalike**

- Top bar: official Meta/Facebook mark + "Ads Manager"
- Left nav: Campaigns (active) / Ad sets / Ads with blue `#1877F2` accent
- Main: "New campaign"; Audience empty ("Select audience"); Creative dashed "+ Add creative"; Budget empty field showing currency affordance `₹` with blank value (never the word "blank")
- Calendar strip: three day cells (e.g. Mon 2 / Tue 3 / Wed 4) with **strikethrough** or muted crossed state — not a lone letter "X"

- [x] **Step 2: Screenshot QA**

`get_screenshot` on P2. Fail if crude X-only cells, missing logo, Broker OS chrome, or empty sparse form.

---

### Task 6: Build P3 Chaos / Blind spend

**Model:** Opus-class  
**Skills:** `figma-use`, Mobbin Google Ads KPI / Reddit Ads / Pinterest empty chart  
**Parallel:** Wave C

**Interfaces:**
- Consumes: P3 placeholder id
- Produces: finished P3 id

- [x] **Step 1: Build spend chaos card**

Light or mixed foreign analytics chrome (not `#191A1B` Broker OS desk):

- Large metric `₹50,000` labeled Spend
- Metric `???` labeled Enquiries
- Empty chart / "No activity" style empty state (Mobbin Pinterest empty chart energy)
- Row "Which ad?" with empty attribution

Do **not** copy Broker OS analytics chart styling from `34:3`.

- [x] **Step 2: Screenshot QA**

`get_screenshot` on P3. Fail if Broker OS wordmark, Approve, or desk-identical chart chrome.

---

### Task 7: Build P4 Chaos / Missed follow-up

**Model:** Opus-class  
**Skills:** `figma-use`, Mobbin WA thread  
**Parallel:** Wave C

**Interfaces:**
- Consumes: P4 placeholder id, `logos.whatsapp`
- Produces: finished P4 id

- [x] **Step 1: Build WhatsApp missed thread**

- Official WhatsApp mark in header
- Contact "Priya Menon", property context "Whitefield office"
- Last inbound bubble dated ~6 days ago
- Pill badge: `Missed · 6 days` (middle-dot or hyphen; no em-dash)
- No Broker OS / Approve

- [x] **Step 2: Screenshot QA**

`get_screenshot` on P4. Fail if missing logo, missing Missed pill, or Broker OS strings.

---

### Task 8: Build S1 Desk / Unified practice

**Model:** Opus-class  
**Skills:** `figma-use`, `figma-generate-design`  
**Wave:** D (before H1–H3)

**Interfaces:**
- Consumes: S1 placeholder id, canonical `34:3`
- Produces: finished S1 id (desk clone with Approve visible)

- [x] **Step 1: Clone desk into S1**

```js
const page = figma.root.children.find((p) => p.name.includes("BrokerDesk") || p.name.includes("Waitlist")) || figma.root.children[0];
await figma.setCurrentPageAsync(page);
const src = await figma.getNodeByIdAsync("34:3");
const s1 = await figma.getNodeByIdAsync("<S1_PLACEHOLDER_ID>");
if (!src || !s1) throw new Error("missing src or S1");
// remove S1 children
for (const c of [...s1.children]) c.remove();
const clone = src.clone();
clone.name = "Desk clone";
s1.appendChild(clone);
clone.x = 0;
clone.y = 0;
const scale = Math.min(s1.width / clone.width, s1.height / clone.height);
clone.rescale(scale);
return { s1Id: s1.id, cloneId: clone.id, scale };
```

Ensure Agent overlay **Approve** sits inset from the right edge (uncropped). Emphasize Inbox count + enriched lead if needed by light Main tweaks — do not invent a new chrome language.

- [x] **Step 2: Screenshot QA**

`get_screenshot` on S1. Fail if Approve cropped or chrome diverges from `34:3`.

---

### Task 9: Build H1 / H2 / H3 desk states

**Model:** Opus-class  
**Skills:** `figma-use`  
**Parallel:** Wave D after Task 8 — three subagents (H1, H2, H3)

**Interfaces:**
- Consumes: H1/H2/H3 placeholder ids, pattern from Task 8 clone of `34:3`
- Produces: finished H1, H2, H3 ids

Each subagent:

- [x] **Step 1: Clone `34:3` (or S1 clone) into its H frame and retarget Main**

| Frame | Sidebar active | Main shows | Overlay |
|-------|----------------|------------|---------|
| H1 | Inbox | New lead just landed; enriched fields firm/role/source WhatsApp/property | Optional: "Enriched Peak Labs from inbound WhatsApp." |
| H2 | Campaigns (or Today) | Campaign draft summary Meta/Google/LinkedIn + budget | **Approve** + **Edit draft** uncropped; "Drafted a Meta campaign… waiting for your approval." |
| H3 | Enquiries or Analytics | Spend → enquiries with **named** creatives; follow-up queue with stale nudge | Optional nudge chip only; Approve not required |

Flat only — **no rotation**. Radius/colors match Global Constraints.

- [x] **Step 2: Screenshot QA each**

Fail H2 if Approve cropped. Fail any H if Broker OS chrome broken or Problem-style foreign UI.

---

### Task 10: Board QA + optional strip upgrade + doc notes

**Model:** faster OK for docs; Opus if editing `66:2`  
**Skills:** `figma-use`, `verification-before-completion`

**Interfaces:**
- Consumes: `assetBoardId`, all screen ids, `logoKitId`
- Produces: QA evidence; optional updated `66:2`; working-tree doc notes (no commit)

- [x] **Step 1: Full-board screenshot QA**

`get_screenshot` on `assetBoardId` at `maxDimension` ≥ 2048. Checklist:

1. Eight finished screens (no empty placeholders)
2. Problem vs Solution contrast &lt;2s
3. Official logos on P1/P2/P4
4. No Broker OS / Approve on P1–P4
5. Approve visible on S1 and H2
6. Archive board still present under Archive name

- [x] **Step 2 (optional): Upgrade `66:2` Platform logos**

Replace hand-drawn marks with instances of logo kit components. Screenshot `66:2`.

- [x] **Step 3: Update docs (working tree only)**

- Mark quality-rebuild design status → `approved — implementation in progress` or `shipped` when QA passes
- Append asset node IDs to a short note in `ads-agent/.agents/product-marketing.md` **only if** that file already documents Figma asset IDs; otherwise skip
- Do **not** `git commit` unless user asks

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Archive weak board (C) | Task 1 |
| Official logo kit (Approach 1) | Task 2 |
| Fresh board same spot | Task 3 |
| P1–P4 Mobbin density + logos | Tasks 4–7 |
| S1 clone `34:3` + Approve | Task 8 |
| H1–H3 lifecycle states | Task 9 |
| Screenshot QA gates | Every task + Task 10 |
| Optional `66:2` upgrade | Task 10 |
| Marketing `28:2` embeds | Out of scope (correctly omitted) |
| No commit unless asked | Global Constraints |

## Placeholder scan

No TBD / "similar to Task N" without full steps. Screenshot QA substituted for unit tests (Figma-first).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-05-broker-os-psw-product-ui-quality-rebuild.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task (Wave C fans out 4 chaos screens; Wave D fans out 3 HIW screens), review between waves via `subagent-driven-development`

**2. Inline Execution** — Same tasks in this session via `executing-plans`, with checkpoints after Waves B, C, D

**Which approach?**
