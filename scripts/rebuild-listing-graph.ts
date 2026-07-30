import { rebuildListingGraph } from "../lib/graph/rebuild";

rebuildListingGraph()
  .then((result) => {
    console.log(result.skipped ? "graph rebuild skipped" : `graph rebuilt for ${result.listings} listings`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
