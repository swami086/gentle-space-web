import { embedAllListings } from "../lib/sync/embed-listings";
import { rebuildListingGraph } from "../lib/graph/rebuild";

async function main(): Promise<void> {
  const n = await embedAllListings();
  console.log(`embedded ${n} listings`);

  try {
    const result = await rebuildListingGraph();
    if (!result.skipped) {
      console.log(`rebuilt graph for ${result.listings} listings`);
    }
  } catch (err) {
    console.error(`graph rebuild failed: ${err instanceof Error ? err.message : err}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
