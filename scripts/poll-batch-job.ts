import { getBatchPredictionJob } from "../lib/vertex/batch";

const name = process.argv[2];
if (!name) {
  console.error("usage: poll-batch-job <job-resource-name>");
  process.exit(1);
}

async function main() {
  for (let i = 0; i < 60; i++) {
    const job = await getBatchPredictionJob(name);
    console.log(new Date().toISOString(), job.state, job.outputInfo?.gcsOutputDirectory ?? "");
    if (
      job.state === "JOB_STATE_SUCCEEDED" ||
      job.state === "JOB_STATE_FAILED" ||
      job.state === "JOB_STATE_CANCELLED" ||
      job.state === "JOB_STATE_EXPIRED"
    ) {
      console.log(JSON.stringify(job, null, 2));
      if (job.state !== "JOB_STATE_SUCCEEDED") process.exit(1);
      return;
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  console.error("timed out waiting for job");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
