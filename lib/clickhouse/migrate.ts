import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chExec, chQuery, clickhouseConfig, type ClickHouseConfig } from "./client";

export const DEFAULT_MIGRATIONS_DIR = path.join(process.cwd(), "infra/clickhouse/migrations");

export function versionOf(file: string): string {
  return file.slice(0, 3);
}

export function selectMigrations(files: string[], target: "local" | "cloud"): string[] {
  const wrongVariant = target === "local" ? ".cloud.up.sql" : ".local.up.sql";
  return files
    .filter((f) => f.endsWith(".up.sql") && !f.endsWith(wrongVariant))
    .sort();
}

// ponytail: naive `;` split. Safe because no statement in infra/clickhouse/migrations
// contains a semicolon inside a string literal. If one ever needs to, switch to a
// tokenising splitter rather than escaping around this.
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function substituteEnv(sql: string, env: NodeJS.ProcessEnv = process.env): string {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = env[name];
    if (!value) throw new Error(`clickhouse migration requires ${name} but it is not set`);
    return value;
  });
}

export async function applyMigrations(
  options: { dir?: string; config?: ClickHouseConfig } = {},
): Promise<string[]> {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const config = options.config ?? clickhouseConfig();

  await chExec(
    `CREATE TABLE IF NOT EXISTS default._ch_migrations (
       version String, file String, applied_at DateTime64(3) DEFAULT now64(3)
     ) ENGINE = ReplacingMergeTree(applied_at) ORDER BY version`,
    { config },
  );

  const applied = new Set(
    (await chQuery<{ version: string }>(
      "SELECT version FROM default._ch_migrations FINAL",
      { config },
    )).map((row) => row.version),
  );

  const newlyApplied: string[] = [];
  for (const file of selectMigrations(readdirSync(dir), config.target)) {
    const version = versionOf(file);
    if (applied.has(version)) continue;
    const sql = substituteEnv(readFileSync(path.join(dir, file), "utf-8"));
    for (const statement of splitStatements(sql)) {
      await chExec(statement, { config });
    }
    await chExec(
      `INSERT INTO default._ch_migrations (version, file) VALUES ({version:String}, {file:String})`,
      { config, params: { version, file } },
    );
    newlyApplied.push(version);
  }
  return newlyApplied;
}
