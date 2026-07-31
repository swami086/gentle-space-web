import { firecrawlMap, firecrawlScrape } from "@/lib/firecrawl/client";
import { extractPricingHint } from "./price";
import type { DiscoveredListing, RawListing, SourceAdapter } from "./types";

export const COFYND_INDEX_URL = "https://cofynd.com/coworking/bangalore";

const COFYND_HOST = "cofynd.com";
const DETAIL_PATH = /^\/coworking\/([a-z0-9-]+)\/?$/i;

/** City index slugs on cofynd.com/coworking/{city} — not individual spaces. */
const CITY_SLUGS = new Set([
  "bangalore",
  "gurgaon",
  "mumbai",
  "delhi",
  "noida",
  "hyderabad",
  "pune",
  "ahmedabad",
  "indore",
  "chennai",
  "jaipur",
  "kochi",
  "chandigarh",
  "lucknow",
  "kolkata",
  "coimbatore",
  "goa",
  "bhubaneswar",
  "faridabad",
  "guwahati",
  "dehradun",
  "jodhpur",
  "ludhiana",
  "patna",
  "raipur",
  "surat",
  "trivandrum",
  "vadodara",
]);

function normalizeCity(city: string): string {
  const trimmed = city.trim();
  if (/^bangalore$/i.test(trimmed)) return "Bengaluru";
  return trimmed;
}

function slugFromUrl(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    if (!hostname.endsWith(COFYND_HOST)) return null;
    const match = pathname.match(DETAIL_PATH);
    if (!match) return null;
    const slug = match[1].toLowerCase();
    if (CITY_SLUGS.has(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

export function isCofyndDetailUrl(url: string): boolean {
  return slugFromUrl(url) !== null;
}

export function extractCofyndDetailUrls(links: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of links) {
    const slug = slugFromUrl(link);
    if (!slug) continue;
    const canonical = `https://${COFYND_HOST}/coworking/${slug}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

function extractLinksFromMarkdown(markdown: string): string[] {
  const urls = new Set<string>();
  const mdLink = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  const bare = /https?:\/\/[^\s)\]"']+/g;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(markdown)) !== null) urls.add(m[2]);
  while ((m = bare.exec(markdown)) !== null) urls.add(m[0].replace(/[.,;]+$/, ""));
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

export function parseCofyndDetail(markdown: string, sourceUrl: string): RawListing | null {
  const sourceId = slugFromUrl(sourceUrl);
  if (!sourceId) return null;

  const title =
    firstMatch(markdown, /^#\s+(.+?)\s*$/m) ??
    sourceId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const meta = markdown.match(/(\d+(?:\.\d+)?)\s*\|\s*([^|,]+?),\s*([^|\n]+)/);
  const metaArea = meta?.[2]?.trim() ?? "";
  const metaCity = meta?.[3] ? normalizeCity(meta[3]) : "Bengaluru";

  const locationBlock = markdown.match(/##\s+[^\n]*\bLocation\b[^\n]*\n+([^\n#]+)/i);
  const locationLine = locationBlock?.[1]?.trim() ?? "";
  let area = metaArea;
  let address = locationLine;
  if (locationLine.includes(",")) {
    const [locArea, locCity] = locationLine.split(",").map((s) => s.trim());
    if (locArea) area = area || locArea;
    if (locCity && !meta) address = locationLine;
  }
  if (!address && area) address = `${area}, ${metaCity}`;

  const descHeading = new RegExp(
    `##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const description = (descHeading.exec(markdown)?.[1] ?? "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // cofynd writes the unit after a footnote marker, e.g. "₹5,999/\* month".
  const pricingHint = extractPricingHint(markdown);

  const propertyType =
    firstMatch(markdown, /#####\s+(Premium Coworking|Coworking|Managed Office|Coliving)/i) ??
    (/\bcoworking\b/i.test(markdown) ? "Coworking" : null);

  const images: string[] = [];
  const imgMd = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let im: RegExpExecArray | null;
  while ((im = imgMd.exec(markdown)) !== null) {
    if (!images.includes(im[1])) images.push(im[1]);
  }

  const amenities: string[] = [];
  const amenitySection = markdown.match(/##\s+[^\n]*(?:Amenities|Facilities)[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/i);
  const amenitySource = amenitySection?.[1] ?? markdown;
  const bullets = amenitySource.match(/^[-*]\s+(.+)$/gm) ?? [];
  for (const line of bullets) {
    const item = line.replace(/^[-*]\s+/, "").trim();
    if (item.length > 1 && item.length < 80 && !amenities.includes(item)) {
      amenities.push(item);
    }
  }

  const coords = markdown.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  const lat = coords ? Number.parseFloat(coords[1]) : null;
  const lng = coords ? Number.parseFloat(coords[2]) : null;

  return {
    source: "cofynd",
    sourceId,
    title,
    description,
    shortTeaser: teaser(description || title),
    address,
    area,
    city: metaCity,
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
    amenities,
    images,
    pricingHint,
    propertyType,
    sourceUrl,
  };
}

async function discover(): Promise<DiscoveredListing[]> {
  const [mapped, indexPage] = await Promise.all([
    firecrawlMap(COFYND_INDEX_URL),
    firecrawlScrape(COFYND_INDEX_URL, { includeLinks: true }),
  ]);
  const fromIndex = extractLinksFromMarkdown(indexPage.markdown);
  return extractCofyndDetailUrls([...mapped, ...fromIndex, ...indexPage.links]).map((url) => ({
    sourceId: slugFromUrl(url)!,
    url,
  }));
}

export const cofyndAdapter: SourceAdapter = {
  source: "cofynd",
  discover,
  async fetchDetail(url): Promise<RawListing | null> {
    const { markdown } = await firecrawlScrape(url);
    return parseCofyndDetail(markdown, url);
  },
};
