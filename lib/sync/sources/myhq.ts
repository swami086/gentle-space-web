import { firecrawlMap, firecrawlScrape } from "@/lib/firecrawl/client";
import type { DiscoveredListing, RawListing, SourceAdapter } from "./types";

export const MYHQ_SEED_URL = "https://myhq.in/bangalore";

const MYHQ_HOST = "myhq.in";
const DETAIL_PATH = /^\/dedicated\/coworking-space\/([a-z0-9-]+)\/?$/i;

function normalizeCity(city: string): string {
  const trimmed = city.trim();
  if (/^bangalore$/i.test(trimmed)) return "Bengaluru";
  return trimmed;
}

function slugFromUrl(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    if (!hostname.endsWith(MYHQ_HOST)) return null;
    const match = pathname.match(DETAIL_PATH);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isMyhqDetailUrl(url: string): boolean {
  return slugFromUrl(url) !== null;
}

export function extractMyhqDetailUrls(links: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of links) {
    const slug = slugFromUrl(link);
    if (!slug) continue;
    const canonical = `https://${MYHQ_HOST}/dedicated/coworking-space/${slug}`;
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

export function parseMyhqDetail(markdown: string, sourceUrl: string): RawListing | null {
  const sourceId = slugFromUrl(sourceUrl);
  if (!sourceId) return null;

  const title =
    firstMatch(markdown, /^#\s+(.+?)\s*$/m) ??
    sourceId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const pipeMeta = markdown.match(/coworking\s*\|\s*([^,\n]+),\s*([^\n|]+)/i);
  const subtitleMeta = markdown.match(
    new RegExp(
      `^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+([^,\\n]+)\\s*,\\s*([^\\n]+)`,
      "im",
    ),
  );
  const area = (pipeMeta?.[1] ?? subtitleMeta?.[1] ?? "").trim();
  const city = normalizeCity(pipeMeta?.[2] ?? subtitleMeta?.[2] ?? "Bangalore");

  const pricingHint = firstMatch(
    markdown,
    /(₹[\d,]+(?:\s*\/\s*desk\s*\/\s*month|\/mo|\/month|\/day)?)/i,
  );

  const afterTitle = markdown.split(/^#\s+/m)[1] ?? markdown;
  const descBlock = afterTitle.replace(/^[^\n]+\n+/, "");
  const description = descBlock
    .replace(/^[^\n]+\n+/, "")
    .replace(/₹[\d,][^\n]*\n+/g, "")
    .replace(/^\d+(?:\.\d+)?\s*\n+/m, "")
    .replace(/^[\d.]+\s+reviews\s*\n+/im, "")
    .replace(/^Popular\s*\n+/im, "")
    .replace(/^Download brochure\s*\n+/im, "")
    .replace(/^View all \d+ photos\s*\n+/im, "")
    .split(/\n(?:Read more|##\s)/)[0]
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const address =
    firstMatch(markdown, /###\s+Address\s*\n+([^\n#]+)/i) ??
    (area ? `${area}, ${city}` : "");

  const images: string[] = [];
  const imgMd = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let im: RegExpExecArray | null;
  while ((im = imgMd.exec(markdown)) !== null) {
    if (!images.includes(im[1])) images.push(im[1]);
  }

  const amenities: string[] = [];
  const amenitySection = markdown.match(
    /###\s+Common amenities\s*\n+([\s\S]*?)(?=\n##\s|\n###\s+(?!Common)|$)/i,
  );
  if (amenitySection?.[1]) {
    for (const line of amenitySection[1].split("\n")) {
      const item = line.trim();
      if (!item || item.startsWith("#")) continue;
      if (/^(Paid Amenity|Premier|Amenities like)/i.test(item)) continue;
      if (item.length > 1 && item.length < 80 && !amenities.includes(item)) {
        amenities.push(item);
      }
    }
  }

  const coords = markdown.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  const lat = coords ? Number.parseFloat(coords[1]) : null;
  const lng = coords ? Number.parseFloat(coords[2]) : null;

  return {
    source: "myhq",
    sourceId,
    title,
    description,
    shortTeaser: teaser(description || title),
    address,
    area,
    city,
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
    amenities,
    images,
    pricingHint,
    propertyType: "Coworking",
    sourceUrl,
  };
}

async function discover(): Promise<DiscoveredListing[]> {
  const [mapped, indexPage] = await Promise.all([
    firecrawlMap(MYHQ_SEED_URL),
    firecrawlScrape(MYHQ_SEED_URL, { includeLinks: true }),
  ]);
  const fromIndex = extractLinksFromMarkdown(indexPage.markdown);
  return extractMyhqDetailUrls([...mapped, ...fromIndex, ...indexPage.links]).map((url) => ({
    sourceId: slugFromUrl(url)!,
    url,
  }));
}

export const myhqAdapter: SourceAdapter = {
  source: "myhq",
  discover,
  async fetchDetail(url): Promise<RawListing | null> {
    const { markdown } = await firecrawlScrape(url);
    return parseMyhqDetail(markdown, url);
  },
};
