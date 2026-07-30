/**
 * Local preview sync — Coworker only, capped scrape count.
 * Usage: npm run sync:preview
 *
 * Env: DATABASE_URL, FIRECRAWL_API_KEY (via .env.local + --env-file)
 */
import { randomUUID } from "crypto";
import { fullReplaceListings } from "../lib/db/listings";
import { finishSyncRun, startSyncRun } from "../lib/db/sync-runs";
import { firecrawlScrape } from "../lib/firecrawl/client";
import { dedupeListings } from "../lib/listings/dedupe";
import { slugifyTitle } from "../lib/listings/slug";
import type { Listing } from "../lib/listings/types";
import { rebuildListingGraph } from "../lib/graph/rebuild";
import {
  COWORKER_LIST_BASE,
  extractCoworkerDetailUrls,
  parseCoworkerDetail,
} from "../lib/sync/sources/coworker";

const MAX_DETAILS = Number(process.env.PREVIEW_MAX_DETAILS ?? "12");

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

async function main(): Promise<void> {
  const runId = randomUUID();
  await startSyncRun(runId);
  console.log(`preview sync start run=${runId} maxDetails=${MAX_DETAILS}`);

  try {
    console.log(`scraping list: ${COWORKER_LIST_BASE}`);
    const list = await firecrawlScrape(COWORKER_LIST_BASE);
    const detailUrls = extractCoworkerDetailUrls([
      ...list.links,
      ...extractLinksFromMarkdown(list.markdown),
    ]).slice(0, MAX_DETAILS);

    console.log(`discovered ${detailUrls.length} detail URLs (capped)`);
    if (detailUrls.length < 1) {
      throw new Error("no coworker detail URLs on first list page");
    }

    const raw = [];
    for (const [i, url] of detailUrls.entries()) {
      process.stdout.write(`  [${i + 1}/${detailUrls.length}] ${url} … `);
      try {
        const { markdown } = await firecrawlScrape(url);
        const parsed = parseCoworkerDetail(markdown, url);
        if (parsed) {
          raw.push(parsed);
          console.log("ok");
        } else {
          console.log("parse miss");
        }
      } catch (err) {
        console.log(`fail: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (raw.length < 1) {
      await finishSyncRun(runId, "failed", null, "preview: zero parsed listings");
      console.error("no listings parsed");
      process.exit(1);
    }

    const syncedAt = new Date().toISOString();
    const mapped: Listing[] = raw.map((r) => ({
      ...r,
      id: randomUUID(),
      slug: slugifyTitle(r.title, r.sourceId),
      syncedAt,
    }));
    const deduped = dedupeListings(mapped);
    await fullReplaceListings(deduped);
    try {
      const result = await rebuildListingGraph();
      if (!result.skipped) {
        console.log(`rebuilt graph for ${result.listings} listings`);
      }
    } catch (err) {
      console.error(`graph rebuild failed: ${err instanceof Error ? err.message : err}`);
    }
    await finishSyncRun(runId, "success", deduped.length, null);
    console.log(`preview sync ok count=${deduped.length}`);
    for (const row of deduped.slice(0, 5)) {
      console.log(`  - /spaces/${row.slug}  (${row.title})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(runId, "failed", null, msg).catch(() => undefined);
    console.error(msg);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
