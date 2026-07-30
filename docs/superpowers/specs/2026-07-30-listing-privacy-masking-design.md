# Listing privacy masking design

Date: 2026-07-30
Status: approved, not yet implemented

## Context

Exact prices and exact locations reach the browser today. Not only in the rendered UI —
in the serialized payload, where anyone can read them from devtools in a few clicks.

- `app/spaces/page.tsx:30` passes full `Listing` objects into `SpacesBrowseClient`, a
  client component, so `address`, real `lat`/`lng`, `pricingHint`, and `sourceUrl` are
  embedded in the HTML payload for every visible listing.
- `app/api/spaces/search/route.ts:67` returns the same full objects as JSON.
- `app/spaces/[slug]/page.tsx:84` renders `MapEmbed`, whose iframe `src` and
  "Open in Google Maps" link both carry the exact coordinates; line 90 renders
  `listing.pricingHint`; `generateMetadata` puts raw `description` into `<meta>`.
- `components/spaces/SpacesMap.tsx:73` calls `approximateCoords` only at pin-draw time.
  The offset is cosmetic: the true coordinates were already shipped to the client.
- `components/spaces/SpacesMap.tsx:82` prints `pricingHint` in the map info window.

Two secondary leaks matter as much as the structured fields. Scraped prose names the
building and the street — "located at RMZ Ecoworld, Bellandur", "situated on the 2nd and
3rd Floor, of the Supreme Overseas Exports India Pvt Ltd Building", "300 meters away is
Rashtreeya Vidyalaya Road Metro station". And the "Why this fits" insight panel prints up
to four named nearby places at 50-metre precision (`distanceLabel`,
`lib/places/distance.ts:20`), which trilaterates a property far tighter than any circle
we draw.

Data quality shapes several decisions. Of 11 listings: 7 have an empty `area`, 7 an empty
`address`, 1 has a cofynd markdown-image blob as its `area`, 1 has an address-like `area`
("Metropolis Office Park Plot No: 128-P2"), 1 has no coordinates, and all 11 have a price.

## Goals

1. No exact price reaches the browser, in payload or UI.
2. No exact coordinate, street address, or origin URL reaches the browser.
3. Masking applies automatically to listings added by any future sync, with no per-listing
   step to run and no migration to remember.
4. Server-side capability is preserved: Places lookups, embeddings, and graph scoring keep
   using real coordinates and real prose.

## Non-goals

- Anonymity. See "Accepted limits" — retained titles defeat a motivated searcher.
- Changing titles, slugs, or URLs.
- Fixing the upstream `area`/`address` data quality, or reverse-geocoding localities.
- Any change to what the database stores. Raw values stay.
- An admin or broker view that reveals the masked values.

## Policy decisions

| Decision | Choice |
|---|---|
| Price display | Hidden everywhere; always "Ask for pricing" |
| Budget filter | Deleted, not reworked |
| Location display | Area + city text, plus a 500m circle on maps instead of a pin |
| Street address | Never sent to the browser |
| Titles and slugs | Unchanged, building names retained |
| Scraped prose | Raw in the database; redacted at the read boundary |
| Redaction style | Drop the whole offending sentence, do not patch fragments |
| Area missing or junk | Fall back to city alone ("Bangalore") |
| Nearby place distances | Coarsened to bands; place names retained |
| Masking layer | Read boundary, enforced by the type system |

## Architecture

Masking happens in one place: a pure mapper at the read boundary. Nothing is masked in the
database, and nothing is masked ad hoc in a component.

```
Postgres (raw)
  │
  ├── server-only consumers, unchanged: Places API, embeddings, graph scoring
  │
  └── toPublicListing()  ← lib/listings/public.ts
        │
        ├── app/spaces/page.tsx            → SpacesBrowseClient props
        ├── app/api/spaces/search/route.ts → JSON response
        └── app/spaces/[slug]/page.tsx     → detail render + generateMetadata
```

Goal 3 follows from the shape of this, not from a job: because masking sits on the read
path rather than in the data, a listing inserted by tomorrow's sync is masked the first
time it is read, with nothing to trigger.

### The public shape

`lib/listings/public.ts`:

```ts
export type PublicListing = {
  id: string;
  source: ListingSource;
  slug: string;
  title: string;
  description: string;   // redacted
  shortTeaser: string;   // redacted
  area: string;          // sanitized; "" when unusable
  city: string;
  approxLat: number | null;
  approxLng: number | null;
  approxRadiusM: number;
  amenities: string[];
  images: string[];
  propertyType: string | null;
  syncedAt: string;
  // Absent by construction. `Listing` declares real types here, so a raw
  // `Listing` is not assignable to `PublicListing`.
  address?: never;
  pricingHint?: never;
  sourceUrl?: never;
  lat?: never;
  lng?: never;
  sourceId?: never;
};

export function toPublicListing(listing: Listing): PublicListing;
```

