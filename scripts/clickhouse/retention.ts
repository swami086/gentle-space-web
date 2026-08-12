import { dropExpiredPartitions } from "../../lib/clickhouse/retention";

async function main(): Promise<void> {
  const dropped = await dropExpiredPartitions();
  console.log(dropped.length === 0 ? "retention: nothing expired" : `retention: dropped ${dropped.join(", ")}`);
}

main().catch((err) => {
  console.error("retention: failed", err);
  process.exit(1);
});
