/**
 * Batch-enrich weak listings via Firecrawl Extract.
 *
 * Usage:
 *   npm run enrich:listings              # dry-run (log only)
 *   npm run enrich:listings -- --apply   # write gated fields
 *   ENRICH_WEB_LIMIT=20 npm run enrich:listings -- --apply
 */
import { enrichListings } from "../lib/sync/enrich-listings";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required");

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const webLimitArg = args.find((a) => a.startsWith("--web-limit="));
  const webLimit = webLimitArg ? Number(webLimitArg.split("=")[1]) : undefined;

  const result = await enrichListings({
    dryRun: !apply,
    webLimit: Number.isFinite(webLimit) ? webLimit : undefined,
  });
  console.log(
    `enrich ${apply ? "apply" : "dry-run"}: scanned=${result.scanned} queued=${result.queued} pageAccepted=${result.pageAccepted} webAccepted=${result.webAccepted} skippedCooldown=${result.skippedCooldown}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
