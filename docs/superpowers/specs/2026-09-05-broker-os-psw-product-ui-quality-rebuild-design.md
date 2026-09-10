# Broker OS — PSW product UI quality rebuild design

Date: 2026-09-05  
Status: **shipped** (Figma board `143:2`; archive `116:2`; logo kit `136:2`; platform strip `66:2` upgraded)  
Related:
- `2026-09-05-broker-os-psw-product-ui-screens-design.md` (original inventory — still authoritative for screen IDs/copy)
- `2026-09-05-broker-os-problem-solution-how-it-works.md` (PSW copy)
- `docs/superpowers/plans/2026-09-05-broker-os-psw-product-ui-quality-rebuild.md` (execution plan)
- Figma: `bZ7LkDipySdYsNGH0YBtGu` · page `BrokerDesk Waitlist`
- Fresh board: `143:2` Asset / PSW Product Screens (P1–P4 `143:3–6`, S1 `143:7`, H1–H3 `143:8–10`)
- Archive: `116:2` Archive / PSW Product Screens v1 (weak)
- Logo kit: `136:2` · Canonical desk: `34:3`

---

## Problem

The first PSW asset pass on `116:2` is below the marketing bar. P1/P2 read as sparse wireframes (generic Meta “f” circle, crude calendar “X”, broken email rows, literal “Rs blank”). P3–P4 and S1/H1–H3 are empty. Canonical desk `34:3` and the hero teaser already set a Linear-grade density that these assets must match.

## Locked decisions

| Decision | Choice |
|----------|--------|
| Quality failure | **D** — density + lookalike fidelity + craft (all of the above) |
| Board handling | **C** — archive weak board, rebuild clean board at same spot with same frame names |
| Chaos fidelity | Believable platform lookalikes with **official logos** (not stylized stand-ins) |
| Rebuild approach | **1** — logo kit first, then screens |
| Logo sourcing | Public trademark SVG/PNG (Wikimedia / brand-faithful paths); Meta/LinkedIn brand portals blocked to Firecrawl — optional later swap from brand-center zips |
| Inspiration | Mobbin MCP refs baked into per-screen craft (below) |
| Inventory | Unchanged: **4 Problem + 1 Solution + 3 How-it-works** |
| Page embed | Deferred unless a later plan step explicitly includes it |

## Skills and models

| Role | Skill / tool |
|------|----------------|
| Process | `using-superpowers` → `brainstorming` → `writing-plans` → `subagent-driven-development` |
| Verify | `verification-before-completion` (screenshot evidence before “done”) |
| Figma API | `figma-use` |
| Screen assembly | `figma-generate-design` |
| Quality bar | `high-end-visual-design`, `design-taste-frontend`, `ui-ux-pro-max` |
| Brand presentation | `brandkit` (restraint for asset boards) |
| Logos research | `firecrawl-cli` (official brand centers; note Meta/LinkedIn scrape blocks) |
| Pattern refs | Mobbin `search_screens` / `search_flows` |
| Models | Opus-class for Figma composition; faster model OK for doc-only tasks |

## Architecture

1. Rename `116:2` → `Archive / PSW Product Screens v1 (weak)` and move aside (keep for comparison).
2. Create `Asset / Official Channel Logos` with reusable components/frames: **Meta**, **Facebook (f)**, **WhatsApp**, **Google**, **LinkedIn**.
3. Create fresh `Asset / PSW Product Screens` at ~`x=4780`, `y=100`, `2800×2200`, fill `#0B0B0D`, with the same eight child frame names as v1.
4. Rebuild chaos screens P1–P4 using Mobbin density + official logos.
5. Clone `34:3` for S1, then derive H1–H3 as desk state variants (Main + overlay only).
6. Optionally upgrade marketing strip `66:2` marks to the logo kit.
7. Screenshot QA each frame against gates below.

### File / node map

| Artifact | Location | Responsibility |
|----------|----------|----------------|
| Official logo kit | Figma `Asset / Official Channel Logos` (new) | Source components for channel marks |
| Fresh PSW board | Figma `Asset / PSW Product Screens` (new, same spot) | P1–P4, S1, H1–H3 |
| Archive | Figma `Archive / PSW Product Screens v1 (weak)` | Frozen weak pass |
| Canonical desk | `34:3` | Clone source for S1/H1–H3 |
| Platform logos strip | `66:2` | Optional mark upgrade |
| Marketing page | `28:2` | Embed target — **out of scope for this rebuild unless plan extends** |

## Screen inventory (unchanged content; raised craft)

### Problem (chaos) — foreign UI only

No Broker OS wordmark. No Approve. No unified Broker OS sidebar.

| ID | Name | Content + craft upgrades |
|----|------|--------------------------|
| P1 | Chaos / Scattered leads | Overlapping Email + Meta lead notification + WhatsApp chat. Official logos. Badges 7 / 3 / 12. WA micro-tilt ≤6°. |
| P2 | Chaos / Campaign setup | Ads Manager lookalike: Campaigns / Ad sets / Ads; empty Audience; dashed Creative; blank Budget; calendar days with strikethrough (not crude X). |
| P3 | Chaos / Blind spend | Spend `₹50,000` + Enquiries `???` + empty attribution / “Which ad?” — not Broker OS chart styling. |
| P4 | Chaos / Missed follow-up | WhatsApp thread Priya Menon / Whitefield; aged inbound; pill `Missed · 6 days`. |

### Solution + How it works — desk clones

Colors: window `#191A1B`, sidebar `#141416`, border `#373740`, radius `14`. Approve visible/uncropped on S1 and H2.

