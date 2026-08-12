/**
 * The gate for Task 24. Exits 0 only when every org has its own active Twenty
 * instance that is not the contaminated shared one. Until then the interim
 * platform-only guard stays in the client.
 *
 *   npx tsx --env-file=.env.local scripts/check-twenty-coverage.ts
 */
import { orgsWithoutOwnInstance } from "../lib/db/twenty-connections";

async function main(): Promise<void> {
  const shared = process.env.SHARED_TWENTY_BASE_URL?.trim();
  if (!shared) throw new Error("check-twenty-coverage: SHARED_TWENTY_BASE_URL is not set");

  const gaps = await orgsWithoutOwnInstance(shared);
  if (gaps.length === 0) {
    console.log("twenty coverage: every org has its own active instance");
    return;
  }
  console.error(`twenty coverage: ${gaps.length} org(s) not yet covered`);
  for (const gap of gaps) console.error(`  ${gap.orgId}: ${gap.reason}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("check-twenty-coverage failed", err);
  process.exit(1);
});
