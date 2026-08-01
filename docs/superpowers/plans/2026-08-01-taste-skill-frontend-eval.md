# Taste Skill Frontend Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pencil-first Forest-trust redesign of Gentle Space (logo only preserved), then a mock Next.js recreate in `~/Documents/GentleSpace_TasteEval` for Taste Skill quality evaluation.

**Architecture:** REVISED 2026-08-01 per explicit user instruction: build the Next.js recreate first using design-taste-frontend, then replicate the shipped screens into `Design_test.pen` via Pencil MCP (julilaoshi-design Reference Build + screenshot review). Production `GentleSpace_Web` stays untouched.

**Tech Stack:** Pencil MCP, Next.js App Router, Tailwind v4, Motion (`motion/react`) only where motivated, Phosphor icons, static mock JSON.

**Spec:** `docs/superpowers/specs/2026-08-01-taste-skill-frontend-eval-design.md`

## Global Constraints

- Preserve only logo mark + wordmark “Gentle Space”; retire `#6840B8`.
- Forest tokens: surface `#F4F6F3`, ink `#121A16`, forest `#1B2E24`, accent `#C47A2C`, muted `#5C6B62`.
- Zero em-dashes in visible copy; Taste Skill pre-flight applies.
- Pencil file: `/Users/swami/.pencil/documents/6738b910-957f-4da0-a0c3-d2c629b9d55f/Design_test.pen`
- Code folder: `~/Documents/GentleSpace_TasteEval` (outside production repo runtime; no prod DB).
- Do not modify production routes, sync, or deploy config in `GentleSpace_Web` except this plan/spec under `docs/`.

---

## File Structure (code)

```
~/Documents/GentleSpace_TasteEval/
  app/
    layout.tsx
    globals.css
    page.tsx                 # Home
    spaces/page.tsx
    spaces/[slug]/page.tsx
  components/
    BrandLogo.tsx
    SiteHeader.tsx
    SiteFooter.tsx
    home/*.tsx               # section components
    spaces/*.tsx             # browse + detail chrome
  data/listings.json
  public/gentle-space-logo-mark.png
  package.json
```

---

### Task 1: Pencil handshake + canvas read

**Files:**
- Modify: `Design_test.pen` (via Pencil MCP only)

- [ ] **Step 1:** Call `get_app_state` with schema + canvas; pass `filePath` to `Design_test.pen` if required
- [ ] **Step 2:** `execute` Get/document structure; confirm blank or empty draft
- [ ] **Step 3:** `get_guidelines` for web/landing style if helpful
- [ ] **Step 4:** Note stage = Blank Build

---

### Task 2: Pencil frame — Home (1440)

**Files:**
- Modify: `Design_test.pen`

- [ ] **Step 1:** Create frame `Home` 1440×~5000 (scroll length as needed)
- [ ] **Step 2:** Build nav + asymmetric hero + logo mark placeholder/image
- [ ] **Step 3:** Add remaining sections with distinct layout families (no 3 equal feature cards; ≤1 eyebrow / 3 sections)
- [ ] **Step 4:** `get_screenshot` on Home frame; fix named issues only
- [ ] **Step 5:** Confirm Forest tokens + accent lock + no em-dashes

---

### Task 3: Pencil frame — Spaces Browse (1440)

**Files:**
- Modify: `Design_test.pen`

- [ ] **Step 1:** Create frame `Spaces Browse` 1440×900+
- [ ] **Step 2:** Split layout: filters/search + card grid left, map panel right
- [ ] **Step 3:** Sample 4–6 listing cards under Forest chrome
- [ ] **Step 4:** `get_screenshot`; bounded fixes

---

### Task 4: Pencil frame — Listing Detail (1440)

**Files:**
- Modify: `Design_test.pen`

- [ ] **Step 1:** Create frame `Listing Detail` 1440×1200+
- [ ] **Step 2:** Gallery + title/locality + summary + insight shell + lead CTA
- [ ] **Step 3:** `get_screenshot`; bounded fixes
- [ ] **Step 4:** Document frame IDs / layout notes for code handoff

---

### Task 5: Scaffold eval Next.js app

**Files:**
- Create: `~/Documents/GentleSpace_TasteEval/**` (scaffold)

- [ ] **Step 1:** `npx create-next-app@latest` (TS, App Router, Tailwind, no src dir) into `GentleSpace_TasteEval`
- [ ] **Step 2:** Ensure Tailwind v4; set CSS variables to Forest tokens in `globals.css`
- [ ] **Step 3:** Copy `gentle-space-logo-mark.png` from GentleSpace_Web public
- [ ] **Step 4:** Add `data/listings.json` with 6 mock Bangalore spaces
- [ ] **Step 5:** Verify `npm run dev` starts

---

### Task 6: Implement Home to match Pencil

**Files:**
- Create: `components/BrandLogo.tsx`, `SiteHeader.tsx`, `SiteFooter.tsx`, `components/home/*`
- Modify: `app/page.tsx`, `app/layout.tsx`

- [ ] **Step 1:** Header/footer with logo + consulting primary CTA / Spaces secondary
- [ ] **Step 2:** Hero asymmetric split matching Pencil
- [ ] **Step 3:** Remaining sections; Motion only if motivated + reduced-motion safe
- [ ] **Step 4:** Visual check against Home screenshot; fix deltas

---

### Task 7: Implement Spaces browse + detail

**Files:**
- Create: `components/spaces/*`, `app/spaces/page.tsx`, `app/spaces/[slug]/page.tsx`

- [ ] **Step 1:** Browse split chrome with mock cards + map placeholder panel
- [ ] **Step 2:** Detail page from slug + mock JSON
- [ ] **Step 3:** Insight panel shell (static)
- [ ] **Step 4:** Visual check against Pencil frames

---

### Task 8: Eval notes

**Files:**
- Create: `~/Documents/GentleSpace_TasteEval/EVAL_NOTES.md`
- Optional: copy or link from GentleSpace_Web docs if desired

- [ ] **Step 1:** Note where Taste Skill helped (marketing) vs stretched (product density)
- [ ] **Step 2:** List any pre-flight fails caught and fixed
- [ ] **Step 3:** Confirm production `GentleSpace_Web` git status shows no app code changes from this work (docs/spec/plan only)

---

## Done when

- Three Pencil frames screenshot-reviewed
- Eval app serves `/`, `/spaces`, `/spaces/[slug]` matching Forest system + logo
- `EVAL_NOTES.md` written
- Production app code untouched
