# Landing page content rewrite design

Date: 2026-07-30
Status: approved, not yet implemented

## Context

The homepage (`app/page.tsx`) copy reads as keyword-stuffed and impersonal: "custom
requirements" appears roughly 15 times, several sentences have grammar errors (e.g. "Share
your details with us get your private property e-brochure...", "can anywhere be between",
"Gentle Space cater"), the framing skews toward office/coworking only even though Gentle
Space handles all commercial real estate types, and the locations section reads as if
coverage is limited to 8 named corridors when it's actually all of Bangalore and
surrounding areas.

A full marketing-context interview (14 sections, guided) was completed first and written
to `.claude/product-marketing-context.md` (validated at 95/100 completeness) so that the
copywriting, content-humanizer, and copy-editing skills all read from the same brand
voice, ICP, differentiation, and customer-language source instead of re-deriving it.

## Goals

1. Rewrite all homepage copy to sound human and trustworthy — not AI-generated.
2. Fix the "office-only" positioning gap: copy must reflect all commercial real estate
   types, not just office/coworking.
3. Fix the Bangalore-coverage framing: all areas in and around Bangalore, corridors as
   examples, not an exhaustive list.
4. Remove keyword-stuffing and grammar errors.
5. No file changes until the user has approved a full before/after diff.

## Non-goals

- No component, layout, or routing changes. Structure of `app/page.tsx` stays identical
  (`Hero → Services → HowItWorks → About → MicroMarkets → Testimonials → FounderTeaser →
  FAQ → CtaBand`).
- No new sections, no visual redesign (rejected Approach C — full redesign — as out of
  scope for a content-only rewrite).
- No reordering of sections (rejected Approach B — moving Testimonials earlier — trust
  fix will instead come from tightening About/MicroMarkets copy above them, without
  touching `app/page.tsx`).
- No fabricated statistics or testimonials. If a proof point isn't in the codebase or
  confirmed by the user, it doesn't go in the copy.
- `/spaces` page copy is out of scope; this is homepage-only.

## Files touched

| File | Content |
|---|---|
| `lib/content.ts` | Hero (kicker, headline, subtext, incentive, CTA labels) |
| `lib/content-services.ts` | Services groups/items, How It Works steps |
| `components/About.tsx` | Why Us heading/body/pills, fee card |
| `components/MicroMarkets.tsx` | Locations heading (coverage framing fix) |
| `components/FAQ.tsx` | All 6 FAQ answers (grammar + framing fixes) |
| `components/CtaBand.tsx` | Final CTA heading/body/button labels |
| `components/SiteHeader.tsx` | Primary CTA button label |
| `components/SiteFooter.tsx` | Footer blurb (broaden beyond "office") |
| `components/Testimonials.tsx`, `FounderTeaser.tsx` | Light touch only — testimonials are real customer quotes, founder bio is already accurate |

## Section-by-section content brief

| Section | Key fix |
|---|---|
| Hero | Lead with customer outcome, not "We specialise..."; broaden beyond office-only framing; replace weak "Contact Us" CTA |
| Services | Explicitly cover all CRE types (office, retail, warehouse/industrial, etc.) |
| How It Works | Keep 6-step structure; tighten grammar; remove repeated "custom requirements" |
| About/Why Us | Reframe around verification/legal as primary differentiator, no-fee as secondary |
| MicroMarkets/Locations | "All areas in and around Bangalore," corridors as examples, not a limit |
| Testimonials | Keep as-is; flag authenticity check before publish |
| Founder | Light polish only |
| FAQ | Fix grammar; align with corrected fee/coverage framing |
| CtaBand/Header/Footer | Consistent CTA wording; footer blurb broadened beyond "office" |

## Cross-cutting fixes (apply everywhere)

- Remove "custom requirements" repetition (~15 instances), "high-trust," "specialise in"
- Broaden "office" → "commercial real estate" / "commercial space" throughout
- Fix identified grammar errors (run-ons, subject-verb agreement)
- Zero exclamation points, ≤1 em dash per section (per `.claude/product-marketing-context.md` style guide)

## Execution process

1. `copywriting` skill — full section-by-section draft using `.claude/product-marketing-context.md`
2. `content-humanizer` (Detect + Humanize modes) + `ai-writing-auditor` — score draft with
   `humanizer_scorer.py`, strip AI patterns, re-run until score improves
3. `copy-editing` skill — final polish pass, preserving the humanized voice
4. Present full before/after diff per section — **no file edits until approved**
5. Apply approved copy to the files listed above

## Success criteria

- `humanizer_scorer.py` score of 80+ on the final draft (or an explicit user override if a
  lower score is accepted for a specific section)
- No fabricated stats or testimonials
- All positioning corrections present (all-CRE-types, all-Bangalore-coverage)
- User has approved the diff before any live file is edited

## Open risks

- Testimonial authenticity was not explicitly re-confirmed during the interview — flagged
  in `.claude/product-marketing-context.md`; will surface again before final approval.
- No numeric proof points (deals closed, sq. ft. leased, years in business) were
  available. Copy will rely on process timelines (5-day shortlist, 1-4 week close) and
  qualitative testimonials instead of fabricating numbers.
