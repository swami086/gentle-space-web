/**
 * Run the `enrichListings` orchestrator from the CLI.
 *
 * Usage:
 *   npm run enrich:listings
 *   npm run enrich:listings -- --dry-run --web-limit=50 --cooldown-days=3
 *
 * Env knobs (see README): ENRICH_DISABLED, ENRICH_WEB_LIMIT, ENRICH_COOLDOWN_DAYS
 */
import { enrichListings } from "../lib/sync/enrich-listings";

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const [, raw] = a.split("--");
    if (!raw) continue;
    const [k, v] = raw.split("=");
    const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = v === undefined ? true : v;
  }
  return out;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const args = parseArgs();
  const options: {
    dryRun?: boolean;
    webLimit?: number;
    cooldownDays?: number;
  } = {};

  if (args.dryRun) options.dryRun = args.dryRun === true || args.dryRun === "true";
  if (args.webLimit) options.webLimit = Number(args.webLimit);
  if (args.cooldownDays) options.cooldownDays = Number(args.cooldownDays);

  const result = await enrichListings(options);
  console.log(
    `enrich done: scanned=${result.scanned} queued=${result.queued} ` +
      `pageAccepted=${result.pageAccepted} webAccepted=${result.webAccepted} skippedCooldown=${result.skippedCooldown}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

