import { replicateEnquiries } from "../../lib/clickhouse/replicate";

async function main(): Promise<void> {
  const result = await replicateEnquiries();
  console.log(`cdc: ${result.table} -> analytics.enquiry_fact, ${result.rowsCopied} rows, watermark ${result.watermark}`);
}

main().catch((err) => {
  console.error("cdc: replication failed", err);
  process.exit(1);
});
