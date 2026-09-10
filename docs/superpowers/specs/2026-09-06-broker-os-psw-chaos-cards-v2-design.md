# Broker OS Problem slide — Approach C (single knotted-cable diagram)

**Date:** 2026-09-06
**Status:** Approved (user selected C, scope explicitly restricted to node `215:39` only)
**Figma:** node `215:39` only. No other node/section touched.
**File:** `bZ7LkDipySdYsNGH0YBtGu` (Gentle_space_YC)
**Supersedes:** `2026-09-06-broker-os-problem-siloed-workflows-design.md` (Approach A, same node)

---

## 1. Goal

Replace the four product-UI chaos mockups (`215:43`, `215:95`, `215:136`, `215:186`) with **one** wide diagram: a tangled cable with four knots, each knot = one inbound channel that is managed on its own today.

Channels (locked, from Torbit codebase evidence, not invented):

| Channel | Codebase proof |
|---|---|
| Email | `ads-agent/app/api/inbound/email/route.ts` (Postmark) |
| Website | `channel: "web_form"` in enquiry pipeline |
| Social campaigns | `ads-agent/app/api/campaigns/*` (Meta Ads Manager) |
| Customer enquiries | `ads-agent/lib/inbound/match.ts` (unification layer that has to exist because the above never agree) |

Reference: [Intercom "old way: disconnected conversations"](https://mobbin.com/sites/sections/10a77b79-0e26-4f3e-a34a-d5a1a4ae3588), [ClickUp "Context Sprawl" knotted cable](https://mobbin.com/sites/sections/8138d756-c6c3-467d-a0e3-da83437d850b).

## 2. Non-goals

- Do not change the headline (`215:41`): `Your practice runs on broken, siloed workflows.`
- Do not touch any node outside `215:39`.
- Do not invent stats/percentages (Brief lock) — ClickUp's stat labels are style reference only, not content to copy.
- Do not name competitors.

## 3. What changes inside `215:39`

| Node | Action |
|---|---|
| `215:40` label | Keep: `THE PROBLEM` |
| `215:41` headline | Keep unchanged (locked) |
| `215:42` sub | Rewrite: was pillar-framed (Inventory/Campaigns/Spend/Calendar); now channel-framed to match new diagram |
| `215:43` P1 Inventory chaos frame | **Delete** (replaced by new cable diagram) |
| `215:95` P2 Campaigns chaos frame | **Delete** |
| `215:136` P3 Spend chaos frame | **Delete** |
| `215:186` P4 Calendar chaos frame | **Delete** |
| `215:93/94, 134/135, 184/185, 213/214` (4 title+body pairs) | **Repurpose**: reword to the four channels, reposition in a single row under the four knots |
| New frame `Silo cable` | **Create**: full-width tangled cable + 4 knot circles + 4 icon chips |
| `215:39` section | Resize height down (diagram is far shorter than the old 2×2 UI mockups) |

## 4. Diagram design (buildable with Figma Plugin API primitives)

- One wide rounded bar (rectangle, corner radius = height/2) running the content width (x160→x1280), acting as the "cable."
- Four overlapping knot circles centered on the bar at evenly spaced x-positions (four channel slots).
- Each knot carries a small icon chip above it (rounded square, monochrome glyph: envelope / globe / megaphone / chat-bubble) labelled Email / Website / Social / Enquiries.
- No literal 3D tangle (out of reach of primitives); knots read as "snags" via layered circles + slight y-jitter per knot, keeping ClickUp's *rhythm* without faking its render style.

## 5. Copy (expert-pmm; AI-sign clean before ship)

**Sub (new):** Email, your website, social campaigns, and every enquiry each live in their own tool. None of them tell the others what happened.

| Knot | Title | Body |
|---|---|---|
| Email | Email replies live in one inbox | Nobody outside that inbox knows a lead replied. |
| Website | Website enquiries land and wait | Forms fill a queue nobody is watching by default. |
| Social campaigns | Campaigns run in Ads Manager alone | Comments and DMs never reach the desk. |
| Enquiries | Enquiries get stitched back together by hand | Someone has to match a WhatsApp message to an email to a form. |

## 6. Acceptance criteria

1. Headline string unchanged.
2. Only `215:39` subtree modified; no other Figma node touched.
3. Four channels visible as distinct knots on one cable, each legible without reading the caption.
4. Captions match §5, `check_ai_signs.py` exit 0.
5. Section height shrinks to fit new (shorter) diagram; no empty space or overlap.
6. No fake stats, no competitor names.

## 7. Out of scope

Every other Figma node/section. Any code/site implementation.
