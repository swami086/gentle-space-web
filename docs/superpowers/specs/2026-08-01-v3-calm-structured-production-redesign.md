# v3 Calm Structured → production frontend redesign

Date: 2026-08-01  
Status: approved  
Source lab: `frontend-redesign/v3-calm-structured/`  
Approach: **token-first, restyle components in place** (Approach 1)

## Problem

Gentle Space’s production Next.js UI still uses Inter + purple-tinted chrome that
reads as generic B2B SaaS. The design lab validated **v3 Calm Structured** as the
preferred direction. That look must land in the real app for marketing home and
the Spaces product without rewriting APIs, copy, or IA.

## Goals

- Apply v3 calm-structured visual language to production:
  1. Marketing home (`/`)
  2. Spaces browse (`/spaces`)
  3. Listing detail (`/spaces/[slug]`)
- Preserve: verbatim marketing copy, route/IA labels, logo mark + wordmark,
  brand accent `#6840B8`, Spaces product behavior (AI search, filters, map,
  insight, gallery, like, lead capture).
- Ship dual light/dark with system default + persisted header toggle.
- Add `motion/react` for calm reveals/hovers only; honor `prefers-reduced-motion`.
- Leave no half-styled surfaces: shared shell, home, browse, and detail all use
  the same token system when this work is done.

## Non-goals

- Rewriting copy, SEO titles beyond font/class wiring, or primary nav labels.
- Changing API routes, DB, sync, embeddings, GraphRAG, or Places insight logic.
- Touching `design-sandbox/` or deleting `frontend-redesign/` (kept as reference).
- Scroll-hijacking / GSAP (v2 lab language stays in the lab only).
- Pixel-cloning the static HTML files; port the **system** (tokens, type, density,
  layout families), not raw markup.

## Design read (design-taste-frontend §0)

Reading this as: **redesign-overhaul of a B2B trust-first CRE marketing + listings
product** for Bangalore decision-makers, with a **calm-structured / restrained**
language validated by v3, leaning toward **Tailwind v4 + Source Sans 3 / Source
Serif 4 via next/font + Motion at calm intensity**.

### Dials

| Surface | DESIGN_VARIANCE | MOTION_INTENSITY | VISUAL_DENSITY |
|---------|-----------------|------------------|----------------|
| Marketing home | 5 | 4 | 4 |
| Spaces browse / detail | 5 | 4 | 5 |

## Locked decisions (brainstorming)

| Topic | Choice |
|-------|--------|
| Spaces depth | Full visual rebuild; keep map + AI search behavior |
| Typography | Source Sans 3 + Source Serif 4 via `next/font` |
| Theme | Dual light/dark + header toggle (persisted); system default |
| Motion | Add `motion/react`; calm intensity only |
| Implementation approach | Token-first; restyle existing components in place |

## Architecture

### Token layer (`app/globals.css`)

Semantic CSS variables (light `:root`, dark `.dark` / `[data-theme="dark"]`):

| Token | Light (from v3) | Role |
|-------|-----------------|------|
| `--accent` | `#6840b8` | Primary CTA / links |
| `--accent-dark` | `#4f2f8f` | Hover / emphasis |
| `--accent-soft` | `#f0ebf8` | Soft bands / fee box |
| `--bg` | `#ffffff` | Page background |
| `--surface` | `#f6f5f8` | Alternate sections / cards |
| `--border` | `#e2dde9` | Hairlines / inputs |
| `--ink` | `#1a1524` | Primary text |
| `--ink-2` / `--ink-secondary` | `#4a4358` | Secondary text |
| `--muted` | `#6e667c` | Body supporting |
| `--on-accent` | `#ffffff` | Text on accent |
| `--radius` | `8px` | Single radius system |

Dark mode must keep accent recognisable, WCAG AA contrast for body and CTAs, and
the same hierarchy (no mid-page theme flips). Prefer off-black/off-white surfaces
(no pure `#000` / `#fff` as page fills in dark).

Page width: tighten marketing max-width toward ~1120px (v3), keep Spaces browse
wide enough for split map (existing browse chrome may stay ~full-bleed with
internal token padding).

### Fonts (`app/layout.tsx`)

- Replace `Inter` with:
  - `Source_Sans_3` → `--font-sans`
  - `Source_Serif_4` → `--font-serif`
- Body uses sans; display headlines (home sections, Spaces section titles) use
  serif where v3 did. No Google Fonts `<link>` tags.

### Theme (`components/ThemeProvider.tsx` + header control)

- Client provider: resolve `system | light | dark` from `localStorage` +
  `prefers-color-scheme`.
- Apply class/`data-theme` on `<html>` before paint where practical (inline script
  or blocking class to avoid flash).
- Toggle lives in `SiteHeader` and `SpacesHeader` (same control).

### Motion

- Install `motion` (import from `motion/react`).
- Shared leaf: `components/motion/Reveal.tsx` (whileInView fade/lift ~12px,
  short duration, respect `useReducedMotion`).
- No scroll pin/scrub; no magnetic physics; no marquees.
- Hover: subtle scale/opacity on interactive cards where it aids feedback.

## Surface redesigns

### Shared shell

| File | Change |
|------|--------|
| `components/SiteHeader.tsx` | Denser sticky bar, calm nav, theme toggle, accent CTA |
| `components/SiteFooter.tsx` | v3 dense footer columns |
| `components/LeadCaptureModal.tsx` | Token restyle; keep WhatsApp submit behavior |
| `components/BrandLogoMark.tsx` | Keep asset; adjust size to match denser header |

