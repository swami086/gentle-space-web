import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two Next apps with separate module graphs each own a capture path. They are
 * allowed to be separate files; they are not allowed to drift. This asserts
 * both insert into the same four tables.
 */
const TABLES = [
  "adsagent.contacts",
  "adsagent.enquiries",
  "adsagent.enquiry_messages",
  "adsagent.enquiry_requirement_revisions",
];

describe("both capture paths write the same tables", () => {
  const site = readFileSync(join(__dirname, "capture.ts"), "utf8");
  const admin = readFileSync(
    join(__dirname, "..", "..", "ads-agent", "app", "api", "enquiries", "route.ts"),
    "utf8",
  );
  const adminDataLayer = ["contacts", "enquiries", "enquiry-messages", "enquiry-requirements"]
    .map((m) => readFileSync(join(__dirname, "..", "..", "ads-agent", "lib", "db", `${m}.ts`), "utf8"))
    .join("\n");

  it.each(TABLES)("the marketing site inserts into %s", (table) => {
    expect(site).toContain(`INSERT INTO ${table}`);
  });

  it.each(TABLES)("the admin path reaches %s through its data layer", (table) => {
    expect(adminDataLayer).toContain(`INSERT INTO ${table}`);
  });

  it("neither capture path imports a CRM client", () => {
    expect(site).not.toMatch(/from\s+["'][^"']*crm\//);
    expect(admin).not.toMatch(/from\s+["'][^"']*crm\//);
  });
});
