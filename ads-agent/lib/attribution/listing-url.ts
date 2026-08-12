/** Resolves a captured listing URL to a listing slug, or null when it names no listing.
 *
 *  `/spaces` — the index — must return null. It is the default `campaign_drafts.final_url`
 *  (BD4), so resolving it would give every campaign-sourced enquiry a fabricated listing and,
 *  through the listing, a fabricated corridor. */
export function listingSlugFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const segments = pathname.split("/").filter((s) => s.length > 0);
  if (segments.length !== 2) return null;
  if (segments[0] !== "spaces") return null;
  return decodeURIComponent(segments[1]);
}
