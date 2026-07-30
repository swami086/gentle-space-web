import { firecrawlMap } from "../lib/firecrawl/client";

async function main() {
  for (const seed of [
    "https://myhq.in/bangalore",
    "https://cofynd.com/coworking/bangalore",
    "https://gofloaters.com/office-spaces/bengaluru/",
  ]) {
    const links = await firecrawlMap(seed);
    console.log(`\n=== ${seed} count=${links.length} ===`);
    const prefixes = new Map<string, number>();
    for (const link of links) {
      try {
        const u = new URL(link);
        const parts = u.pathname.split("/").filter(Boolean).slice(0, 3);
        const key = `${u.hostname}/${parts.join("/")}`;
        prefixes.set(key, (prefixes.get(key) ?? 0) + 1);
      } catch {
        // ignore
      }
    }
    console.log(
      [...prefixes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, v]) => `${v}\t${k}`)
        .join("\n"),
    );
    console.log("--- sample ---");
    console.log(links.slice(0, 12).join("\n"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
