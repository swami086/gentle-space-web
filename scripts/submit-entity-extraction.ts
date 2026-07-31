import { listListings, listListingEntityHashes } from "../lib/db/listings";
import { buildEntityBatchJsonl } from "../lib/graph/batch-extract";
import { hashEmbeddingText, listingEmbeddingTextForHash } from "../lib/sync/content-hash";
import { createBatchPredictionJob, putGcsObject } from "../lib/vertex/batch";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parsePositiveLimit(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

async function main(): Promise<void> {
  const bucket = requiredEnv("VERTEX_BATCH_BUCKET");
  const stamp = isoStamp();
  const listings = await listListings();
  const entityHashes = await listListingEntityHashes();
  const stale = listings.filter((listing) => entityHashes.get(listing.id) !== hashEmbeddingText(listing));
  const limit = parsePositiveLimit(process.env.ENTITIES_SUBMIT_LIMIT);
  const selected = limit ? stale.slice(0, limit) : stale;

  if (selected.length === 0) {
    console.log("0 stale listings");
    return;
  }

  const inputObject = `entity-extract/${stamp}/input.jsonl`;
  await putGcsObject(
    bucket,
    inputObject,
    buildEntityBatchJsonl(selected.map((listing) => ({
      id: listing.id,
      text: listingEmbeddingTextForHash(listing),
    }))),
    "application/jsonl",
  );

  const job = await createBatchPredictionJob({
    displayName: `entity-extract-${stamp}`,
    inputUri: `gs://${bucket}/${inputObject}`,
    outputUriPrefix: `gs://${bucket}/entity-extract/${stamp}/out/`,
  });

  console.log(`submitted ${selected.length} stale listings: ${job.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
