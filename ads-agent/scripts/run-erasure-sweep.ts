/**
 * Hard-erases every deletion request whose retention floor has passed.
 * Deliberately not registered as an npm script: it is run from cron or by hand,
 * and keeping it out of package.json meant no second agent in its wave had to
 * touch that file.
 *
 *   npx tsx --env-file=.env.local scripts/run-erasure-sweep.ts
 */
import { runErasureSweep } from "../lib/db/erasure";

runErasureSweep()
  .then((result) => {
    console.log(`erasure sweep: ${result.erased} request(s) erased`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("erasure sweep failed", err);
    process.exit(1);
  });
