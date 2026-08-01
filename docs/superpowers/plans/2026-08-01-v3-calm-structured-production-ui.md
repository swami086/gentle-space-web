# v3 Calm Structured Production Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallel dispatch:** Prefer `Task` / subagent tools. Dispatch **all tasks inside a wave in one coordinator turn** (one message, multiple subagent calls). Do not start a later wave until every task in the prior wave has passed task review. Each implementer gets only its task section + Global Constraints + File map — not the whole chat history.

**Goal:** Port the approved v3 Calm Structured visual system into production Next.js for `/`, `/spaces`, and `/spaces/[slug]` without changing APIs, copy, or product behavior.

**Architecture:** Token-first restyle in place. Wave 0 lands shared tokens/fonts/theme/motion primitives. Later waves restyle existing components against those primitives in parallel file-disjoint batches. No new page tree; no API changes.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4, `next/font` (Source Sans 3 + Source Serif 4), `motion/react`, CSS variables for light/dark, existing inline SVGs only where already present (do not add new icon libraries unless a task says so).

**Spec:** `docs/superpowers/specs/2026-08-01-v3-calm-structured-production-redesign.md`  
**Lab reference (do not edit):** `frontend-redesign/v3-calm-structured/`

## Global Constraints

- Accent locked: `#6840B8` / `--accent`. One radius: `--radius: 8px` (map old `--radius-sm|md|lg` usages to `var(--radius)` or keep aliases equal to 8px).
- Preserve verbatim copy from `lib/content.ts`, `lib/content-services.ts`, `lib/site.ts`, and existing component strings (no copy rewrite; no em-dashes in any new chrome strings).
- Preserve routes, nav labels, lead WhatsApp behavior, Spaces AI search / filters / map / insight contracts.
- Do not edit `app/api/**`, `lib/db/**`, `lib/sync/**`, `lib/graph/**`, `lib/ai/**`, `design-sandbox/**`.
- Do not delete `frontend-redesign/`.
- Dark mode via class `dark` on `<html>` + CSS variables; system default + persisted toggle (`localStorage` key `gs-theme` = `system` | `light` | `dark`).
- Motion: calm fade/lift only via `components/motion/Reveal.tsx`; honor `prefers-reduced-motion` / `useReducedMotion()`.
- Eyebrow ration: ≤1 uppercase tracking label per 3 sections on marketing home.
- After each task: `npx tsc --noEmit` if types touched; visual smoke of the surface you changed; commit on feature branch (coordinator creates branch once in Wave 0).
- Subagents must not amend others' commits; one commit per task.

## File map

| File | Responsibility |
|------|----------------|
| `package.json` / lockfile | Add `motion` |
| `public/theme-init.js` | Pre-hydration theme class (no inline HTML injection) |
| `app/globals.css` | Light/dark tokens, base font utilities |
| `app/layout.tsx` | Fonts, ThemeProvider, script src for theme-init |
| `components/ThemeProvider.tsx` | Theme context + `setTheme` |
| `components/ThemeToggle.tsx` | Header control |
| `components/motion/Reveal.tsx` | whileInView fade/lift |
| `components/SiteHeader.tsx` | Marketing/shared header + toggle |
| `components/SiteFooter.tsx` | Dense footer |
| `components/LeadCaptureModal.tsx` | Modal tokens |
| `components/BrandLogoMark.tsx` | Size only if needed |
| `components/Hero.tsx` … `CtaBand.tsx` | Marketing sections |
| `components/spaces/*` | Browse + detail visual rebuild |
| `app/spaces/layout.tsx`, `page.tsx`, `[slug]/page.tsx` | Shell class/token alignment |
| `openmemory.md` | Pattern note after QA |

## Parallel execution waves

```
Wave 0 (serial gate):     Task 1  Foundation
Wave 1 (parallel ×4):     Task 2 ‖ Task 3 ‖ Task 4 ‖ Task 5
Wave 2 (parallel ×9):     Task 6 ‖ 7 ‖ 8 ‖ 9 ‖ 10 ‖ 11 ‖ 12 ‖ 13 ‖ 14
Wave 3 (parallel ×8):     Task 15 ‖ 16 ‖ 17 ‖ 18 ‖ 19 ‖ 20 ‖ 21 ‖ 22
Wave 4 (parallel ×3):     Task 23 ‖ 24 ‖ 25
Wave 5 (serial):          Task 26  Cross-surface QA + openmemory
```

