import { applyMigrations } from "../../lib/clickhouse/migrate";

async function main(): Promise<void> {
  const applied = await applyMigrations();
  console.log(applied.length === 0 ? "clickhouse: up to date" : `clickhouse: applied ${applied.join(", ")}`);
}

main().catch((err) => {
  console.error("clickhouse: migration failed", err);
  process.exit(1);
});
