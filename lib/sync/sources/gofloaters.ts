import { firecrawlMap, firecrawlScrape } from "@/lib/firecrawl/client";
import type { RawListing, SourceAdapter } from "./types";

export const GOFLOATERS_INDEX_URL = "https://gofloaters.com/office-spaces/bengaluru/";

const GOFLOATERS_HOST = "gofloaters.com";
const DETAIL_PATH = /^\/(?:coworking-space|office-space)\/(gooffice-\d+[^/?#]*)\/?$/i;
const LOCALITY_PATH = /^\/office-spaces\/bengaluru\/[^/]+\/?$/i;

function normalizeCity(city: string): string {
  const trimmed = city.trim();
  if (/^bangalore$/i.test(trimmed)) return "Bengaluru";
  return trimmed;
}

function normalizeDetailUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  let path = u.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/")) path += "/";
  u.pathname = path;
  return u.toString();
}

export function sourceIdFromGoFloatersUrl(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    if (!hostname.endsWith(GOFLOATERS_HOST)) return null;
    const match = pathname.match(DETAIL_PATH);
    if (!match) return null;
    const idMatch = match[1].match(/gooffice-\d+/i);
    return idMatch?.[0].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function isGoFloatersDetailUrl(url: string): boolean {
  return sourceIdFromGoFloatersUrl(url) !== null;
}

export function isGoFloatersLocalityUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (!hostname.endsWith(GOFLOATERS_HOST)) return false;
    if (pathname.replace(/\/+$/, "") === "/office-spaces/bengaluru") return false;
    return LOCALITY_PATH.test(pathname);
  } catch {
    return false;
  }
}

export function extractGoFloatersDetailUrls(links: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of links) {
    if (!isGoFloatersDetailUrl(link)) continue;
    const canonical = normalizeDetailUrl(link);
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

export function parseGoFloatersDetail(markdown: string, sourceUrl: string): RawListing | null {
  const sourceId = sourceIdFromGoFloatersUrl(sourceUrl);
  if (!sourceId) return null;

  const brand =
    firstMatch(markdown, /\[([^\]]+)\]\([^)]+\)\s*•\s*GoOffice\s+\d+/i) ??
    firstMatch(markdown, /GoOffice\s+\d+\s*:\s*([^:\n]+)/i);

  const headingMatch = markdown.match(/^#\s+(.+?)\s+in\s+([^,\n]+),\s*([^\n]+)$/m);
  const propertyTypeFromHeading = headingMatch?.[1]?.trim() ?? null;
  const areaFromHeading = headingMatch?.[2]?.trim() ?? "";
  const cityFromHeading = headingMatch?.[3] ? normalizeCity(headingMatch[3]) : "Bengaluru";

  const propertyType =
    propertyTypeFromHeading ??
    firstMatch(sourceUrl, /gooffice-\d+-([^-]+(?:-[^-]+)*?)-[a-z-]+-bengaluru/i)
      ?.split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") ??
    null;

  const title = brand
    ? propertyType
      ? `${brand} - ${propertyType}`
      : brand
    : (propertyType ?? sourceId.replace(/-/g, " "));

  const intro = firstMatch(
    markdown,
    /^#\s+[^\n]+\n+[\d.\s|Reviews\n]*\n+([^\n#][^\n]+)/m,
  );
  const overview = firstMatch(
    markdown,
    /####\s+[^\n]*Overview\s*\n+\s*GoOffice\s+\d+\s*:\s*([\s\S]*?)(?=\n####\s|\n###\s|$)/i,
  );
  const description = (overview ?? intro ?? "").replace(/\s+/g, " ").trim();

  const pricingHint =
    firstMatch(markdown, /(₹\s*[\d,]+(?:\s*\/\s*(?:day|month|seat|mo))?)/i) ??
    firstMatch(markdown, /Rs\.?\s*([\d,]+)\s*\/\s*day/i)?.replace(/^Rs\.?\s*/i, "₹");

  const address =
    firstMatch(markdown, /Landmark for this space is\s*:\s*([^\n]+)/i) ??
    firstMatch(markdown, /####\s+Direction\s*\n+[^\n]*\n+[^\n]*\n+([^\n]+)/i) ??
    (areaFromHeading ? `${areaFromHeading}, ${cityFromHeading}` : "");

  const images: string[] = [];
  const imgMd = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let im: RegExpExecArray | null;
  while ((im = imgMd.exec(markdown)) !== null) {
    if (im[1].includes("cdn.app.gofloaters.com") && !images.includes(im[1])) {
      images.push(im[1]);
    }
  }

  const amenities: string[] = [];
  const amenitySection = markdown.match(
    /####\s+What this place offers\s*\n+([\s\S]*?)(?=\n####\s|\nShow all|\n###\s|$)/i,
  );
  if (amenitySection?.[1]) {
    for (const line of amenitySection[1].split("\n")) {
      const item = line.trim();
      if (
        !item ||
        item.startsWith("#") ||
        /^show all/i.test(item) ||
        /^amenities like/i.test(item) ||
        item.length > 80
      ) {
        continue;
      }
      if (!amenities.includes(item)) amenities.push(item);
    }
  }

  const coords = markdown.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  const lat = coords ? Number.parseFloat(coords[1]) : null;
  const lng = coords ? Number.parseFloat(coords[2]) : null;

  return {
    source: "gofloaters",
    sourceId,
    title,
    description,
    shortTeaser: teaser(description || title),
    address,
    area: areaFromHeading,
    city: cityFromHeading,
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
    amenities,
    images,
    pricingHint,
    propertyType,
    sourceUrl: normalizeDetailUrl(sourceUrl),
  };
}

async function discoverDetailUrls(): Promise<string[]> {
  const mapped = await firecrawlMap(GOFLOATERS_INDEX_URL);
  const localityUrls = mapped.filter(isGoFloatersLocalityUrl);
  const linkSets: string[] = [...mapped];

  const [indexPage, ...localityPages] = await Promise.all([
    firecrawlScrape(GOFLOATERS_INDEX_URL),
    ...localityUrls.map((url) => firecrawlScrape(url)),
  ]);

  linkSets.push(...indexPage.links, ...extractLinksFromMarkdown(indexPage.markdown));
  for (const page of localityPages) {
    linkSets.push(...page.links, ...extractLinksFromMarkdown(page.markdown));
  }

  return extractGoFloatersDetailUrls(linkSets);
}

export const gofloatersAdapter: SourceAdapter = {
  source: "gofloaters",

  async fetchAll(): Promise<RawListing[]> {
    const detailUrls = await discoverDetailUrls();
    if (!detailUrls.length) {
      throw new Error("gofloaters: no detail URLs discovered from index");
    }

    const listings: RawListing[] = [];
    for (const url of detailUrls) {
      try {
        const { markdown } = await firecrawlScrape(url);
        const parsed = parseGoFloatersDetail(markdown, url);
        if (parsed) listings.push(parsed);
      } catch {
        // ponytail: skip failed detail scrapes; index failure still aborts above
      }
    }

    if (!listings.length) {
      throw new Error("gofloaters: scraped detail pages but parsed zero listings");
    }

    return listings;
  },
};
