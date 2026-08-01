# Frontend Redesign Lab

Isolated, zero-build design exploration for Gentle Space's frontend. Plain HTML + CSS +
vanilla JS. Nothing here touches the real Next.js app in `../app`, `../components`,
`../lib`, or `../public` — the only things copied in are the logo mark and founder
portrait (`assets/`), read from the real `public/` folder.

This is unrelated to the `design-sandbox/` folder elsewhere in this repo; that folder
was not used as reference for anything built here.

## How to view

No server, no build step. Open any variant's `index.html` directly in a browser:

```
open v1-confident-editorial/index.html
open v2-cinematic-cold/index.html
open v3-calm-structured/index.html
```

(Some browsers block `file://` fetches to the shared mock-listings module on the
`spaces.html` / `listing.html` pages in Phase 2 — if that happens, run a throwaway
static server from this directory: `python3 -m http.server 8080`.)

## What's real vs. mocked

- **Real:** all homepage copy (hero, services, how-it-works, testimonials, FAQ, founder
  bio, footer contact details) is reused verbatim from `lib/content.ts`,
  `lib/content-services.ts`, `lib/site.ts`, and the current section components. Logo mark
  and founder portrait are the real production assets.
- **Mocked (Phase 2):** `shared/mock-listings.js` holds 6 fabricated Bangalore coworking
  listings for the `/spaces` browse and listing-detail pages. Listing photos are
  `picsum.photos` placeholders, not real property photography. The map panel is a
  styled static placeholder, not a live Google Maps embed (no API key in a static
  sandbox).

## The 3 directions

| Variant | Variance / Motion / Density | Feel |
|---|---|---|
| `v1-confident-editorial` | 7 / 7 / 3 | Recalibrated purple accent, bold geometric sans, asymmetric split hero, bento services grid. Pure CSS + vanilla JS motion (`IntersectionObserver` reveals, magnetic buttons, hover-lift cards). |
| `v2-cinematic-cold` | 8 / 8 / 3 | Closest to the FIND Real Estate reference: bigger type, image reveal-on-scroll, one real pinned/scrubbed scroll moment via GSAP + ScrollTrigger (loaded from CDN, no bundler). |
| `v3-calm-structured` | 5 / 4 / 4 | Restrained control: same content and brand accent, fades/lifts only, denser layout, no scroll-hijacking. |

All three keep the existing brand accent `#6840B8` and the existing logo mark.

## Status

Phase 1 (homepage, all 3 variants) is the current deliverable. Phase 2 (`/spaces`
browse + listing detail) extends whichever direction(s) you pick, using the shared
mock listing dataset.
