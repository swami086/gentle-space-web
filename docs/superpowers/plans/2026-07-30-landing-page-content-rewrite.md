# Landing Page Content Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all homepage copy to sound human and trustworthy, fix the
office-only/limited-coverage positioning gaps, and remove keyword-stuffing and grammar
errors — without touching any component, layout, or routing code.

**Architecture:** Per-section pipeline: draft with `copywriting` skill principles using
`.claude/product-marketing-context.md` as the single source of truth → score with
`content-humanizer`'s `humanizer_scorer.py` (adapted "test" — must clear 80/100) → if
below threshold, apply `content-humanizer` Mode 2 + `ai-writing-auditor` pattern removal
and re-score → final `copy-editing` polish pass → hold all approved section drafts until
one consolidated diff is presented for user approval → only then apply to files.

**Tech Stack:** Next.js/TypeScript content files (`lib/content.ts`,
`lib/content-services.ts`, component-level hardcoded strings); Python scorer scripts
bundled with the `content-humanizer` skill (`~/.cursor/skills/content-humanizer/scripts/humanizer_scorer.py`).

## Global Constraints

- No component, layout, or routing changes — copy only.
- No fabricated statistics or testimonials.
- Zero exclamation points; ≤1 em dash per section.
- Replace "custom requirements," "high-trust," "specialise in" wherever they appear.
- Broaden "office" framing to all commercial real estate types throughout.
- Fix "8 corridors" framing to "all areas in and around Bangalore, corridors as examples."
- `humanizer_scorer.py` score of 80+ required per section before it's considered done (or
  explicit user override noted inline if a short string like a button label can't
  meaningfully score).
- No file in the "Files touched" list of the design spec is edited until Task 9 (final
  approval gate) passes.

---

### Task 1: Hero + header CTA

**Files:**
- Modify (in Task 9 only): `lib/content.ts`, `components/SiteHeader.tsx:94`

**Interfaces:**
- Produces: final `CONTENT.hero` object shape (`kicker`, `headline`, `subtext`,
  `incentive`, `primaryCta`, `secondaryCta`) — Task 9 copies this verbatim into
  `lib/content.ts`. Header button label produced here is reused in Task 9's
  `SiteHeader.tsx` edit.

- [ ] **Step 1: Draft candidate copy**

