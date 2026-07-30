/**
 * Render Cron entrypoint — `npm run sync:listings`
 */
import { runListingsSync } from "../lib/sync/run-sync";

async function main(): Promise<void> {
  const run = await runListingsSync();
  const summary = Object.entries(run.sources)
    .map(([source, result]) => `${source}:${result?.status}`)
    .join(" ");
  if (run.status !== "success") {
    console.error(run.error ?? `sync ${run.status}`);
    process.exit(1);
  }
  console.log(`sync ${run.status} count=${run.count ?? 0} ${summary}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
