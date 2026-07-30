import { getBatchPredictionJob, getGcsObject, listGcsObjects } from "../lib/vertex/batch";
import { parseEntityBatchOutput } from "../lib/graph/batch-extract";
import { listListings, updateListingExtractedEntities } from "../lib/db/listings";
import { hashEmbeddingText } from "../lib/sync/content-hash";
import { rebuildListingGraph } from "../lib/graph/rebuild";

function requiredArg(index: number, name: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseGcsOutputDirectory(value: string): { bucket: string; prefix: string } {
  if (!value.startsWith("gs://")) throw new Error(`invalid gcsOutputDirectory: ${value}`);

  const withoutScheme = value.slice("gs://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex === -1) {
    return { bucket: withoutScheme, prefix: "" };
  }

  return {
    bucket: withoutScheme.slice(0, slashIndex),
    prefix: withoutScheme.slice(slashIndex + 1),
  };
}

async function main(): Promise<void> {
  const jobName = requiredArg(2, "job resource name");
  const job = await getBatchPredictionJob(jobName);

  if (job.state !== "JOB_STATE_SUCCEEDED") {
    console.log({ job: job.name, state: job.state });
    process.exit(1);
  }

  const outputDirectory = job.outputInfo?.gcsOutputDirectory;
  if (!outputDirectory) throw new Error("batch job missing outputInfo.gcsOutputDirectory");

  const { bucket, prefix } = parseGcsOutputDirectory(outputDirectory);
  const resultFiles = (await listGcsObjects(bucket, prefix)).filter((name) =>
    name.includes("prediction.results-"),
  );
  const contents = await Promise.all(resultFiles.map((object) => getGcsObject(bucket, object)));
  const { applied, failed, skipped } = parseEntityBatchOutput(contents);
  const listings = new Map((await listListings()).map((listing) => [listing.id, listing]));

  let wrote = 0;
  let unknown = 0;

  for (const [id, entities] of applied) {
    const listing = listings.get(id);
    if (!listing) {
      unknown += 1;
      continue;
    }

    await updateListingExtractedEntities(id, entities, hashEmbeddingText(listing));
    wrote += 1;
  }

  console.log({ wrote, failed, skipped, unknown, resultFiles: resultFiles.length });

  if (wrote === 0) {
    process.exit(1);
  }

  const rebuildResult = await rebuildListingGraph();
  console.log({ rebuild: rebuildResult });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
