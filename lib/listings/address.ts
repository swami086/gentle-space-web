/**
 * Location parsing for scraped listing addresses.
 *
 * Scrapers hand us addresses with markdown/image-icon debris glued to the front, and
 * `coworker` used to derive `area` by taking the first comma-component of the address —
 * which is a floor or door number far more often than a locality. Everything here is a
 * pure function so the same logic runs at scrape time and in the repair script.
 */

const CITY_COMPONENT = /^(?:Bengaluru|Bangalore)$/i;
const CITY_MARKER = /\b(?:Bengaluru|Bangalore|Karnataka)\b/i;

/**
 * Drop the scraper debris that precedes the real text, e.g.
 * `ap_marker.svg)   BNR Complex` or `Map  ![icon](https://…marker.svg)   Bellandur`.
 * The `.svg)` match is greedy so a truncated URL containing several dots still clears.
 */
export function stripScraperJunk(text: string): string {
  return text
    .replace(/^[\s\S]*\.svg\)\s*/i, "")
    .replace(/!\[[^\]]*\]\([^)]*\)\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Rejects street lines, door numbers and pin codes that are not locality names. */
export function looksLikeLocality(text: string): boolean {
  if (!text) return false;
  if (text.length > 40) return false;
  if (text.includes(",")) return false;
  if (/https?:\/\//i.test(text) || /!\[[^\]]*\]\(/.test(text) || /\.svg\b/i.test(text)) return false;
  if (/\bplot\b/i.test(text) || /\bno\s*:/i.test(text) || /\bsurvey\b/i.test(text)) return false;
  if (/\b5\d{5}\b/.test(text)) return false;
  return true;
}

/** True when the address carries a city/state token, i.e. it is a postal address rather
 * than a landmark phrase like "Near By Trinity Metro Station". */
export function hasCityMarker(address: string): boolean {
  return CITY_MARKER.test(address);
}

export function cleanAddress(address: string): string {
  return stripScraperJunk(address);
}

/**
 * The locality is the address component immediately before the city. Verified against
 * all 105 city-bearing addresses in the corpus: the component before `Bengaluru` is the
 * locality in every case, and the two junk-looking ones are junk only because of the
 * markdown prefix that `stripScraperJunk` removes.
 */
export function localityFromAddress(address: string): string {
  const parts = cleanAddress(address).split(",");
  const cityIndex = parts.findIndex((part) => CITY_COMPONENT.test(part.trim()));
  if (cityIndex <= 0) return "";
  const candidate = stripScraperJunk(parts[cityIndex - 1]!.trim());
  return looksLikeLocality(candidate) ? candidate : "";
}
