# Design

<!-- impeccable:design-schema 1 -->

## Status

Exploratory. This document records the committed visual direction being
trialed in `design-sandbox/homepage-cadastral/`, built alongside — not
replacing — the live app in `app/` and `components/`. Nothing here is wired
into production yet.

## World: Land Registry Cadastral

**Thesis:** Your brief becomes a verified, numbered plot on an official land
registry survey — trust and diligence rendered as cartographic fact, not a
listings feed.

Chosen via the impeccable direction-roll process (seed key `f031da81`,
assigned index 5 of 7 grounded candidates derived from Gentle Space's own
cultural world), and confirmed after weighing it against two named
challengers — a split-flap departure board and a midnight-blue transit map —
on audience identification and product clarity. Both challengers lost: they
dramatize speed and coverage well, but neither carries the legal-verification
claim that is the product's actual differentiator as directly as a survey
map's plots and wax seal do.

## Palette

Aged cream survey paper, not a white app background. Restrained accent roles,
not decoration:

| Role | Value | Use |
|---|---|---|
| Paper (ground) | `#f6efe1` | Page background |
| Paper deep | `#ede1c8` | Alternating section background |
| Paper line | `#ddccaa` | Hairline rules, borders |
| Ink | `#2b2013` | Body text, headings |
| Ink secondary | `#5c4a34` | Secondary copy |
| Terracotta | `#b1543a` | Commercial-parcel accent, kicker marks |
| Teal | `#1f6f66` | Verified-parcel accent |
| Seal red | `#9a2b1f` | Primary CTA, wax-seal motif |

## Type

Chosen specifically to avoid the AI-generated-site default stack
(Fraunces / IBM Plex / Inter) in favor of faces with real ties to the
registry/ledger world:

- **Zilla Slab** — display serif. A stamped-ledger slab serif for headings.
- **Public Sans** — body. A government-forms sans (USWDS's own face);
  plain, legible, on-theme for "official record."
- **Courier Prime** — mono. A typewriter face for plot numbers, registry
  data, legend labels — not a geometric code font.

## Shape & motif language

- Minimal border-radius (3–6px): drafting-table precision, not soft
  consumer-app pill shapes.
- Hairline rules (1px, `--paper-line`) everywhere a boundary is needed.
- Corner brackets (`.bracketed`) on framed elements (fee callout, founder
  photo) — an architectural-drawing registration mark, not a shadowed card.
- Zone-coding is expressed as a small corner dot + monospace tag on cards,
  not a thick colored left border (the latter was flagged and removed as an
  overused "AI-slop" card pattern during build).
- Section vertical rhythm is intentionally uneven: `section--tight` (56px)
  for the single-line locations band, default (96px) for most sections,
  `section--roomy` (112px) for the two content-heavy anchors (services,
  founder).

## Content rule

Every word of marketing copy, the logo (`gentle-space-logo-mark.png`), the
founder portrait, the four testimonials, and the registered GSTIN/CIN/address
are carried over verbatim from `lib/content*.ts`, `lib/site.ts`, and the
production components. Only the corridor list on the locations section was
newly surfaced as chips — pulled from the real corridor list already present
in the production FAQ copy, not invented.

## Open for the next surface (`/spaces`)

The cadastral plot-grid grammar (numbered parcels, zone-color coding,
compass rose, scale bar) is built to extend naturally into a map-based
browse UI — this is the reason it was favored over the split-flap and
transit-map challengers for the first surface. Revisit the transit-map
challenger specifically when designing `/spaces`; it lost here on the legal/
trust axis but may suit a journey/discovery-oriented browse surface better.
