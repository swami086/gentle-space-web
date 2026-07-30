import { firecrawlMap, firecrawlScrape } from "../lib/firecrawl/client";
import { extractMyhqDetailUrls, isMyhqDetailUrl } from "../lib/sync/sources/myhq";
import {
  extractCofyndDetailUrls,
  COFYND_INDEX_URL,
} from "../lib/sync/sources/cofynd";
import {
  extractGoFloatersDetailUrls,
  isGoFloatersLocalityUrl,
} from "../lib/sync/sources/gofloaters";

function mdLinks(markdown: string): string[] {
  const urls = new Set<string>();
  for (const match of markdown.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
    urls.add(match[2]);
  }
  for (const match of markdown.matchAll(/https?:\/\/[^\s)\]"']+/g)) {
    urls.add(match[0].replace(/[.,;]+$/, ""));
  }
  return [...urls];
}

async function main() {
  {
    const [mapLinks, index] = await Promise.all([
      firecrawlMap(COFYND_INDEX_URL),
      firecrawlScrape(COFYND_INDEX_URL),
    ]);
    const all = [...mapLinks, ...index.links, ...mdLinks(index.markdown)];
    const details = extractCofyndDetailUrls(all);
    console.log("\n=== cofynd detail candidates ===");
    console.log(details.slice(0, 25).join("\n"));
    console.log(`total=${details.length}`);
    const bangaloreLocalities = all.filter((u) =>
      /cofynd\.com\/coworking\/bangalore\/[a-z0-9-]+\/?$/i.test(u),
    );
    console.log(`bangalore locality urls in raw pool: ${bangaloreLocalities.length}`);
    console.log(bangaloreLocalities.slice(0, 8).join("\n"));
  }

  {
    const locality = "https://myhq.in/bangalore/dedicated/coworking-space-in-bellandur";
    console.log(`\n=== myhq locality hop ===`);
    const page = await firecrawlScrape(locality);
    const all = [...page.links, ...mdLinks(page.markdown)];
    console.log(`links=${all.length} markdownChars=${page.markdown.length}`);
    console.log(`extractMyhqDetailUrls=${extractMyhqDetailUrls(all).length}`);
    console.log(extractMyhqDetailUrls(all).slice(0, 10).join("\n"));
    const prefixes = new Map<string, number>();
    for (const link of all) {
      try {
        const u = new URL(link);
        if (!u.hostname.includes("myhq")) continue;
        const key = u.pathname.split("/").filter(Boolean).slice(0, 4).join("/");
        prefixes.set(key, (prefixes.get(key) ?? 0) + 1);
      } catch {
        // ignore bad urls
      }
    }
    console.log(
      [...prefixes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([k, v]) => `${v}\t${k}`)
        .join("\n"),
    );
    console.log("isMyhqDetailUrl hits:", all.filter(isMyhqDetailUrl).slice(0, 5));
  }

  {
    const locality = "https://gofloaters.com/office-spaces/bengaluru/bellandur/";
    console.log(`\n=== gofloaters locality hop ===`);
    const page = await firecrawlScrape(locality);
    const all = [...page.links, ...mdLinks(page.markdown)];
    const details = extractGoFloatersDetailUrls(all);
    console.log(
      `details=${details.length} localitiesInPool=${all.filter(isGoFloatersLocalityUrl).length}`,
    );
    console.log(details.slice(0, 5).join("\n"));
    if (details[0]) {
      const detail = await firecrawlScrape(details[0]);
      console.log("detail", details[0], "chars", detail.markdown.length);
      console.log(
        "latHints",
        [...detail.markdown.matchAll(/lat(?:itude)?["\s:=]+(-?\d+\.?\d*)/gi)]
          .slice(0, 5)
          .map((m) => m[0]),
      );
      console.log(
        "maps",
        [...detail.markdown.matchAll(/maps\.google[^)\s"']+|google\.com\/maps[^)\s"']+/gi)]
          .slice(0, 5)
          .map((m) => m[0]),
      );
      console.log(
        "blr-ish",
        [...detail.markdown.matchAll(/12\.\d{2,}|77\.\d{2,}/g)].slice(0, 20).map((m) => m[0]),
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
