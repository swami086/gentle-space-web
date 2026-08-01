# Taste Skill frontend eval — Gentle Space visual overhaul

Date: 2026-08-01
Status: approved (written spec)

## Problem

We need a controlled evaluation of **design-taste-frontend** (Taste Skill v2) on a
real product: Gentle Space. The live site already has brand chrome (purple
`#6840B8`, existing type/layout). Judging Taste Skill against that chrome
conflates “skill quality” with “how well it respects an incumbent purple SaaS
look.”

We need a **logo-only preserve + full visual overhaul** recreate, designed first
in Pencil, then implemented in an isolated Next.js folder, without touching the
production `GentleSpace_Web` app.

## Goals

- Evaluate Taste Skill quality on:
  1. Marketing home (`/`)
  2. Spaces browse (`/spaces`)
  3. Listing detail (`/spaces/[slug]`)
- Keep only the existing logo mark (`gentle-space-logo-mark.png`) + wordmark.
- Overhaul palette, type, layout, motion, and chrome.
- Pencil-first: land three desktop frames in
  `/Users/swami/.pencil/documents/6738b910-957f-4da0-a0c3-d2c629b9d55f/Design_test.pen`
  via julilaoshi-design Pencil MCP, with screenshot review per frame.
- Recreate a runnable frontend in a **new folder**
  `~/Documents/GentleSpace_TasteEval` matching those frames (mock data; no
  production DB/API wiring).
- Leave `GentleSpace_Web` source and deploy targets unchanged.

## Non-goals

- Migrating production to the new visual system.
- Wiring live listings sync, embeddings, GraphRAG, or Places insight.
- Pixel-perfect Airbnb clone of current `/spaces` product fidelity.
- Rewriting brand positioning / IA / route slugs (preserve jobs of sections and
  nav labels unless a Taste Skill anti-tell forces a CTA-label unification).
- Installing new global skills or changing Cursor skill installs.

## Design read (Taste Skill §0)

Reading this as: **B2B trust-first CRE marketing + secondary listings product**
for Bangalore decision-makers (Admin/Ops, founders, GCC India Ops, property
owners), with a **premium-calm / Forest-trust** language, leaning toward
**Tailwind v4 + custom sans (not Inter) + restrained Motion**, logo mark as the
only preserved brand asset.

### Dials

| Surface | DESIGN_VARIANCE | MOTION_INTENSITY | VISUAL_DENSITY |
|---------|-----------------|------------------|----------------|
| Marketing home | 6 | 5 | 3 |
| Spaces browse / detail | 5 | 4 | 5 |

## Approach

**Pencil-first, then code (Approach A).**

1. Handshake Pencil MCP on `Design_test.pen`.
2. Blank-build three 1440-wide frames: Home, Spaces Browse, Listing Detail.
3. Screenshot-review each frame; bounded fix passes only.
4. Scaffold `~/Documents/GentleSpace_TasteEval` and implement to match frames.
5. Score / note where Taste Skill shines (marketing) vs stretches (product UI).

## Visual system

### Preserve

- Logo mark file: `public/gentle-space-logo-mark.png` (copied into eval folder)
- Wordmark: “Gentle Space”

### Retire

- Accent `#6840B8` and purple-forward chrome
- Current Inter/default SaaS card stacks and cream/purple tells
- Any AI-purple / beige+brass premium-consumer defaults

### New tokens (Forest trust)

| Token | Value | Role |
|-------|-------|------|
| `--surface` | `#F4F6F3` | Page background (bone) |
| `--ink` | `#121A16` | Primary text |
| `--forest` | `#1B2E24` | Nav, dark bands, primary buttons |
| `--accent` | `#C47A2C` | Single accent (amber) — locked page-wide |
| `--muted` | `#5C6B62` | Secondary text |

- Corner radius: soft 12–16px for cards; buttons slightly tighter (8px) — one
  documented rule, applied consistently.
- Type: Geist or Outfit-class sans for UI + display; **no** Inter default; **no**
  Fraunces / Instrument Serif; no mixed-family headline emphasis.
- Theme: light primary; dark tokens defined for parity testing; no mid-page
  theme flips.
- Icons: Phosphor (or project-allowed set); one family only.
- Motion: entry / scroll-reveal / CTA press only where motivated; honor
  `prefers-reduced-motion`.

## Information architecture (preserve jobs)

### Home `/`

Section jobs (layout families must differ; max 1 eyebrow per 3 sections):

1. Site header (logo mark + wordmark; primary CTA = consulting lead; secondary = Spaces)
2. Hero — asymmetric split; ≤2-line headline; ≤20-word subtext; CTA in first viewport
3. Services — not three equal cards
4. How it works
5. Micro-markets
6. Why Gentle Space / About
7. Founder teaser
8. Testimonials (≤3 lines quote body; real-feeling names)
9. FAQ
10. CTA band
11. Footer

Lead capture modal restyled to the new system (same intent).

### Spaces `/spaces`

- Keep split IA: listing grid left, sticky map right (desktop).
- New chrome: search, filters, cards, map treatment under Forest tokens.
- Density dial 5: usable product, not gallery.

### Listing detail `/spaces/[slug]`

- Gallery, title + locality line, amenity/summary block, insight panel **shell**
  (static placeholder OK), lead CTA.
- Mock listing payload only.

## Pencil deliverable

File:
`/Users/swami/.pencil/documents/6738b910-957f-4da0-a0c3-d2c629b9d55f/Design_test.pen`

Frames (desktop 1440 wide):

| Frame | Contents |
|-------|----------|
| Home | Full marketing landing as above |
| Spaces Browse | Browse chrome + sample cards + map panel |
| Listing Detail | Detail layout with mock space |

Workflow: julilaoshi-design Pencil MCP — handshake → read canvas → Blank Build →
batch edits → `get_screenshot` review per frame.

## Code deliverable

Path: `~/Documents/GentleSpace_TasteEval`

- Next.js App Router + Tailwind v4
- Routes: `/`, `/spaces`, `/spaces/[slug]`
- Copy logo mark from GentleSpace_Web public assets
- Mock listings JSON (3–8 rows) sufficient for browse/detail
- No production env secrets; no DB
- Motion isolated in client leaves where used

## Constraints & honesty

- Taste Skill is **strongest** on marketing landing; Spaces/detail are the
  stretch eval (skill explicitly out-of-scope for dense dashboards; we still
  ship usable chrome).
- Em-dash ban and other Taste Skill pre-flight rules apply to all visible copy
  in Pencil and code.
- Do not commit Pencil local paths, screenshots with secrets, or API keys.

## Success criteria

- Three Pencil frames screenshot-reviewed and coherent under Forest tokens + logo.
- Eval app runs locally and matches frame direction for all three routes.
- Production `GentleSpace_Web` unchanged.
- Written notes (short) on where Taste Skill helped vs fought product UI density.

## Open questions

None blocking. Spec review may adjust token hexes or frame count only.