**Coordinator rules for max parallelism**

1. Create branch `feat/v3-calm-production-ui` in Task 1 only.
2. Wave 1–4: dispatch N implementer subagents in **one** turn; file sets must not overlap.
3. If two subagents need the same file, they are in the wrong wave — fix the plan, do not dual-edit.
4. Subagents commit only their owned files on the shared branch; coordinator confirms clean `git status` between waves.
5. Model tip: foundation + reviewers = stronger model; mechanical restyles = faster model OK.

```
File ownership (no overlaps across parallel tasks):

Wave 1:
  T2 SiteHeader.tsx
  T3 SiteFooter.tsx
  T4 LeadCaptureModal.tsx
  T5 SpacesHeader.tsx

Wave 2:
  T6 Hero  T7 Services  T8 HowItWorks  T9 About
  T10 MicroMarkets  T11 Testimonials  T12 FounderTeaser
  T13 FAQ  T14 CtaBand

Wave 3:
  T15 SpacesHomeHero  T16 SpacesBrowseChrome  T17 SpacesAiSearch
  T18 SpaceCard  T19 SpacesFiltersModal  T20 SpacesEmpty+StaleBanner
  T21 LikeSpaceButton  T22 SpacesMap+ApproxAreaMap (chrome/classes only)

Wave 4:
  T23 app/spaces/[slug]/page.tsx shell classes
  T24 SpaceGallery.tsx
  T25 SpaceInsightPanel.tsx
```

---

### Task 1: Foundation — tokens, fonts, theme, Reveal, motion dep

**Files:**
- Modify: `package.json` (add `"motion"`)
- Create: `public/theme-init.js`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Create: `components/ThemeProvider.tsx`
- Create: `components/ThemeToggle.tsx`
- Create: `components/motion/Reveal.tsx`

**Interfaces:**
- Produces:
  - CSS vars: `--accent`, `--accent-dark`, `--accent-soft`, `--bg`, `--surface`, `--border`, `--ink`, `--ink-secondary`, `--muted`, `--on-accent`, `--radius` (+ dark under `html.dark`)
  - `ThemeProvider({ children })` — client; exposes `useTheme(): { theme: 'system'|'light'|'dark'; resolved: 'light'|'dark'; setTheme(t) }`
  - `ThemeToggle()` — cycles `system → light → dark → system`
  - `Reveal({ children, className?, delay?: number })` — Motion `whileInView` opacity/y; skip animation if reduced motion
  - `public/theme-init.js` — reads `gs-theme` and toggles `html.dark` before paint
- Consumes: none

- [ ] **Step 1: Create branch + install motion**

```bash
git checkout -b feat/v3-calm-production-ui
npm install motion
```

Expected: `motion` in `package.json` dependencies.

- [ ] **Step 2: Create `public/theme-init.js`**

```js
(function () {
  try {
    var t = localStorage.getItem("gs-theme");
    var dark =
      t === "dark" ||
      (t !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
```

- [ ] **Step 3: Replace `app/globals.css` tokens**

Write full file:

```css
@import "tailwindcss";

:root {
  --accent: #6840b8;
  --accent-dark: #4f2f8f;
  --accent-soft: #f0ebf8;
  --bg: #ffffff;
  --surface: #f6f5f8;
  --border: #e2dde9;
  --ink: #1a1524;
  --ink-secondary: #4a4358;
  --muted: #6e667c;
  --on-accent: #ffffff;
  --radius: 8px;
  --radius-sm: 8px;
  --radius-md: 8px;
  --radius-lg: 8px;
  --page-pad-x: 40px;
}

html.dark {
  --accent: #8b6fd1;
  --accent-dark: #a78bfa;
  --accent-soft: #2a2438;
  --bg: #141218;
  --surface: #1c1824;
  --border: #342e42;
  --ink: #f2eff7;
  --ink-secondary: #c4bdd4;
  --muted: #9b93ad;
  --on-accent: #141218;
}

@layer base {
  html,
  body {
    height: 100%;
  }
  .font-primary {
    font-family: var(--font-sans), "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
  }
  .font-display {
    font-family: var(--font-serif), "Source Serif 4", Georgia, serif;
  }
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}
```

