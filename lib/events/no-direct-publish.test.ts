import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Datastore spec §14.1: publish through the database, never directly. The rule
// is only real if a test enforces it — a comment does not survive a hurried
// afternoon.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWED = new Set([
  "ads-agent/lib/events/publisher.ts",
  "ads-agent/scripts/bootstrap-pubsub-emulator.ts", // creates topics; never publishes domain events
  "ads-agent/lib/events/publisher.emulator.db.test.ts", // subscribes to assert the boundary works
  "lib/events/no-direct-publish.test.ts",
]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "coverage", ".turbo"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (SOURCE.test(entry)) acc.push(full);
  }
  return acc;
}

describe("the Pub/Sub client has exactly one importer", () => {
  it("is only imported by the publisher boundary", () => {
    const offenders = sourceFiles(REPO_ROOT)
      .filter((file) => /@google-cloud\/pubsub/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file))
      .filter((rel) => !ALLOWED.has(rel))
      .sort();

    expect(offenders).toEqual([]);
  });

  it("has an allowlist that still points at real files", () => {
    for (const allowed of ALLOWED) {
      expect(() => statSync(path.join(REPO_ROOT, allowed)), `${allowed} is allowlisted but missing`).not.toThrow();
    }
  });
});
