import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = [
  "070_corridors",
  "071_listing_corridors",
  "072_campaign_corridor_id",
  "073_enquiry_corridor_fk",
  "074_derived_attribution",
];

function read(name: string, dir: "up" | "down"): string {
  return readFileSync(join(__dirname, `${name}.${dir}.sql`), "utf8");
}

describe("attribution migrations exist in pairs", () => {
  it.each(MIGRATIONS)("%s has an up and a down", (name) => {
    const files = readdirSync(__dirname);
    expect(files).toContain(`${name}.up.sql`);
    expect(files).toContain(`${name}.down.sql`);
  });

  it("claims only migration numbers 070-079", () => {
    for (const name of MIGRATIONS) {
      const n = Number(name.slice(0, 3));
      expect(n).toBeGreaterThanOrEqual(70);
      expect(n).toBeLessThanOrEqual(79);
    }
  });
});

describe("attribution migrations obey the global constraints", () => {
  it.each(MIGRATIONS)("%s schema-qualifies every CREATE TABLE", (name) => {
    const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi;
    const sql = read(name, "up");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      expect(match[1], `unqualified CREATE TABLE target: ${match[1]}`).toMatch(/^\w+\./);
    }
  });

  it.each(MIGRATIONS)("%s never uses bare TIMESTAMP", (name) => {
    expect(read(name, "up")).not.toMatch(/\bTIMESTAMP\b(?!TZ)/i);
  });

  it.each(MIGRATIONS)("%s expresses schema changes as ALTER, not inside CREATE TABLE bodies", (name) => {
    const sql = read(name, "up");
    const touchesExisting = /adsagent\.(campaigns|enquiries)/i.test(sql);
    if (touchesExisting) expect(sql).toMatch(/ALTER\s+TABLE/i);
  });

  it("074 forces RLS with both USING and WITH CHECK on both derived tables", () => {
    const sql = read("074_derived_attribution", "up");
    for (const table of ["derived.corridor_attribution_daily", "derived.attribution_reconciliation"]) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE  ROW LEVEL SECURITY`);
    }
    expect(sql.match(/USING\s+\(org_id = public\.current_tenant\(\)\)/g)).toHaveLength(2);
    expect(sql.match(/WITH CHECK \(org_id = public\.current_tenant\(\)\)/g)).toHaveLength(2);
  });

  it("074 refuses to store a cost per enquiry for a corridor with no enquiries", () => {
    expect(read("074_derived_attribution", "up")).toContain(
      "CHECK ((enquiry_count = 0) = (cost_per_enquiry_inr IS NULL))",
    );
  });

  it("074 uses uuidv7 and org_id-leading indexes", () => {
    const sql = read("074_derived_attribution", "up");
    expect(sql).toContain("DEFAULT uuidv7()");
    expect(sql).toMatch(/CREATE INDEX[\s\S]*?\(org_id/);
  });

  it("070 seeds a vocabulary with no catch-all bucket", () => {
    const sql = read("070_corridors", "up");
    expect(sql).toMatch(/INSERT INTO public\.corridors/i);
    expect(sql).not.toMatch(/'(other|unknown|misc|uncategorised|uncategorized)'/i);
  });
});