- [ ] **Step 4: Create `components/ThemeProvider.tsx`**

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeChoice = "system" | "light" | "dark";

type ThemeContextValue = {
  theme: ThemeChoice;
  resolved: "light" | "dark";
  setTheme: (t: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "gs-theme";

function getSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDom(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    const initial =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
    setThemeState(initial);
  }, []);

  useEffect(() => {
    const compute = () => {
      const next =
        theme === "system" ? (getSystemDark() ? "dark" : "light") : theme;
      setResolved(next);
      applyDom(next);
    };
    compute();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => compute();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  }, []);

  const value = useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 5: Create `components/ThemeToggle.tsx`**

```tsx
"use client";

import { useTheme, type ThemeChoice } from "@/components/ThemeProvider";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      aria-label={`Theme: ${theme}. Click for ${next}.`}
    >
      {theme === "system" ? "Auto" : theme === "light" ? "Light" : "Dark"}
    </button>
  );
}
```

- [ ] **Step 6: Create `components/motion/Reveal.tsx`**

```tsx
"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.45, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 7: Update `app/layout.tsx`**

Use `next/script` with `strategy="beforeInteractive"` pointing at `/theme-init.js` (static file — not inline HTML). Replace Inter with Source Sans 3 + Source Serif 4. Wrap children in `ThemeProvider`. Keep existing metadata title. Add `suppressHydrationWarning` on `<html>`.

```tsx
import type { Metadata } from "next";
import Script from "next/script";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gentle Space | Commercial Real Estate Consultants in Bangalore",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} ${sourceSerif.variable} h-full scroll-smooth`}
      suppressHydrationWarning
    >
      <body className="font-primary bg-[var(--bg)] text-[var(--ink)] h-full antialiased">
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit
```

Expected: exit 0 for new errors from this task (fix any you introduced).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json public/theme-init.js app/globals.css app/layout.tsx \
  components/ThemeProvider.tsx components/ThemeToggle.tsx components/motion/Reveal.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add v3 calm tokens, fonts, theme provider, and Reveal

EOF
)"
```

---

### Task 2: SiteHeader + theme toggle wiring

**Files:**
- Modify: `components/SiteHeader.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` from `@/components/ThemeToggle`
- Produces: denser sticky header matching v3

- [ ] **Step 1: Restyle header** — keep nav link logic and lead modal. Sticky + border + blur; padding `px-5 lg:px-10`; insert `<ThemeToggle />` before Contact Us; `rounded-[var(--radius)]` on CTA.

- [ ] **Step 2: Smoke** — `/` toggle cycles; Contact Us opens modal.

- [ ] **Step 3: Commit**

```bash
git add components/SiteHeader.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle SiteHeader for v3 calm shell

EOF
)"
```

---

### Task 3: SiteFooter densify

**Files:**
- Modify: `components/SiteFooter.tsx`

**Interfaces:**
- Consumes: tokens only
- Produces: dense 3-col footer; keep all links/contact strings

- [ ] **Step 1: Restyle** to v3 density (`max-w-[1120px]`, tighter gaps, accent uppercase headings).

- [ ] **Step 2: Commit**

```bash
git add components/SiteFooter.tsx
git commit -m "$(cat <<'EOF'
feat(ui): densify SiteFooter to v3 calm layout

EOF
)"
```

---

### Task 4: LeadCaptureModal tokens

**Files:**
- Modify: `components/LeadCaptureModal.tsx`

**Interfaces:**
- Consumes: `useLeadCapture`, `buildWhatsAppUrl`
- Produces: modal using `--surface` inputs, `--radius`, AA focus on accent

- [ ] **Step 1: Restyle only** — keep fields, need pills, WhatsApp submit; dark-readable placeholders.

- [ ] **Step 2: Commit**

```bash
git add components/LeadCaptureModal.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle LeadCaptureModal for v3 tokens

EOF
)"
```

---

### Task 5: SpacesHeader + theme toggle

**Files:**
- Modify: `components/spaces/SpacesHeader.tsx`

**Interfaces:**
- Consumes: `ThemeToggle`
- Produces: header aligned with SiteHeader (height ≤80px)

- [ ] **Step 1: Restyle + ThemeToggle** without changing browse-mode props/callbacks.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpacesHeader.tsx
git commit -m "$(cat <<'EOF'
feat(ui): align SpacesHeader with v3 shell and theme toggle

EOF
)"
```

---

### Task 6: Hero

**Files:**
- Modify: `components/Hero.tsx`

**Interfaces:**
- Consumes: `Reveal`, `CONTENT`, `SITE`, `useLeadCapture`
- Produces: split hero; `font-display` H1; incentive + CTAs in first viewport

- [ ] **Step 1: Restyle** — wrap in `Reveal`; H1 `font-display`; padding `py-12 lg:py-14`; container `max-w-[1120px] mx-auto px-5 lg:px-10`; image `rounded-[var(--radius)]`.

- [ ] **Step 2: Commit**

```bash
git add components/Hero.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle Hero to v3 calm split layout

