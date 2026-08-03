# Product Marketing Context — Gentle Space (for ads-agent)

DRAFT — please review and correct before relying on it. Sourced from `PRODUCT.md` and
`docs/superpowers/specs/2026-08-03-ads-automation-agent-design.md`; the CPL figure below is an
explicit placeholder, not derived from real deal economics.

## Product

Gentle Space is a Bangalore commercial real estate (CRE) consultancy paired with an AI-assisted
space-search product (`/spaces`). It matches a brief to office/retail/warehouse inventory,
verifies the opportunity (legal, pricing, landlord reliability) before a client ever tours it, and
stays engaged through negotiation, legal, paperwork, handover, and post-move-in renewals. Not a
listings board — the verification and end-to-end handling are the differentiator.

## Audience

- **Tenant-side (primary, ~80% of ad budget)** — companies seeking office/retail/warehouse space
  in Bangalore: first-Bangalore-office tech companies, F&B, manufacturing, overseas businesses
  entering India. Job to be done: find the right space fast, on clear terms, without wading
  through inflated listings or dead-end tours.
- **Owner-side (secondary, ~20% of ad budget)** — property owners with commercial buildings/floors
  to lease. Job to be done: find a screened, reliable tenant and close on clear terms.

## Geography

Bangalore-wide; heaviest activity in Whitefield, Outer Ring Road, Koramangala, Indiranagar, HSR
Layout, Electronic City, MG Road, and Sarjapur Road. `ads-agent`'s current seed corridor list
(`lib/decision-engine/strategy-config.ts`) is narrower (`whitefield`, `koramangala`, `hsr`) —
treat that as a starting subset, not the full coverage area.

## Offer / funnel

- Standard requirements: free. A highly customized search outside the existing network carries a
  fixed fee, agreed upfront.
- Lead capture: WhatsApp / site lead-capture modal / phone / email. Reply within the hour;
  shortlist typically within five working days; brief-to-signed-lease in one to four weeks.
- **What ads should optimize toward**: qualified Hot/Warm leads in Twenty CRM (quality), not raw
  lead volume — see `optimizeFor: "hot_warm_leads"` in `strategy-config.ts`.

## Current paid-media state (as of this file)

- No ad accounts have live campaigns yet. API credentials are only partially in place.
- Budget: ₹70,000/month starter budget (`monthlyBudgetInr` in `strategy-config.ts`), a
  recommended starting point, not a fixed ceiling forever.
- Breakeven CPL: **₹2,500 — explicit placeholder**, not derived from real deal economics. Revisit
  once ≥30 days of real conversion data exists.
- Negative-keyword seeds already in place: `residential`, `rent flat`, `pg`, `1bhk` — filtering
  out residential-intent traffic on commercial-space keywords.

## What NOT to assume

- No ad creative exists yet — creative generation/testing is explicitly out of scope for
  `ads-agent` Phase 1 (see design spec's non-goals); the user supplies creative manually.
- No live pixel/GA4/GTM implementation exists in the main site yet (confirmed absent as of the
  ads-agent design phase) — don't assume conversion tracking is already wired up.
- Channels are Meta + Google Ads only for `ads-agent` Phase 1 — no LinkedIn, TikTok, etc.
