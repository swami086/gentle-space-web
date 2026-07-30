import { firecrawlScrape } from "../lib/firecrawl/client";
import { parseMyhqDetail } from "../lib/sync/sources/myhq";
import { parseCofyndDetail } from "../lib/sync/sources/cofynd";
import { parseGoFloatersDetail } from "../lib/sync/sources/gofloaters";
import { parseCoworkerDetail } from "../lib/sync/sources/coworker";

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

const targets = [
  {
    name: "myhq",
    url: "https://myhq.in/dedicated/coworking-space/wework-bellandur",
    parse: parseMyhqDetail,
  },
  {
    name: "cofynd",
    url: "https://cofynd.com/coworking/cowrks-residency-road",
    parse: parseCofyndDetail,
  },
  {
    name: "gofloaters",
    url: "https://gofloaters.com/office-space/gooffice-20028-open-desks-bellandur-bengaluru/",
    parse: parseGoFloatersDetail,
  },
  {
    name: "coworker",
    url: "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
    parse: parseCoworkerDetail,
  },
] as const;

async function main() {
  for (const target of targets) {
    console.log(`\n=== ${target.name} ${target.url} ===`);
    try {
      const { markdown } = await firecrawlScrape(target.url);
      console.log(`chars=${markdown.length}`);
      console.log("loose", pairs(markdown, LOOSE).slice(0, 5));
      console.log("strict", pairs(markdown, STRICT).slice(0, 5));
      console.log(
        "blr-ish",
        [...markdown.matchAll(/12\.\d{2,}|77\.\d{2,}/g)].slice(0, 15).map((m) => m[0]),
      );
      const parsed = target.parse(markdown, target.url);
      if (!parsed) {
        console.log("parser=null");
        continue;
      }
      const plausible =
        parsed.lat != null && parsed.lng != null
          ? inBlr(parsed.lat, parsed.lng)
          : false;
      console.log({
        title: parsed.title,
        area: parsed.area,
        lat: parsed.lat,
        lng: parsed.lng,
        plausibleBengaluru: plausible,
        poisonMap: parsed.lat != null && parsed.lng != null && !plausible,
      });
    } catch (err) {
      console.error(target.name, "FAILED", err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
