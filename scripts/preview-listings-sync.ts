/**
 * Local preview sync — Coworker only, capped scrape count.
 * Usage: npm run sync:preview
 *
 * Env: DATABASE_URL, FIRECRAWL_API_KEY (via .env.local + --env-file)
 */
import { runListingsSync } from "../lib/sync/run-sync";
import { coworkerAdapter } from "../lib/sync/sources";

const maxDetailScrapes = Number(process.env.PREVIEW_MAX_DETAILS ?? "12");

runListingsSync({ adapters: [coworkerAdapter], maxDetailScrapes })
  .then((run) => {
    const result = run.sources.coworker;
    console.log(
      `preview ${run.status} discovered=${result?.discovered ?? 0} ` +
        `scraped=${result?.scraped ?? 0} inserted=${result?.inserted ?? 0} ` +
        `updated=${result?.updated ?? 0}`,
    );
    process.exit(run.status === "success" ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