| ID | Name | Main pane | Overlay |
|----|------|-----------|---------|
| S1 | Desk / Unified practice | Clone of `34:3`; emphasize Inbox + enriched lead + Approve | Agent overlay with Approve |
| H1 | Desk / Capture & Enrich | New lead + enriched fields; Inbox active | Optional enrich chip |
| H2 | Desk / Draft & Approve | Campaign draft summary | **Approve** + Edit draft |
| H3 | Desk / Track & Follow-up | Named creatives + follow-up queue | Optional nudge only |

## Mobbin inspiration map

| Screen | Primary Mobbin refs | Steal |
|--------|---------------------|-------|
| P1 | [WhatsApp chats](https://mobbin.com/screens/a9840503-a573-48d2-8d8f-21006b99bff5), [WA thread](https://mobbin.com/screens/9920aeae-89d3-4dbb-806b-406f9e88a23d), [Gmail](https://mobbin.com/screens/6424b58f-dfa3-489d-b535-a37dead4a950), [Apple Mail](https://mobbin.com/screens/0b546ef1-d424-47ba-b8b0-bda7fa5c51cc) | Green unread pills, avatar+preview email rows, official WA/Meta marks, layered stack depth |
| P2 | [Google Ads campaigns](https://mobbin.com/screens/c628c4db-eb11-468b-9dca-4565c8fc9817), [Semrush campaign setup](https://mobbin.com/screens/4d6ea0ff-364c-4cfd-9d9f-3ffeadf9b383) | Light ads chrome, nav hierarchy, empty field craft, calendar cells |
| P3 | [Google Ads KPIs](https://mobbin.com/screens/c628c4db-eb11-468b-9dca-4565c8fc9817), [Reddit Ads $0 metrics](https://mobbin.com/screens/8246befe-9ac2-441d-b23b-29ae930bc177), [Pinterest empty chart](https://mobbin.com/screens/c5f8b64e-dc87-4c87-ab13-b389196164b4) | Big metric tiles, empty/zero attribution story |
| P4 | [WA thread](https://mobbin.com/screens/ff7ec209-6c71-4eef-9df6-c5667fd27a49) | Faithful chat chrome + miss badge |
| S1/H* | [Linear inbox+detail](https://mobbin.com/screens/beb9d6b3-ec34-46d7-9332-320fcb32a338), [Linear](https://mobbin.com/screens/f00cc4fb-4083-43fc-a0fb-703a6c4ef771), [Twenty](https://mobbin.com/screens/2909977b-1e1c-4349-9086-7f44eed63259), [Revolut Approve](https://mobbin.com/screens/82df1cb8-945f-4649-ad95-3717f0f7e784) | Density, sidebar hierarchy, high-contrast Approve |

## Logo kit

**Components:** Meta wordmark/mark, Facebook **f**, WhatsApp glyph, Google G / wordmark as needed, LinkedIn **in**.

**Provenance:** Import from public trademark SVG sources (e.g. Wikimedia Commons File:WhatsApp.svg, Meta Platforms logo, 2021 Facebook icon, Google G, LinkedIn icon). Document source URLs in the Figma component description. Brand-center portals ([meta.com/brand](https://www.meta.com/brand/resources/), [brand.linkedin.com](https://brand.linkedin.com/), [about.google/brand-resource-center](https://about.google/brand-resource-center/)) remain the canonical policy home; Meta/LinkedIn pages were Firecrawl-blocked during research.

**Usage rules for mockups:** Use marks to identify channels in marketing lookalikes; do not imply partnership/endorsement; keep clear space; do not recolor official multi-color marks incorrectly.

## Constraints (carry forward)

- Language: consultant / practice / enquire / approve
- Never: Ryze, Lofty, autopilot, “AI runs your ads”
- Problem = chaos only; Solution/HIW = desk clones
- No rotate on H1–H3; optional S1 slant only if matching hero `96:2` later at embed time
- Do not `git commit` unless explicitly asked
- Figma-first; no React screens in this rebuild

## QA gates

Fail and redo if any of:

1. Wireframe / sparse look compared to `34:3`
2. Missing official logo where a channel is shown
3. Broker OS chrome or Approve on any Problem frame
4. Approve cropped on S1 or H2
5. Text effectively &lt; ~11px at thumbnail scale
6. Competitor names or banned marketing language in any TEXT node

**Verification:** `get_screenshot` on each finished frame + full asset board; no “done” claim without fresh screenshots (`verification-before-completion`).

## Success criteria

- Viewer distinguishes Problem vs Solution in under 2 seconds (foreign chrome + chaos content — shared dark desk palette, not light-vs-dark)
- H1 → H2 → H3 reads Capture → Approve → Track without body copy
- Craft matches Linear / WhatsApp / Ads Manager recognition from Mobbin refs (Ads Manager lookalike may be dark-themed for board cohesion)
- Official logos present and legible at miniature size
- Archive of v1 remains available for side-by-side comparison

## Out of scope

- Shipping production React for these screens
- Rewriting hero or waitlist CTA
- Mobile breakpoint layouts
- Marketing page (`28:2`) section embeds (separate plan step unless explicitly added)
- Obtaining partner-approved Google product-icon packs via Partner Marketing Hub (use public G / Ads-lookalike chrome; swap later if packs arrive)

## Spec self-review

- [x] No TBD for inventory, board workflow, or QA gates
- [x] Consistent with original PSW inventory and language rules
- [x] Mobbin refs linked per screen
- [x] Logo provenance and Firecrawl limits documented
- [x] Scope is one Figma rebuild (assets + logo kit); embeds deferred
- [x] No contradiction with Approach 1 / archive-C / quality-D

---

## Next step

Implementation plan written: `docs/superpowers/plans/2026-09-05-broker-os-psw-product-ui-quality-rebuild.md`.  
Execute via `subagent-driven-development` (recommended) or `executing-plans`.
