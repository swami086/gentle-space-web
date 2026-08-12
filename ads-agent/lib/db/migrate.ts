import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./client";
import { applyMigrations, rollbackLast } from "./migration-runner";

const MIGRATIONS_DIR = path.join(process.cwd(), "lib/db/migrations");

/**
 * Applies legacy schema bootstrap (if present) then every numbered migration not
 * already recorded in public.schema_migrations.
 */
export async function migrate(): Promise<string[]> {
  const schemaPath = path.join(process.cwd(), "lib/db/schema.sql");
  if (existsSync(schemaPath)) {
    await getPool().query(readFileSync(schemaPath, "utf-8"));
  }
  return applyMigrations(getPool(), MIGRATIONS_DIR);
}

async function main(): Promise<void> {
  if (process.argv.includes("--down")) {
    const rolled = await rollbackLast(getPool(), MIGRATIONS_DIR);
    console.log(rolled ? `ads-agent: rolled back ${rolled}` : "ads-agent: nothing to roll back");
    return;
  }
  const applied = await migrate();
  console.log(
    applied.length > 0
      ? `ads-agent: schema applied, migrations: ${applied.join(", ")}`
      : "ads-agent: schema applied, no pending migrations",
  );
}

// ponytail: skip CLI when vitest dynamic-imports this module
if (process.argv[1]?.endsWith("migrate.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("ads-agent: migration failed", err);
      process.exit(1);
    });
}