EOF
)"
```

---

### Task 7: Services (dense lists)

**Files:**
- Modify: `components/Services.tsx`

**Interfaces:**
- Consumes: `Reveal`, services content
- Produces: two-column hairline lists (not 3 equal cards)

- [ ] **Step 1: Rebuild layout** — keep all titles/body; For Companies / For Property Owners groups; prefer no eyebrow.

- [ ] **Step 2: Commit**

```bash
git add components/Services.tsx
git commit -m "$(cat <<'EOF'
feat(ui): rebuild Services as v3 dense lists

EOF
)"
```

---

### Task 8: HowItWorks

**Files:**
- Modify: `components/HowItWorks.tsx`

**Interfaces:**
- Consumes: `Reveal`, how-it-works content
- Produces: numbered dense 2-col list; six steps copy preserved

- [ ] **Step 1: Restyle** to v3 steps-dense pattern.

- [ ] **Step 2: Commit**

```bash
git add components/HowItWorks.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle HowItWorks to v3 dense steps

EOF
)"
```

---

### Task 9: About / Why Us

**Files:**
- Modify: `components/About.tsx`

**Interfaces:**
- Consumes: `Reveal`
- Produces: copy + fee box on `--accent-soft`

- [ ] **Step 1: Restyle** fee panel; keep fee copy verbatim.

- [ ] **Step 2: Commit**

```bash
git add components/About.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle About section to v3 calm density

EOF
)"
```

---

### Task 10: MicroMarkets

**Files:**
- Modify: `components/MicroMarkets.tsx`

**Interfaces:**
- Consumes: `Reveal`
- Produces: headline + compact locality presentation; names preserved

- [ ] **Step 1: Restyle** toward v3 density.

- [ ] **Step 2: Commit**

```bash
git add components/MicroMarkets.tsx
git commit -m "$(cat <<'EOF'
feat(ui): densify MicroMarkets locations section

EOF
)"
```

---

### Task 11: Testimonials

**Files:**
- Modify: `components/Testimonials.tsx`

**Interfaces:**
- Consumes: `Reveal`
- Produces: 2-col dense quotes; attribution with hyphen not em-dash; quotes verbatim

- [ ] **Step 1: Restyle** cards.

- [ ] **Step 2: Commit**

```bash
git add components/Testimonials.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle Testimonials to v3 dense quotes

EOF
)"
```

---

### Task 12: FounderTeaser

**Files:**
- Modify: `components/FounderTeaser.tsx`

**Interfaces:**
- Consumes: `Reveal`, portrait, SITE fields
- Produces: denser founder split; bio verbatim

- [ ] **Step 1: Restyle**.

- [ ] **Step 2: Commit**

```bash
git add components/FounderTeaser.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle FounderTeaser to v3 calm layout

EOF
)"
```

---

### Task 13: FAQ

**Files:**
- Modify: `components/FAQ.tsx`

**Interfaces:**
- Consumes: `Reveal`
- Produces: hairline accordion; behavior preserved

- [ ] **Step 1: Restyle**.

- [ ] **Step 2: Commit**

```bash
git add components/FAQ.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle FAQ accordion for v3 tokens

EOF
)"
```

---

### Task 14: CtaBand

**Files:**
- Modify: `components/CtaBand.tsx`

**Interfaces:**
- Consumes: `Reveal`, `useLeadCapture`
- Produces: accent band; AA button contrast in both themes

- [ ] **Step 1: Restyle**; verify dark `--on-accent` contrast.

- [ ] **Step 2: Commit**

```bash
git add components/CtaBand.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle CtaBand for v3 accent band

