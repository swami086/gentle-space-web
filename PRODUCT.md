# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Companies/tenants** seeking commercial space in Bangalore: first-Bangalore-office tech companies, F&B establishments, manufacturing businesses, and overseas businesses entering India. Job: find the right office/retail/warehouse space fast, on clear terms, without wading through inflated listings or dead-end tours.
- **Property owners** with commercial buildings/floors to lease. Job: find a screened, reliable tenant and close on clear terms.

## Product Purpose

Gentle Space is a Bangalore commercial real estate (CRE) consultancy paired with an AI-assisted space-search product (`/spaces`). It matches a brief to inventory across office, retail, and warehouse space; verifies the opportunity (legal, pricing, landlord reliability) before a client ever tours it; and stays engaged through negotiation, legal, paperwork, and handover — and after move-in for renewals/expansions. For property owners, it sources vetted tenants and manages the close from the other side.

## Positioning

Not a listings board. Listings show what's available; they don't say whether the building has legal issues, the landlord is reliable, or the price is inflated — Gentle Space checks all of that before a tour, and stays on the deal end to end rather than handing off after the intro call. Standard requirements are free; a highly customized search outside the existing network carries a fixed fee, agreed upfront.

## Operating Context

- Briefs arrive via WhatsApp / the site's lead-capture modal / phone / email; reply within the hour, shortlist typically within five working days, brief-to-signed-lease in one to four weeks.
- Bangalore-wide coverage; heaviest activity in Whitefield, Outer Ring Road, Koramangala, Indiranagar, HSR Layout, Electronic City, MG Road, and Sarjapur Road.
- Second surface, `/spaces`: an AI-search browse product over a synced, verified listings catalog (vector + graph-boosted search, map, filters, an on-demand "why this fits" AI insight panel).

## Capabilities and Constraints

- Two live surfaces: (1) the marketing/consulting site with lead capture, and (2) the Spaces browse product (search → filter → map → listing detail), backed by a synced listings database.
- Contact paths are WhatsApp, the lead-capture modal, phone, and email — no live chat.
- Registered business facts (GSTIN, CIN, legal name, address) are real and on the public site; never substitute placeholder or invented figures for these.

## Brand Commitments

- Name: **Gentle Space** (legal entity: Gentle Space Global Solutions).
- Existing circular logo mark (`public/gentle-space-logo-mark.png`) is a fixed asset — preserve it as-is in any redesign.
- Founder identity (Sanjay Singh) and his portrait (`public/sanjay-singh-portrait.jpg`) are factual content, not stock imagery — preserve if a founder section is carried into new designs.
- Four real, named client testimonials exist — preserve wording and attribution; never invent new testimonials.

## Evidence on Hand

- Real, final copy for hero, services, how-it-works, testimonials, FAQ, and founder bio already lives in `components/*.tsx` and `lib/content.ts` / `lib/content-services.ts` — this is the copy any redesign must reuse verbatim, not paraphrase.
- Founder portrait: `public/sanjay-singh-portrait.jpg`. Logo: `public/gentle-space-logo-mark.png`.
- Real registered address, GSTIN, and CIN in `lib/site.ts` — state absence/placeholder status explicitly rather than fabricating different figures if ever missing.

## Product Principles

1. **Trust over inventory** — verification and legal follow-through are the differentiator, not listing volume.
2. **Speed with rigor** — fast reply and shortlist, but the vetting step is never skipped.
3. **Two-sided service** — tenants and property owners both get full-service treatment, not just a listings feed.
4. **Local expertise as proof** — the founder's Bangalore-specific, on-the-ground knowledge is the credibility anchor, not generic claims.

## Accessibility & Inclusion

No explicit standard required beyond baseline web accessibility; the current header already uses `aria-expanded`/`aria-controls` and keyboard (Escape) handling for its mobile nav — preserve equivalent semantics in any redesign.
