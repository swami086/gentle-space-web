import { firecrawlScrape } from "@/lib/firecrawl/client";
import { localityFromAddress } from "@/lib/listings/address";
import { formatPricingHint } from "./price";
import type { DiscoveredListing, RawListing, SourceAdapter } from "./types";

export const COWORKER_LIST_BASE = "https://www.coworker.com/india/bengaluru";

const COWORKER_HOST = "coworker.com";
const DETAIL_PATH = /^\/india\/bengaluru\/([a-z0-9-]+)\/?$/i;
// ponytail: safety cap; ~10 listings/page × 50 pages covers current Bengaluru inventory
const MAX_LIST_PAGES = 50;

function slugFromUrl(url: string): string | null {
  try {
    const { hostname, pathname, hash } = new URL(url);
    if (!hostname.endsWith(COWORKER_HOST)) return null;
    if (hash) return null;
    const match = pathname.match(DETAIL_PATH);
    if (!match) return null;
    const slug = match[1].toLowerCase();
    if (slug === "bengaluru") return null;
    return slug;
  } catch {
    return null;
  }
}

export function isCoworkerDetailUrl(url: string): boolean {
  if (/virtual-offices/i.test(url)) return false;
  return slugFromUrl(url.split("#")[0].split("?")[0]) !== null;
}

function canonicalDetailUrl(url: string): string | null {
  const slug = slugFromUrl(url.split("#")[0].split("?")[0]);
  if (!slug) return null;
  return `https://www.${COWORKER_HOST}/india/bengaluru/${slug}`;
}

export function extractCoworkerDetailUrls(links: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of links) {
    if (!isCoworkerDetailUrl(link)) continue;
    const canonical = canonicalDetailUrl(link);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

function extractLinksFromMarkdown(markdown: string): string[] {
  const urls = new Set<string>();
  for (const m of markdown.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
    urls.add(m[2]);
  }
  for (const m of markdown.matchAll(/https?:\/\/[^\s)\]"']+/g)) {
    urls.add(m[0].replace(/[.,;]+$/, ""));
  }
  return [...urls];
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m?.[1]?.trim() ?? null;
}

function teaser(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trim()}…`;
}

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parsePricingHint(markdown: string): string | null {
  // Detail pages end with a "Spaces Near …" block that quotes *other* venues'
  // rates, so price must only ever be read from the subject's Pricing Plans.
  const plansIndex = markdown.search(/##\s+Pricing Plans/i);
  if (plansIndex < 0) return null;
  const plans = markdown.slice(plansIndex);

  const monthly = firstMatch(plans, /###\s+Monthly\s*\n+\s*₹\s*([\d,]+)/i);
  if (monthly) return formatPricingHint(monthly, "month");

  const daily = firstMatch(plans, /###\s+Daily\s*\n+\s*₹\s*([\d,]+)/i);
  if (daily) return formatPricingHint(daily, "day");

  return null;
}

export function parseCoworkerDetail(markdown: string, sourceUrl: string): RawListing | null {
  const sourceId = slugFromUrl(sourceUrl);
  if (!sourceId) return null;

  const title =
    firstMatch(markdown, /##\s+Overview of\s+(.+?)\s*$/im) ??
    firstMatch(markdown, /\[([^\]]+?)\s+in\s+Bengaluru\]/i) ??
    titleFromSlug(sourceId);

  const address =
    firstMatch(
      markdown,
      /([A-Za-z0-9][^\n]{2,120},\s*Bengaluru,\s*Karnataka\s+\d{6},\s*India)/,
    ) ?? "";
  const area = localityFromAddress(address);

  const overview = markdown.match(/##\s+Overview of[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/i);
  const description = (overview?.[1] ?? "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const propertyType =
    (/\bCoworking Space\b/.test(markdown) ? "Coworking Space" : null) ??
    (/\bPrivate Office\b/.test(markdown) ? "Private Office" : null) ??
    (/\bVirtual Office\b/.test(markdown) ? "Virtual Office" : null);

  const images: string[] = [];
  for (const m of markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/coworker\.imgix\.net[^)\s]+)\)/gi)) {
    const url = m[1].split("?")[0];
    if (!images.includes(url)) images.push(url);
  }

  const amenities: string[] = [];
  const amenitySection = markdown.match(
    /##\s+(?:Coworking Space )?Amenities[\s\S]*?(?=\n##\s|$)/i,
  );
  if (amenitySection) {
    for (const m of amenitySection[0].matchAll(/- !\[[^\]]*\]\([^)]+\)\n([^\n-][^\n]*)/g)) {
      const item = m[1].trim();
      if (item.length > 1 && item.length < 80 && !amenities.includes(item)) {
        amenities.push(item);
      }
    }
  }

  const coords = markdown.match(/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/);
  const lat = coords ? Number.parseFloat(coords[1]) : null;
  const lng = coords ? Number.parseFloat(coords[2]) : null;

  return {
    source: "coworker",
    sourceId,
    title,
    description,
    shortTeaser: teaser(description || title),
    address,
    area,
    city: "Bengaluru",
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
    amenities,
    images,
    pricingHint: parsePricingHint(markdown),
    propertyType,
    sourceUrl: canonicalDetailUrl(sourceUrl) ?? sourceUrl,
  };
}

async function discover(): Promise<DiscoveredListing[]> {
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const listUrl = page === 1 ? COWORKER_LIST_BASE : `${COWORKER_LIST_BASE}?page=${page}`;
    const { markdown, links } = await firecrawlScrape(listUrl, { includeLinks: true });
    const found = extractCoworkerDetailUrls([
      ...links,
      ...extractLinksFromMarkdown(markdown),
    ]);
    const before = seen.size;
    for (const url of found) seen.add(url);
    if (!found.length || seen.size === before) break;
  }

  return [...seen].map((url) => ({ sourceId: slugFromUrl(url)!, url }));
}

export const coworkerAdapter: SourceAdapter = {
  source: "coworker",
  discover,
  async fetchDetail(url): Promise<RawListing | null> {
    const { markdown } = await firecrawlScrape(url);
    return parseCoworkerDetail(markdown, url);
  },
};
