// Defensive alias map: a corridor's canonical name -> the other strings a
// listing's `area` might actually store. Keeps corridor filtering (the preview
// and the /spaces?area= deep-link) working when the DB uses a variant like "ORR".
// Matching is exact per variant (case-insensitive), not substring, to avoid
// over-matching sub-areas.
const AREA_ALIASES: Record<string, string[]> = {
  "Outer Ring Road": ["ORR", "Outer Ring Road (ORR)", "O.R.R"],
  "HSR Layout": ["HSR", "HSR Sector 1", "HSR Sector 2"],
  "Electronic City": ["Electronics City", "E-City", "Electronic City Phase 1", "Electronic City Phase 2"],
  "MG Road": ["M.G. Road", "M G Road", "Mahatma Gandhi Road"],
  "Indiranagar": ["Indira Nagar"],
  "Sarjapur Road": ["Sarjapur", "Sarjapur Rd", "Sarjapur Main Road"],
  "Koramangala": ["Koramangala 1st Block", "Koramangala 5th Block"],
  "Whitefield": ["Whitefield Main Road"],
};

const LOOKUP = new Map<string, string[]>();
for (const [canonical, aliases] of Object.entries(AREA_ALIASES)) {
  LOOKUP.set(
    canonical.toLowerCase(),
    [canonical, ...aliases].map((value) => value.toLowerCase()),
  );
}

/** True if a listing's area equals the filter area, or a known alias of it. */
export function areaMatchesFilter(listingArea: string, filterArea: string): boolean {
  const listing = listingArea.trim().toLowerCase();
  const filter = filterArea.trim().toLowerCase();
  if (listing === filter) return true;
  const variants = LOOKUP.get(filter);
  return variants ? variants.includes(listing) : false;
}