### Marketing home (order unchanged)

| Component | Layout family (v3) |
|-----------|--------------------|
| `Hero.tsx` | Split copy + image; serif H1; incentive in hero stack; dual CTA |
| `Services.tsx` | Two-column dense lists with hairline rows (not 3 equal cards) |
| `HowItWorks.tsx` | Numbered dense grid / list |
| `About.tsx` | Copy + fee box (`accent-soft`) |
| `MicroMarkets.tsx` | Headline + inline locality string |
| `Testimonials.tsx` | Dense 2-col quote cards; ≤3-line quotes |
| `FounderTeaser.tsx` | Portrait + meta DL + LinkedIn |
| `FAQ.tsx` | Accordion with hairline rows |
| `CtaBand.tsx` | Accent band; Contact Us + Spaces CTAs |

Eyebrow ration: ≤1 per 3 sections (drop decorative uppercase labels that violate
design-taste-frontend). Zero em-dashes in any new UI chrome strings.

### Spaces browse

Keep `SpacesBrowseClient` ownership of idle hero ↔ browse mode and search state.

Visual rebuild targets:

| File | Intent |
|------|--------|
| `SpacesHeader.tsx` | Align with marketing header + theme toggle |
| `SpacesHomeHero.tsx` | Calm hero; denser type; same search entry |
| `SpacesBrowseChrome.tsx` | Quieter chrome; token borders |
| `SpacesAiSearch.tsx` | Form contrast AA; accent focus |
| `SpaceCard.tsx` | Denser card; serif/sans hierarchy; no purple-chrome leftovers |
| `SpacesMap.tsx` / `ApproxAreaMap.tsx` | Map behavior unchanged; chrome/fallback text tokens |
| `SpacesFiltersModal.tsx` | Match lead-modal density |
| `SpacesEmpty.tsx` / `SpacesStaleBanner.tsx` | Soft surface treatments |
| `LikeSpaceButton.tsx` | Token interactive states |

Split layout (grid left / sticky map right) stays; composition density and chrome
restyle to v3. No fake div-screenshots; real listing images remain.

### Spaces detail

| File | Intent |
|------|--------|
| `app/spaces/[slug]/page.tsx` | Page shell tokens / typography |
| `SpaceGallery.tsx` | Calm gallery chrome |
| `SpaceInsightPanel.tsx` | Insight panel tokens; behavior unchanged |
| Detail CTAs / like | Shared button language |

## Implementation phases (no gaps)

1. **Foundation** — `package.json` (`motion`), fonts, tokens, ThemeProvider, layout wiring  
2. **Shared shell** — header (both), footer, lead modal, logo sizing  
3. **Marketing sections** — all home components to v3 layout families  
4. **Spaces browse** — chrome, cards, search, filters, empty/stale  
5. **Spaces detail** — gallery, insight, page shell  
6. **QA** — light + dark + reduced-motion; home + browse + detail; lead modal; contrast audit  

## File touch list (expected)

**Must change:**  
`app/globals.css`, `app/layout.tsx`, `app/page.tsx` (only if class wrappers needed),  
`app/spaces/layout.tsx`, `app/spaces/page.tsx`, `app/spaces/[slug]/page.tsx`,  
all `components/*.tsx` marketing shell/sections listed above,  
all `components/spaces/*.tsx` listed above,  
new: `components/ThemeProvider.tsx`, `components/ThemeToggle.tsx`,  
`components/motion/Reveal.tsx`, `package.json` / lockfile.

**Must not change:**  
`app/api/**`, `lib/db/**`, `lib/sync/**`, `lib/graph/**`, `lib/ai/**`,  
`lib/listings/public.ts` contracts (unless a display-only class),  
`design-sandbox/**`, plan files under `.cursor/plans/`.

## Risks

| Risk | Mitigation |
|------|------------|
| Theme flash on load | Early class on `<html>` before React hydrate |
| Map layout regressions | Keep browse split structure; restyle chrome only first, then density |
| Serif clipping on italics | Avoid italic display with descenders; use `leading` ≥ 1.1 if needed |
| Motion + map jank | No scroll listeners; Motion only on cards/sections, not map container |
| Incomplete dark coverage | Phase 1 defines all tokens; QA checklist both themes before done |

## Success criteria

- [ ] Home matches v3 calm structure (density, type, section families) in production  
- [ ] Spaces browse + detail clearly same design system as home  
- [ ] Accent `#6840B8` locked page-wide; one radius system  
- [ ] Dark mode + persisted toggle work on marketing and Spaces  
- [ ] Motion is calm; `prefers-reduced-motion` disables reveals  
- [ ] AI search, filters, map, insight, WhatsApp lead flow still work  
- [ ] CTA/form contrast passes WCAG AA in both themes  
- [ ] No em-dashes introduced in UI chrome; eyebrow count within ration  

## Self-review (inline)

- No TBD/placeholder sections left for required decisions.  
- Scope matches locked brainstorming choices (Approach 1, dual theme, Motion, full Spaces rebuild).  
- Does not conflict with listing privacy / API contracts.  
- Related but separate: `2026-08-01-taste-skill-frontend-eval-design.md` is an
  isolated Pencil/eval track; this spec is the **production** apply path from the
  `frontend-redesign/v3-calm-structured` lab.
