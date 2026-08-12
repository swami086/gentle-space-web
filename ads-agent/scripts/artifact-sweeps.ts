import { danglingSweep, orphanSweep } from "../lib/artifacts/sweeps";

/**
 * Cron entry point. Connect as context_maintenance: both sweeps read every
 * tenant, which is what the named cross-tenant policies in migrations 080-082
 * permit without granting BYPASSRLS.
 */
async function main(): Promise<void> {
  const orphan = await orphanSweep();
  console.log(
    `orphan sweep: scanned=${orphan.scanned} deleted=${orphan.deleted.length} ` +
      `skippedYoung=${orphan.skippedYoung}`,
  );

  const dangling = await danglingSweep();
  const unexplained = dangling.filter((f) => f.classification === "unexplained");
  console.log(`dangling sweep: flagged=${dangling.length} unexplained=${unexplained.length}`);

  // Only unexplained danglers are a signal. mid_erasure ones are the expected
  // residue of the bytes-first erasure order.
  if (unexplained.length > 0) {
    console.error("UNEXPLAINED DANGLING ARTIFACTS", unexplained);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("artifact sweeps failed", err);
  process.exit(1);
});