EOF
)"
```

---

### Task 15: SpacesHomeHero

**Files:**
- Modify: `components/spaces/SpacesHomeHero.tsx`

**Interfaces:**
- Consumes: existing search/entry props
- Produces: calm denser hero; same callbacks

- [ ] **Step 1: Restyle only**.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpacesHomeHero.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle SpacesHomeHero to v3 calm

EOF
)"
```

---

### Task 16: SpacesBrowseChrome

**Files:**
- Modify: `components/spaces/SpacesBrowseChrome.tsx`

**Interfaces:**
- Consumes: children/slots as today
- Produces: quieter borders/surfaces; keep split structure

- [ ] **Step 1: Restyle chrome classes only**.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpacesBrowseChrome.tsx
git commit -m "$(cat <<'EOF'
feat(ui): quiet SpacesBrowseChrome with v3 tokens

EOF
)"
```

---

### Task 17: SpacesAiSearch

**Files:**
- Modify: `components/spaces/SpacesAiSearch.tsx`

**Interfaces:**
- Consumes: existing search handlers
- Produces: AA inputs; accent focus ring

- [ ] **Step 1: Restyle form controls**; keep submit/clear.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpacesAiSearch.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle SpacesAiSearch for v3 form tokens

EOF
)"
```

---

### Task 18: SpaceCard

**Files:**
- Modify: `components/spaces/SpaceCard.tsx`

**Interfaces:**
- Consumes: `PublicListing` props unchanged
- Produces: denser card; token borders

- [ ] **Step 1: Restyle**; no privacy/display helper changes.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpaceCard.tsx
git commit -m "$(cat <<'EOF'
feat(ui): rebuild SpaceCard visual language for v3

EOF
)"
```

---

### Task 19: SpacesFiltersModal

**Files:**
- Modify: `components/spaces/SpacesFiltersModal.tsx`

**Interfaces:**
- Consumes: filter state props
- Produces: modal density matching LeadCaptureModal

- [ ] **Step 1: Restyle**; keep apply/clear logic.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpacesFiltersModal.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle SpacesFiltersModal to v3 density

EOF
)"
```

---

### Task 20: SpacesEmpty + SpacesStaleBanner

**Files:**
- Modify: `components/spaces/SpacesEmpty.tsx`
- Modify: `components/spaces/SpacesStaleBanner.tsx`

**Interfaces:**
- Consumes: existing props
- Produces: soft surfaces; dark-readable

- [ ] **Step 1: Restyle both**.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpacesEmpty.tsx components/spaces/SpacesStaleBanner.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle Spaces empty and stale banner states

EOF
)"
```

---

### Task 21: LikeSpaceButton

**Files:**
- Modify: `components/spaces/LikeSpaceButton.tsx`

**Interfaces:**
- Consumes: existing like handlers
- Produces: token interactive states

- [ ] **Step 1: Restyle**; keep like persistence.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/LikeSpaceButton.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle LikeSpaceButton for v3 tokens

EOF
)"
```

---

### Task 22: Map chrome (SpacesMap + ApproxAreaMap)

**Files:**
- Modify: `components/spaces/SpacesMap.tsx`
- Modify: `components/spaces/ApproxAreaMap.tsx`

**Interfaces:**
- Consumes: map hooks unchanged
- Produces: tokenized containers/fallbacks only — **do not change** Maps init, circles, or approx logic

- [ ] **Step 1: Class/token updates only**.

- [ ] **Step 2: Manual check** — browse + detail maps still render.

- [ ] **Step 3: Commit**

```bash
git add components/spaces/SpacesMap.tsx components/spaces/ApproxAreaMap.tsx
git commit -m "$(cat <<'EOF'
feat(ui): token-align Spaces map chrome without logic changes

EOF
)"
```

---

### Task 23: Listing detail page shell

**Files:**
- Modify: `app/spaces/[slug]/page.tsx`

**Interfaces:**
- Consumes: server data unchanged
- Produces: shell typography/spacing/token classes

- [ ] **Step 1: Update layout classes only**; no data-fetch changes.

- [ ] **Step 2: Commit**

```bash
git add 'app/spaces/[slug]/page.tsx'
git commit -m "$(cat <<'EOF'
feat(ui): apply v3 tokens to listing detail page shell

EOF
)"
```