The `?: never` fields carry the enforcement. `Listing.address` is `string`, which is not
assignable to `never | undefined`, so passing a raw `Listing` where a `PublicListing` is
expected is a compile error. A component written later cannot render a price or an address
without failing the build. This is the difference between approach A and a UI-only fix: the
guarantee is structural, not a matter of remembering.

Client component props retype from `Listing` to `PublicListing`: `SpacesBrowseClient`,
`SpaceCard`, `SpacesMap`, `SpacesFiltersModal`, `SpacesHomeHero`, and `applySpacesFilters`.

### Coordinate masking

`toPublicListing` derives the circle center by reusing the existing tested
`approximateCoords(lat, lng, id)` (deterministic 150–300m offset,
`lib/listings/approximateCoords.ts`) and rounding the result to 3 decimals, roughly a 110m
grid. `approxRadiusM` is a constant `500`.

The center is offset, not the true point, so the payload never contains the property's
coordinates; the property lies somewhere inside the circle, off-center. A 500m circle
centered on the true point would have handed the exact location to anyone reading the
payload center.

`lat == null` yields `approxLat: null`, `approxLng: null`, and no circle is drawn.

### Maps

`SpacesMap` replaces `google.maps.Marker` with `google.maps.Circle` at the approximate
center. Fit-bounds becomes `bounds.union(circle.getBounds())`. Hover and click activation
are unchanged; the active-listing highlight becomes a fill-opacity and stroke change rather
than an icon swap. The info window keeps the title link to the detail page and drops the
price line.

`MapEmbed` is replaced by `ApproxAreaMap`, a client component drawing the same circle at
about zoom 14. This removes the iframe whose `src` carried exact coordinates and the
"Open in Google Maps" link that passed them in a URL. When `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY`
is absent, it renders text: "Approximate area — Bellandur, Bangalore".

Both map components then need the Maps JS loader, so its setup is extracted into a small
shared `useGoogleMap()` hook (roughly 25 lines) rather than duplicated. `GOOGLE_MAPS_EMBED_KEY`
becomes unused by the spaces pages.

### Prose redaction

`lib/listings/redact.ts`, pure and independently testable, exporting
`redactSensitiveText(text: string): string`.

It splits text into sentences, drops any sentence matching a sensitive pattern, and rejoins
the survivors. Sentence-level dropping rather than fragment replacement, because replacing
fragments produces broken prose: removing "2nd and 3rd Floor" from "situated on the 2nd and
3rd Floor, of the Supreme Overseas Exports India Pvt Ltd Building" leaves "situated on the ,
of the ...".

A sentence is dropped when it matches any of, case-insensitively:

- Currency or rate: `₹`, `Rs`, `INR`, or 4+ digits followed by `/` or `per`
- Street or unit words: `road`, `rd`, `street`, `st`, `avenue`, `lane`, `layout`, `plot`,
  `tower`, `wing`, `survey no`
- An ordinal followed by `floor`, `cross`, `block`, or `phase`
- A Bangalore PIN code: `5` followed by five digits
- `located` or `situated` followed by `at`, `on`, or `in`
- A precise distance phrase: `within N meters`, or `N meters away/from`

Applied to `description` and `shortTeaser` in `toPublicListing`, and to the detail page's
`generateMetadata` description, which today ships raw prose into a `<meta>` tag.

Empty output is valid. The card's teaser and the detail description are already rendered
conditionally, so a listing whose every sentence was dropped simply shows neither.

`sanitizeArea(area: string): string` returns `""` for values containing a URL or markdown
image syntax, values longer than 40 characters, values containing a comma, and values
matching `plot`, `no:`, `survey`, or a PIN code; otherwise it returns the area trimmed.

It deliberately does **not** reuse the prose redaction patterns. Real Bangalore localities
contain those words — "HSR Layout", "Koramangala 5th Block", "Jayanagar 7th Block" — and
rejecting them would blank the area for exactly the listings whose area is good. The
comma rule is what catches the address-like values, since a locality name has no comma
while "Metropolis Office Park Plot No: 128-P2, EPIP ZONE, ..." has several.

The display line is
`[sanitizedArea, cityLabel].filter(Boolean).join(", ")`, where `cityLabel` maps
"Bengaluru" to "Bangalore" — logic that currently lives inline in the detail page and moves
into the shared helper. The 8 listings without a usable area read "Bangalore".

### Price removal

Deleted rather than reworked, following from the policy that no price is shown at all:

- `parsePricingHintInr` in `lib/listings/filterListings.ts`
- `budgetMin` and `budgetMax` from `SpacesFilterState` and `EMPTY_FILTERS`
- The budget branches of `applySpacesFilters` and the budget chips in `activeFilterChips`
- The entire "Budget / month" section of `SpacesFiltersModal`
- The `listing.pricingHint ?? "Ask for pricing"` fallback in the detail page aside, which
  becomes a plain "Ask for pricing"

`QueryEntities.budgetSignals` is unaffected. It feeds server-side graph scoring and never
reaches the client.

### Insight feature changes

`pricingHint` is removed from `InsightFacts` (`lib/spaces/insight-types.ts`), from the
evidence-fact table (`lib/spaces/insight-prompt.ts:67-69`), and from the highlight renderer
(`lib/spaces/insight-prompt.ts:180-182`, the "Pricing" label). Because the model only
selects evidence IDs and the server renders all user-visible text from that table, deleting
the pricing fact makes a price highlight impossible by construction rather than by
instruction.

`listing.description` is itself an evidence fact that renders as a "Details" highlight
(`lib/spaces/insight-prompt.ts:186-188`), so the redacted description must be the one
placed in the facts — otherwise the insight panel becomes a channel for the raw prose that
section 3 exists to suppress.

A new `distanceBand(meters: number): string` in `lib/places/distance.ts`:

- under 500m → "walking distance"
- 500m to under 1500m → "~1 km"
- 1500m and above → `~N km`, rounded to the nearest kilometre

It substitutes at the single production call site, `lib/spaces/insight.ts:77`. The
`NearbyPlace.distanceLabel` *field* name is unchanged, so nothing downstream churns: the
prompt packet treats the value as an opaque string and no code validates its format.
`distanceMeters` continues to drive server-side sorting. `distanceLabel` has no remaining
production consumer once substituted, so it and its tests are deleted rather than left
behind as a second way to render a distance.

Places lookups continue to use real coordinates. That call is server-side and its
coordinates are never serialized.

## Error handling

Every masking step degrades toward showing less, never toward showing more:

- Missing coordinates → no circle, area text only.
- Redaction removing all sentences → empty string, and the conditional render omits the
  block.
- Unusable area → city alone.
- Maps JS key absent or loader failure → existing "Map unavailable" and text fallbacks.
- The insight feature's existing degradation is unchanged.

There is no path where a masking failure falls back to the raw value, because the raw value
is not present in the type the UI receives.

## Testing

- `lib/listings/public.test.ts` — the forbidden keys are literally absent from the returned
  object (`"address" in result === false`, likewise `pricingHint`, `lat`, `lng`,
  `sourceUrl`, `sourceId`); the approximate point differs from the true point yet falls
  within `approxRadiusM`; null coordinates give null approximates.
- `lib/listings/redact.test.ts` — fixtures taken from the three real descriptions: the
  "RMZ Ecoworld" sentence, the "2nd and 3rd Floor" sentence, and the "300 meters away is
  Rashtreeya Vidyalaya Road Metro station" sentence are dropped; a clean amenities sentence
  survives; `₹44,999/*` and PIN codes are gone.
- `sanitizeArea` — the cofynd markdown blob and "Metropolis Office Park Plot No: 128-P2"
  become `""`; "Bellandur" survives.
- `distanceBand` — boundaries at 499, 500, 1499, and 1500, replacing the existing
  `distanceLabel` cases in `lib/places/distance.test.ts`.
- `app/api/spaces/search/route.test.ts` — the serialized response JSON contains no
  `address`, `pricingHint`, `lat`, `lng`, or `sourceUrl` key. This is the load-bearing
  check: it fails if masking regresses anywhere on the search path.
- Existing filter tests update for the removed budget fields; existing insight tests update
  for the removed pricing fact and the new distance bands.

The implementation plan measures how many of the 11 listings lose their teaser entirely to
sentence-dropping, and reports that before the pattern set is settled.

## Accepted limits

Stated rather than papered over:

- Titles such as `CoWrks Ecoworld`, `Regus - Bangalore, The Estate`, and
  `Corporatedge UB City` are retained by decision, and slugs derive from them. A motivated
  visitor can search the title and find the building. This feature raises friction and
  removes casual exposure; it is not anonymity.
- Photographs may show building signage or a recognizable facade.
- A 500m circle plus locality text still identifies a neighbourhood. That is intended.
- Pattern-based sentence dropping will occasionally remove a harmless sentence, and will
  miss an address phrased in a way the patterns do not anticipate.
- Nothing prevents a future server-side consumer from choosing to serialize a raw
  `Listing`. The type system stops the accident, not a deliberate act.
