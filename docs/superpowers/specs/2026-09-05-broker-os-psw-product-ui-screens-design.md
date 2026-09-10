# Broker OS — PSW product UI screens design

Date: 2026-09-05  
Status: **approved — implementation plan written** (`docs/superpowers/plans/2026-09-05-broker-os-psw-product-ui-screens.md`)  
Related:
- `2026-09-05-broker-os-psw-summary.md`
- `2026-09-05-broker-os-problem-solution-how-it-works.md`
- `2026-09-05-broker-os-marketing-messaging-design.md`
- `2026-09-05-broker-os-agent-lifecycle-workflow.md`

Figma: [Broker OS / Marketing](https://www.figma.com/design/bZ7LkDipySdYsNGH0YBtGu/Untitled?node-id=28-2) (`bZ7LkDipySdYsNGH0YBtGu`)  
Canonical desk: `34:3` Broker OS window  
Asset board pattern: `48:6` Asset / Broker OS Product Teaser

---

## Decisions locked

| Decision | Choice |
|----------|--------|
| Problem visuals | **A** — anti-product / chaos (no Broker OS chrome) |
| Solution + How it works | Broker OS desk clones from `34:3` |
| Build approach | **1** — asset board first, then embed teasers into marketing sections |
| Inventory | **4 Problem + 1 Solution + 3 How-it-works** = 8 screens |

---

## Skills and models

| Role | Skill / model |
|------|----------------|
| Process | `using-superpowers` → `brainstorming` → `writing-plans` |
| Figma API | `figma-use` |
| Screen assembly | `figma-generate-design` |
| Composition | Opus-class for multi-step Figma builds |
| Copy polish | existing PSW copy (no rewrite unless QA finds a clash) |

---

## Screen inventory

### Problem (chaos) — 4 miniatures

Each is a **foreign UI** lookalike. No "Broker OS" wordmark. Lighter or mixed chrome so the dark desk in Solution reads as the fix.

| ID | Name | Content |
|----|------|---------|
| P1 | Chaos / Scattered leads | Overlapping WhatsApp chat, Meta lead form notification, email inbox strip. Unread badges (12, 3, 7). Timestamps like "11:42 PM". |
| P2 | Chaos / Campaign setup | Ads Manager-style half-built campaign. Audience empty, creative placeholder, budget blank. Calendar strip with 3 days crossed out. |
| P3 | Chaos / Blind spend | Spend card "₹50,000" + Enquiries "???" + "Which ad?" empty attribution. No charts that look like Broker OS analytics. |
| P4 | Chaos / Missed follow-up | WhatsApp thread for a property enquiry. Last message 6 days ago. Badge "Missed · 6 days". |

### Solution — 1 desk shot

| ID | Name | Content |
|----|------|---------|
| S1 | Desk / Unified practice | Clone of `34:3` (sidebar + main + agent overlay). Emphasize Inbox count, enriched lead in right rail or follow-up list, and **Approve** on the agent overlay. Optional 6.5° slant wrapper when embedded (match hero `96:2`). |

### How it works — 3 desk states

Same chrome as `34:3`. Only Main (and overlay when relevant) changes per step.

| ID | Name | Main pane shows | Overlay |
|----|------|-----------------|---------|
| H1 | Desk / Capture & Enrich | New lead just landed. Enriched fields: firm, role, source (WhatsApp), property context. Sidebar "Inbox" active. | Optional: "Enriched Peak Labs from inbound WhatsApp." |
| H2 | Desk / Draft & Approve | Campaign draft summary (Meta / Google / LinkedIn, budget, creative). | **Approve** + **Edit draft** primary. Copy: "Drafted a Meta campaign… waiting for your approval." |
| H3 | Desk / Track & Follow-up | Analytics strip: spend → enquiries (named creatives, not "???"). Follow-up queue with stale nudge. Sidebar "Enquiries" or "Analytics" active. | Optional nudge chip only; Approve not required. |

---

## Placement on the marketing page

Asset board lives **beside** the marketing frame (right of `28:2`, near `48:6`), not inside the page scroll until we wire embeds.

| Marketing section | Embed |
|-------------------|--------|
| Problem (new section after Platform logos / before or replacing weak proof) | 2×2 grid of P1–P4 at ~420×280 each (or scaled to fit 1200 content width) |
| Solution (new or upgraded suite block) | S1 large, ~880×490 desk (or slanted teaser like hero) |
| How it works (replace/upgrade `29:26`) | H1 · H2 · H3 in a horizontal 3-column row, flat, ~360×240 crops each |

Page order (target):

1. Nav  
2. Hero (existing slanted teaser)  
3. Platform logos  
4. **Problem** (copy + P1–P4)  
5. **Solution** (copy + S1)  
6. **How it works** (copy + H1–H3)  
7. The suite / Agents / Closing CTA (keep or lightly retitle; do not delete without a separate pass)

Exact y-shifts happen at implementation; current marketing height is **3872px** and will grow.

---

## Visual system

### Shared (Solution + How it works)

- Near-black window `#191A1B`, sidebar `#141416`, border `#373740`, radius **14**
- Soft drop shadow (match `34:3` / hero)
- Fonts: match existing desk text styles already loaded in the file
- Agent overlay stays the approval-truth surface for H2 / S1

### Problem only

- Foreign chrome: WhatsApp green accents, Meta blue, email gray, Ads Manager blue
- Slightly messier stacking (overlapping cards, ±4–8° micro-tilts on P1 only)
- No Broker OS wordmark, no Approve button, no unified sidebar
- Still legible at thumbnail size; text ≥ 11px effective after scale

### Do not

- Put Broker OS chrome on Problem screens
- Name competitors (Ryze, Lofty) in any layer or copy
- Use autopilot / "AI runs your ads" language
- Crop Approve off-frame on S1 / H2
- Rotate H1–H3 (flat only)

---

## Build sequence (implementation, after plan)

1. Create page-level frame `Asset / PSW Product Screens` next to `48:6`  
2. Build P1–P4 as independent frames on the asset board  
3. Clone `34:3` → S1, H1, H2, H3; retarget Main + overlay per inventory  
4. Screenshot / visual QA each asset  
5. Insert Problem / Solution / How it works sections into `28:2` with copy from PSW spec  
6. Embed scaled instances or clones of assets into those sections  
7. Final full-page screenshot QA  

Models: Opus (or equivalent) for steps 2–6; no parallel rewrite of marketing copy unless a visual forces a one-line tweak.

---

## Success criteria

- Viewer can tell Problem from Solution in under 2 seconds (chaos vs desk)  
- H1 → H2 → H3 reads as Capture → Approve → Track without reading body copy  
- Approve is visible and uncropped on S1 and H2  
- All Solution/How-it-works screens share one chrome language with the hero desk  
- Spec matches `product-marketing.md` language (consultant, practice, approve)

---

## Out of scope (this design)

- Shipping production React for these screens  
- New design-system components beyond local Figma frames  
- Rewriting hero or waitlist CTA  
- Mobile breakpoint layouts (desktop marketing frame only for now)

---

## Spec self-review

- [x] No TBD placeholders for screen IDs or content  
- [x] Inventory matches locked decisions (A + approach 1 + 4+1+3)  
- [x] Consistent with lifecycle doc (Capture / Draft&Approve / Track)  
- [x] Scope is one implementation plan (Figma assets + page embed)  
- [x] Ambiguity resolved: Problem = foreign UI; Solution/HIW = desk clones  

---

**Next gate:** Execute `docs/superpowers/plans/2026-09-05-broker-os-psw-product-ui-screens.md` (subagent-driven or inline).
