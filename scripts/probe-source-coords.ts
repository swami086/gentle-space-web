// One-shot probe: scrape 1 detail page per unused source and report coord quality.
// Does not write to the database.
import { firecrawlMap, firecrawlScrape } from "../lib/firecrawl/client";
import { extractMyhqDetailUrls, parseMyhqDetail, MYHQ_SEED_URL } from "../lib/sync/sources/myhq";
import {
  extractCofyndDetailUrls,
  parseCofyndDetail,
  COFYND_INDEX_URL,
} from "../lib/sync/sources/cofynd";
import {
  extractGoFloatersDetailUrls,
  parseGoFloatersDetail,
  GOFLOATERS_INDEX_URL,
} from "../lib/sync/sources/gofloaters";

const LOOSE = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/g;
const STRICT = /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/g;

function inBlr(lat: number, lng: number) {
  return lat >= 12.7 && lat <= 13.3 && lng >= 77.3 && lng <= 77.9;
}

function pairs(markdown: string, re: RegExp) {
  return [...markdown.matchAll(re)].map((m) => ({
    lat: Number.parseFloat(m[1]),
    lng: Number.parseFloat(m[2]),
    match: m[0],
  }));
}

function mdLinks(markdown: string): string[] {
  const urls = new Set<string>();
  const md = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  const bare = /https?:\/\/[^\s)\]"']+/g;
  let m: RegExpExecArray | null;
  while ((m = md.exec(markdown)) !== null) urls.add(m[2]);
  while ((m = bare.exec(markdown)) !== null) urls.add(m[0].replace(/[.,;]+$/, ""));
  return [...urls];
}

type Source = {
  name: string;
  seed: string;
  discover: (mapLinks: string[], indexMarkdown: string, indexLinks: string[]) => string[];
  parse: (
    markdown: string,
    url: string,
  ) => { title: string; lat: number | null; lng: number | null } | null;
};

const sources: Source[] = [
  {
    name: "myhq",
    seed: MYHQ_SEED_URL,
    discover: (mapLinks, md, links) =>
      extractMyhqDetailUrls([...mapLinks, ...links, ...mdLinks(md)]),
    parse: parseMyhqDetail,
  },
  {
    name: "cofynd",
    seed: COFYND_INDEX_URL,
    discover: (mapLinks, md, links) =>
      extractCofyndDetailUrls([...mapLinks, ...links, ...mdLinks(md)]),
    parse: parseCofyndDetail,
  },
  {
    name: "gofloaters",
    seed: GOFLOATERS_INDEX_URL,
    discover: (mapLinks, md, links) =>
      extractGoFloatersDetailUrls([...mapLinks, ...links, ...mdLinks(md)]),
    parse: parseGoFloatersDetail,
  },
];

async function run(source: Source) {
  console.log(`\n=== ${source.name} ===`);
  const [mapLinks, index] = await Promise.all([
    firecrawlMap(source.seed),
    firecrawlScrape(source.seed),
  ]);
  const details = source.discover(mapLinks, index.markdown, index.links);
  console.log(`discovered=${details.length} map=${mapLinks.length}`);
  if (details.length === 0) {
    console.log("ABORT: zero detail urls");
    return;
  }
  const url = details[0];
  console.log(`detail=${url}`);
  const { markdown } = await firecrawlScrape(url);
  console.log(`markdownChars=${markdown.length}`);
  console.log("loose", pairs(markdown, LOOSE).slice(0, 8));
  console.log("strict", pairs(markdown, STRICT).slice(0, 8));
  const parsed = source.parse(markdown, url);
  if (!parsed) {
    console.log("parser=null");
    return;
  }
  const plausible =
    parsed.lat != null && parsed.lng != null
      ? inBlr(parsed.lat, parsed.lng)
      : false;
  console.log({
    title: parsed.title,
    lat: parsed.lat,
    lng: parsed.lng,
    plausibleBengaluru: plausible,
    poisonMap: parsed.lat != null && parsed.lng != null && !plausible,
  });
}

async function main() {
  for (const source of sources) {
    try {
      await run(source);
    } catch (err) {
      console.error(`${source.name} FAILED:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
