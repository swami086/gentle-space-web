import assert from "node:assert/strict";
import { runListingsSync } from "../lib/sync/run-sync";
import { cofyndAdapter } from "../lib/sync/sources";

async function main() {
  const discovered = await cofyndAdapter.discover();
  const target = discovered.find((item) => item.sourceId !== "gurugram");
  assert.ok(target, "CoFynd discovery returned no usable listing");

  let detailCalls = 0;
  const oneListingAdapter = {
    ...cofyndAdapter,
    discover: async () => [target],
    fetchDetail: async (url: string) => {
      detailCalls++;
      return cofyndAdapter.fetchDetail(url);
    },
  };

  const first = await runListingsSync({
    adapters: [oneListingAdapter],
    maxDetailScrapes: 1,
    trackMissing: false,
    skipDownstream: true,
    ttlMs: 1,
  });
  assert.equal(first.status, "success");
  assert.equal(first.sources.cofynd?.scraped, 1);
  const afterFirst = detailCalls;

  const second = await runListingsSync({
    adapters: [oneListingAdapter],
    maxDetailScrapes: 1,
    trackMissing: false,
    skipDownstream: true,
  });
  assert.equal(second.status, "success");
  assert.equal(second.sources.cofynd?.scraped, 0);
  assert.equal(
    detailCalls,
    afterFirst,
    "second run unexpectedly scraped a detail page",
  );

  console.log(
    `incremental sync ok: ${target.sourceId}; first scraped=1, immediate second scraped=0`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