Using `.claude/product-marketing-context.md` (Brand Voice: professional but approachable,
understated; Customer Language: "kept the search tight," "no surprises on fee or
timeline"), draft:
- Kicker (broadened beyond "TOP COMMERCIAL REAL ESTATE CONSULTANTS" keyword-stuff)
- Headline (customer-outcome-first, not "We specialise...")
- Subtext (mentions all CRE types, not office-only)
- Incentive line (fix grammar: current text reads "Share your details with us get your
  private property e-brochure within an hour" — missing punctuation)
- Primary CTA (replace weak "Contact Us")

- [ ] **Step 2: Score the draft**

Run: `python3 ~/.cursor/skills/content-humanizer/scripts/humanizer_scorer.py <(echo "<draft text>") --json`
Expected: JSON with `overall_score` >= 80. If below 80, note the failing signal categories.

- [ ] **Step 3: Humanize if below threshold**

Apply `content-humanizer` Mode 2 (Pattern Removal and Rhythm Fix) and
`ai-writing-auditor` categories (Tier 1/2 vocabulary, hedging, em-dash overuse) to the
failing draft. Re-run Step 2's scorer command until score >= 80.

- [ ] **Step 4: Copy-edit pass**

Apply `copy-editing` skill's seven-sweep framework (clarity, voice, benefit, proof,
specificity, emotional resonance, risk reduction) to the humanized draft without
reintroducing AI patterns.

- [ ] **Step 5: Record final section text**

Write the finished Hero section text into this plan's Task 1 as the source of truth for
Task 9 (do not touch `lib/content.ts` yet).

---

### Task 2: Services + How It Works

**Files:**
- Modify (in Task 9 only): `lib/content-services.ts`

**Interfaces:**
- Produces: final `SERVICES_CONTENT` and `HOW_IT_WORKS_CONTENT` object shapes (same keys
  as current file: `kicker`, `heading`, `subtext`, `groups[].label`, `groups[].items[]`
  for services; `kicker`, `heading`, `steps[]` for how-it-works).

- [ ] **Step 1: Draft candidate copy**

Rewrite the `heading`/`subtext` to explicitly name multiple CRE types (office, retail,
warehouse/industrial), not just office/coworking. Rewrite all 6 service item bodies and
6 how-it-works step bodies to remove "custom requirements" repetition while preserving
the underlying facts (fee model, verification, legal, paperwork, renewals).

- [ ] **Step 2: Score the draft**

Run: `python3 ~/.cursor/skills/content-humanizer/scripts/humanizer_scorer.py <(echo "<draft text>") --json`
Expected: `overall_score` >= 80.

- [ ] **Step 3: Humanize if below threshold**

Same as Task 1 Step 3, applied to this section's draft.

- [ ] **Step 4: Copy-edit pass**

Same seven-sweep framework as Task 1 Step 4.

- [ ] **Step 5: Record final section text**

---

### Task 3: About / Why Us

**Files:**
- Modify (in Task 9 only): `components/About.tsx:14-40`

**Interfaces:**
- Produces: final heading, body paragraph, 3 pills array, and fee-card heading/body
  strings (same structural slots as current `About()` component).

- [ ] **Step 1: Draft candidate copy**

Reframe the "Why Gentle Space" body to lead with verification/legal support as the
primary differentiator (per `.claude/product-marketing-context.md` Differentiation
section: "verification/legal/end-to-end support is the primary driver; no-fee model is a
strong secondary reason, not the headline reason"). Update the 3 pills accordingly.

- [ ] **Step 2: Score the draft**

Run: `python3 ~/.cursor/skills/content-humanizer/scripts/humanizer_scorer.py <(echo "<draft text>") --json`
Expected: `overall_score` >= 80.

- [ ] **Step 3: Humanize if below threshold**

- [ ] **Step 4: Copy-edit pass**

- [ ] **Step 5: Record final section text**

---

### Task 4: Locations (MicroMarkets)

**Files:**
- Modify (in Task 9 only): `components/MicroMarkets.tsx:21-23`

**Interfaces:**
- Produces: final heading string. `MARKETS` array (the 8 corridor chips) stays unchanged
  — only the framing text around it changes.

- [ ] **Step 1: Draft candidate copy**

Rewrite "Office and commercial space across Bangalore's main corridors" so it reads as
"all areas in and around Bangalore" with the 8 chips presented as examples, not the
entire coverage area. Do not remove or add chips — `MARKETS` array is unchanged.

- [ ] **Step 2: Score the draft**

Run: `python3 ~/.cursor/skills/content-humanizer/scripts/humanizer_scorer.py <(echo "<draft text>") --json`
Expected: `overall_score` >= 80. (Short headings may legitimately score lower on
length/rhythm signals — note this if so, and rely on Step 4's copy-editing judgment
instead of blocking on the number.)

- [ ] **Step 3: Humanize if below threshold**

- [ ] **Step 4: Copy-edit pass**

- [ ] **Step 5: Record final section text**

---

### Task 5: FAQ

**Files:**
- Modify (in Task 9 only): `components/FAQ.tsx:5-36`

**Interfaces:**
- Produces: final `FAQ_ITEMS` array — same 6-item shape (`question`, `answer` per item),
  same order, same `id`/`className` structure untouched (only text content changes).

- [ ] **Step 1: Draft candidate copy**

Fix grammar in all 6 answers (e.g. "Gentle Space cater to highly customised needs" →
"caters"; "can anywhere be between 1 to 4 weeks" → "can be anywhere between 1 to 4
weeks"). Update the coverage answer to "all areas in Bangalore and surrounding areas,"
matching Task 4's framing. Remove "custom requirements" repetition across the 6 answers.

- [ ] **Step 2: Score the draft**

Run: `python3 ~/.cursor/skills/content-humanizer/scripts/humanizer_scorer.py <(echo "<draft text>") --json`
Expected: `overall_score` >= 80.

- [ ] **Step 3: Humanize if below threshold**

- [ ] **Step 4: Copy-edit pass**

- [ ] **Step 5: Record final section text**

---

### Task 6: Final CTA band, header CTA consistency, footer

**Files:**
- Modify (in Task 9 only): `components/CtaBand.tsx:11-16`, `components/SiteFooter.tsx:23`

**Interfaces:**
- Consumes: primary CTA label finalized in Task 1 (must match across header, CTA band,
  and footer for consistency, per Global Constraints).
- Produces: final CtaBand heading/body/button label; final footer blurb sentence.

- [ ] **Step 1: Draft candidate copy**

Rewrite `CtaBand`'s heading/body to match the corrected all-CRE-types framing. Rewrite
`SiteFooter`'s blurb ("Top commercial real estate consultants in Bangalore. Specialists
in custom requirements...") to remove "custom requirements" and broaden beyond "office."
Confirm CTA button label matches Task 1's chosen primary CTA wording.

- [ ] **Step 2: Score the draft**

Run: `python3 ~/.cursor/skills/content-humanizer/scripts/humanizer_scorer.py <(echo "<draft text>") --json`
Expected: `overall_score` >= 80.

- [ ] **Step 3: Humanize if below threshold**

- [ ] **Step 4: Copy-edit pass**

- [ ] **Step 5: Record final section text**

---

### Task 7: Testimonials + Founder — light-touch review

**Files:**
- Modify (in Task 9 only, if changes needed): `components/Testimonials.tsx:2-26`,
  `components/FounderTeaser.tsx:28-32`

**Interfaces:**
- Produces: confirmation (or minimal diff) that these two sections need no rewrite beyond
  what Task 9's cross-cutting terminology sweep catches.

- [ ] **Step 1: Review against design spec's open risk**

Per the design spec's "Open risks" section, testimonial authenticity was not
re-confirmed during the interview. Flag this explicitly in Task 9's presentation — do not
alter the 4 testimonial quotes' content, only confirm the surrounding heading/copy
doesn't repeat flagged terms ("custom requirements," etc.).

- [ ] **Step 2: Draft FounderTeaser touch-up if needed**

Check `FounderTeaser.tsx`'s body paragraph for flagged terms only; it currently reads
cleanly, so expect no material change.

- [ ] **Step 3: Record findings**

Record whether any text in these two components actually changes, or whether this task
is a no-op confirmation.

---

### Task 8: Cross-section consistency check

**Files:**
- None modified — this is a review-only task across the recorded outputs of Tasks 1-7.

**Interfaces:**
- Consumes: all final section texts recorded in Tasks 1-7.

- [ ] **Step 1: Terminology sweep**

Search the combined recorded text for any remaining instance of "custom requirements,"
"high-trust," "high quality outcomes," or "specialise in." Fix any found before Task 9.

- [ ] **Step 2: CTA consistency check**

Confirm the primary CTA wording is identical (or intentionally and consistently varied
per context, e.g. "Share My Custom Brief" in CtaBand vs. a shorter header button label)
across `SiteHeader`, `CtaBand`, and any other CTA instance.

- [ ] **Step 3: Positioning consistency check**

Confirm every section that mentions property type says "commercial real estate" /
"commercial space" broadly rather than defaulting back to "office," and every section
that mentions geographic coverage says "all areas in and around Bangalore."

- [ ] **Step 4: Grammar final pass**

Read all recorded text aloud (in text form) once more for run-ons or subject-verb
mismatches introduced during drafting.

---

### Task 9: Present diff and apply on approval

**Files:**
- Modify: `lib/content.ts`, `lib/content-services.ts`, `components/About.tsx`,
  `components/MicroMarkets.tsx`, `components/FAQ.tsx`, `components/CtaBand.tsx`,
  `components/SiteHeader.tsx`, `components/SiteFooter.tsx`, and, only if Task 7 found a
  needed change, `components/Testimonials.tsx` / `components/FounderTeaser.tsx`.

**Interfaces:**
- Consumes: all finalized section texts from Tasks 1-8.

- [ ] **Step 1: Present consolidated before/after diff**

Show old copy vs. new copy for every file in scope, grouped by file, with the
humanizer_scorer.py score for each section noted inline.

- [ ] **Step 2: Wait for explicit user approval**

Do not proceed to Step 3 until the user approves, requests changes (loop back to the
relevant Task 1-7 and re-run its steps), or approves specific sections while flagging
others.

- [ ] **Step 3: Apply approved copy to each file**

Edit each file in the Files list above with the approved final text, preserving all
existing TypeScript types, component structure, className strings, and non-text logic
exactly as-is — only string literals change.

- [ ] **Step 4: Verify no build regressions**

Run: `npx tsc --noEmit` (or the project's existing lint/typecheck script) to confirm no
type errors were introduced by the string edits.
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/content.ts lib/content-services.ts components/About.tsx components/MicroMarkets.tsx components/FAQ.tsx components/CtaBand.tsx components/SiteHeader.tsx components/SiteFooter.tsx
git commit -m "Rewrite homepage copy for trust, broader CRE positioning, and clarity

Replaces keyword-stuffed, office-only-skewed copy with humanized, all-CRE-types,
all-Bangalore-coverage copy per docs/superpowers/specs/2026-07-30-landing-page-content-rewrite-design.md."
```
