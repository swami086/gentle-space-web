/**
 * Render Cron entrypoint — `npm run sync:listings`
 */
import { runListingsSync } from "../lib/sync/run-sync";

async function main(): Promise<void> {
  const run = await runListingsSync();
  if (run.status !== "success") {
    console.error(run.error ?? `sync ${run.status}`);
    process.exit(1);
  }
  console.log(`sync ok count=${run.count ?? 0}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
