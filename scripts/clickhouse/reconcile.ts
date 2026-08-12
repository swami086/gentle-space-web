import { runReconciliation } from "../../lib/clickhouse/reconcile";

function argValue(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const repeat = argValue("--repeat", 1);
  const intervalSeconds = argValue("--interval", 300);
  let allOk = true;
  for (let run = 1; run <= repeat; run += 1) {
    const ok = await runReconciliation();
    allOk = allOk && ok;
    if (run < repeat) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("reconcile: failed", err);
  process.exit(1);
});
