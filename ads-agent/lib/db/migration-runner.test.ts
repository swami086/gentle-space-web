import { describe, expect, it } from "vitest";
import { pendingMigrations, stripOuterTransaction } from "./migration-runner";

describe("stripOuterTransaction", () => {
  it("removes a leading BEGIN and trailing COMMIT so the runner owns the transaction", () => {
    const sql = "BEGIN;\nALTER TABLE public.users ADD COLUMN x TEXT;\nCOMMIT;\n";
    expect(stripOuterTransaction(sql)).toBe("ALTER TABLE public.users ADD COLUMN x TEXT;");
  });

  it("leaves a file with no outer transaction untouched", () => {
    expect(stripOuterTransaction("CREATE INDEX i ON t (c);")).toBe("CREATE INDEX i ON t (c);");
  });

  it("does not strip an inner COMMIT that is not at the end", () => {
    const sql = "BEGIN;\nDO $$ BEGIN COMMIT; END $$;\nSELECT 1;\nCOMMIT;";
    expect(stripOuterTransaction(sql)).toBe("DO $$ BEGIN COMMIT; END $$;\nSELECT 1;");
  });
});

describe("pendingMigrations", () => {
  it("returns unapplied up-migrations in numeric order and ignores down files", () => {
    const files = [
      "021_enquiries.up.sql",
      "021_enquiries.down.sql",
      "020_contacts.up.sql",
      "020_contacts.down.sql",
    ];
    expect(pendingMigrations(files, ["020_contacts"])).toEqual(["021_enquiries"]);
  });

  it("returns an empty list when everything is applied", () => {
    expect(pendingMigrations(["020_contacts.up.sql"], ["020_contacts"])).toEqual([]);
  });
});
