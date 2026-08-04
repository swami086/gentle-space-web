import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./client";

export async function migrate(): Promise<void> {
  const schemaPath = path.join(process.cwd(), "lib/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  await getPool().query(sql);
}

async function main(): Promise<void> {
  await migrate();
  console.log("auth-service: schema applied");
}

main().catch((err) => {
  console.error("auth-service: migration failed", err);
  process.exit(1);
});
