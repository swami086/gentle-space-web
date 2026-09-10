# Broker OS Problem slide — Approach A (aligned 2×2 chaos cards)

**Date:** 2026-09-06  
**Status:** Shipped to Figma `215:39` (Approach A)  
**Figma:** Marketing frame `28:2` · Problem node `215:39`  
**File:** `bZ7LkDipySdYsNGH0YBtGu` (Gentle_space_YC)  
**Approach lock:** A (aligned 2×2 chaos cards)

---

## 1. Goal

Recreate the Problem section so the locked headline is self-explanatory:

> **Your practice runs on broken, siloed workflows.**

Each of the four cards must show one **silo** (tool island) and one **break** (job fails / handoff fails). Diagram and caption must match. Map 1:1 to Brief pillars: Inventory · Campaigns · Spend · Calendar.

## 2. Non-goals

- Do not change the headline.
- Do not invent stats or testimonials (Brief lock).
- Do not name Lofty or other competitors on-page.
- Do not expand into property-management / landlord ops.
- Do not switch to Ramp collage (B) or ClickUp knot path (C).

## 3. Research basis (why this framing)

| Pillar | Silo | Break | Research cue |
|--------|------|-------|--------------|
| Inventory | Folders / chat / Drive hold listing briefs | Status and messaging go stale | Siloed RE marketing channels; app-fatigue stale data |
| Campaigns | Ads Manager never sees the mandate | Rebuild social ads from scratch per listing | Point-solution marketing tool stacks |
| Spend | Meta/Google spend ≠ desk / CRM | Cannot name which campaign earned the enquiry | Sales–marketing silo / attribution handoff failure |
| Calendar | Tours / follow-ups in a separate schedule app | Relationship time gets leftovers | Showing vs CRM vs calendar gap |

Tone/style references (Mobbin): Front familiar-pain cards; Ramp “systems that never spoke” density *inside* each card; Ease “fragmented systems” plain language. No manifesto.

## 4. Layout (keep structure)

```
THE PROBLEM
[Headline — locked]
[Sub — 1–2 lines]

[ P1 diagram 540×347 ]  [ P2 diagram 540×347 ]
[ P1 title + body     ]  [ P2 title + body     ]

[ P3 diagram 540×347 ]  [ P4 diagram 540×347 ]
[ P3 title + body     ]  [ P4 title + body     ]
```

- Frame width: 1440. Left column x≈160, right x≈740.
- Restack vertical spacing after text/diagram height changes (label → headline → sub → cards).
- Preserve Marketing visual language (existing chaos UI chrome); rewrite **content** of each chaos frame so it matches the pillar.

## 5. Diagram rebuild (per card)

### P1 — Inventory (`215:43`)

**Replace** mail/lead chaos with listing-source chaos:

- Folder / Drive-style list: `Indiranagar_3BHK_brief.pdf`, `final_listing_v3.docx`, stale “Last updated 11d ago”
- WhatsApp bubble: listing notes / “photos in Drive?”
- Small badge: `Not on desk` or `Status unknown`
- Optional Meta toast only if it clearly reads as *listing* lead orphaned from inventory (not generic CRM mail)

### P2 — Campaigns (`215:95`)

Keep Ads Manager shell; make “from scratch” obvious:

- Empty or near-empty campaign table / “Create campaign”
- Listing name missing or pasted as placeholder copy
- Chip: `No listing brief linked`

### P3 — Spend (`215:136`)

Keep analytics shell; make attribution the break:

- SPEND: money out (e.g. ₹ / $ spent)
- ENQUIRIES: count exists
- ATTRIBUTION: `—` / `Unknown` / red warning
- Chart vs table that do not reconcile

### P4 — Calendar (`215:186`)

**Replace** WA-missed-call thread with calendar crush:

- Week view packed with tours / follow-ups
- Block or strikethrough for “Client time” / “Relationship”
- Toast optional: “3 follow-ups pushed to tomorrow”

India-native names/places OK (Indiranagar, 3BHK) per Brief geo lock.

## 6. Copy (expert-pmm draft; AI-sign clean)

**Label:** THE PROBLEM  

**Headline (locked):** Your practice runs on broken, siloed workflows.

**Sub:** Listings and campaigns sit in one set of tools. Spend and calendar sit in another. Nothing hands off, so you stitch the day yourself.

| Card | Title | Body |
|------|--------|------|
| P1 Inventory | Listings never share one source of truth | Briefs live in folders and chat. Status goes stale before the next tour. |
| P2 Campaigns | Campaigns start over for every listing | Social ads get rebuilt by hand in a tool that never saw the mandate brief. |
| P3 Spend | Spend cannot explain the enquiry | Budgets leave Meta and Google. Your desk still cannot name what worked. |
| P4 Calendar | The calendar fills before clients get you | Tours and follow-ups stack in one app. Relationship time gets leftovers. |

**Alt subs (if needed):**  
1. Four jobs. Four tools. Zero handoffs.  
2. Each pillar lives alone. You are the glue between them.

## 7. Acceptance criteria

1. Headline characters unchanged from locked string.
2. Each diagram readable as that pillar without reading the caption.
3. Caption title + body name the silo and the break in plain language.
4. Order remains Inventory → Campaigns → Spend → Calendar.
5. No numeric claims, no competitor names, no em/en dashes in shipped copy.
6. `check_ai_signs.py` exit 0 on final shipped strings.
7. Section restacked; no overlapping text/diagrams.

## 8. Implementation notes (for plan)

- Skills: `expert-pmm-writer` (final paste check), Figma `use_figma`, optional Mobbin spot-check.
- Prefer mutate existing nodes under `215:39` over rebuilding Marketing frame.
- After ship: sync Brief §10 Problem pains + `ads-agent/.agents/product-marketing.md` §Problem if copy drifts from v12.

## 9. Out of scope for this change

Solution, How, Trust, Hero, Desk sections. Code / landing site implementation.