---

### Task 24: SpaceGallery

**Files:**
- Modify: `components/spaces/SpaceGallery.tsx`

**Interfaces:**
- Consumes: image list props
- Produces: calm gallery chrome; radius 8px

- [ ] **Step 1: Restyle**; keep lightbox/nav behavior.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpaceGallery.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle SpaceGallery for v3 calm chrome

EOF
)"
```

---

### Task 25: SpaceInsightPanel

**Files:**
- Modify: `components/spaces/SpaceInsightPanel.tsx`

**Interfaces:**
- Consumes: insight fetch/cache unchanged
- Produces: panel tokens; AA loading/empty/error/success

- [ ] **Step 1: Restyle**.

- [ ] **Step 2: Commit**

```bash
git add components/spaces/SpaceInsightPanel.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle SpaceInsightPanel for v3 tokens

EOF
)"
```

---

### Task 26: Cross-surface QA + openmemory

**Files:**
- Modify: `openmemory.md`
- Fix residual class bugs if found (same branch)

**Interfaces:**
- Consumes: all prior tasks
- Produces: QA pass; openmemory pattern bullet

- [ ] **Step 1: Manual QA**

| Check | Pass? |
|-------|-------|
| `/` light: v3 density, serif H1, services lists | |
| `/` dark: readable, accent CTA contrast | |
| Theme toggle persists across reload | |
| Reduced motion: no Reveal animation | |
| Lead modal WhatsApp opens with draft | |
| `/spaces` search + filters + map | |
| `/spaces/[slug]` gallery + insight + like | |
| Header toggle on Spaces | |
| No em-dash in new UI chrome | |
| `npx tsc --noEmit` clean for our changes | |

- [ ] **Step 2: Update `openmemory.md` Patterns**

```markdown
- **v3 Calm Structured production UI (2026-08-01):** Source Sans 3 + Source Serif 4, dual theme (`ThemeProvider` + `gs-theme`), Motion `Reveal`, accent `#6840B8`. Spec: `docs/superpowers/specs/2026-08-01-v3-calm-structured-production-redesign.md`. Lab reference: `frontend-redesign/v3-calm-structured/`.
```

- [ ] **Step 3: Commit**

```bash
git add openmemory.md
git commit -m "$(cat <<'EOF'
docs: record v3 calm production UI pattern after QA

EOF
)"
```

---

## Subagent dispatch templates

### Implementer prompt (paste per task)

```
You are implementing ONE task from docs/superpowers/plans/2026-08-01-v3-calm-structured-production-ui.md
Task number: N
Branch: feat/v3-calm-production-ui
Read: Global Constraints + File map + your Task N only + the design spec linked in the plan.
Also skim frontend-redesign/v3-calm-structured/ for visual intent (do not copy HTML wholesale).
Do not edit files outside your Files list.
Do not change APIs, copy, or product behavior.
Commit once at end of task with the given message.
Return: files changed, commands run, any blockers.
```

### Reviewer prompt (after each task)

```
Review Task N against docs/superpowers/plans/2026-08-01-v3-calm-structured-production-ui.md and
docs/superpowers/specs/2026-08-01-v3-calm-structured-production-redesign.md.
Check: file ownership respected, tokens/fonts/theme rules, no API/copy changes,
reduced-motion for Reveal usage, dark contrast for CTAs/forms, no em-dashes in new chrome.
Verdict: APPROVE or list Critical/Important fixes.
```

---

## Self-review (plan vs spec)

| Spec requirement | Task(s) |
|------------------|---------|
| Tokens light/dark | T1 |
| Source Sans + Serif via next/font | T1 |
| ThemeProvider + persisted toggle | T1, T2, T5 |
| Motion Reveal calm | T1 (+ usage T6–T14) |
| Marketing sections full set | T6–T14 |
| Spaces browse visual rebuild | T15–T22 |
| Spaces detail | T23–T25 |
| Preserve APIs/copy/behavior | Global Constraints |
| QA both themes + reduced motion | T26 |
| openmemory update | T26 |
| No design-sandbox / lab deletion | Global Constraints |

Placeholder scan: none intentional. Parallel waves have disjoint file sets.
Max parallel width: Wave 2 = 9 subagents; Wave 3 = 8; Wave 1 = 4; Wave 4 = 3.
