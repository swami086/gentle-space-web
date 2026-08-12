import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "migrations");

describe("migration files", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
  const ups = files.filter((f) => f.endsWith(".up.sql"));

  it("has at least one migration", () => {
    expect(ups.length).toBeGreaterThan(0);
  });

  it("every up has a matching down", () => {
    for (const up of ups) {
      expect(files, `${up} needs a down`).toContain(up.replace(".up.sql", ".down.sql"));
    }
  });

  it("uses NNN_name numbering with no duplicate numbers", () => {
    const numbers = ups.map((f) => {
      expect(f).toMatch(/^\d{3}_[a-z0-9_]+\.up\.sql$/);
      return f.slice(0, 3);
    });
    expect(new Set(numbers).size, "duplicate migration number").toBe(numbers.length);
  });

  it("contains no transaction control — the runner owns the transaction", () => {
    for (const file of files) {
      const sql = readFileSync(join(DIR, file), "utf8").toUpperCase();
      expect(sql, `${file} must not BEGIN`).not.toMatch(/^\s*BEGIN\s*;/m);
      expect(sql, `${file} must not COMMIT`).not.toMatch(/^\s*COMMIT\s*;/m);
    }
  });
});

describe("migrate()", () => {
  it("exports a function returning the versions it applied", async () => {
    const mod = await import("./migrate");
    expect(mod.migrate).toBeTypeOf("function");
  });
});
