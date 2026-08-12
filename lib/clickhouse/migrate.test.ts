import { describe, it, expect } from "vitest";
import { selectMigrations, splitStatements, substituteEnv, versionOf } from "./migrate";

describe("selectMigrations", () => {
  const files = [
    "000_databases.up.sql",
    "000_databases.down.sql",
    "003_portal_event_ingest.local.up.sql",
    "003_portal_event_ingest.cloud.up.sql",
    "004_portal_event_mv.up.sql",
  ];

  it("keeps only up files and the variant matching the target", () => {
    expect(selectMigrations(files, "local")).toEqual([
      "000_databases.up.sql",
      "003_portal_event_ingest.local.up.sql",
      "004_portal_event_mv.up.sql",
    ]);
    expect(selectMigrations(files, "cloud")).toEqual([
      "000_databases.up.sql",
      "003_portal_event_ingest.cloud.up.sql",
      "004_portal_event_mv.up.sql",
    ]);
  });
});

describe("splitStatements", () => {
  it("drops comment lines and splits on semicolons", () => {
    const sql = `-- a comment\nCREATE DATABASE a;\n\n-- another\nCREATE DATABASE b;\n`;
    expect(splitStatements(sql)).toEqual(["CREATE DATABASE a", "CREATE DATABASE b"]);
  });
});

describe("substituteEnv", () => {
  it("substitutes present variables", () => {
    expect(substituteEnv("KEY ${A} SECRET ${B}", { A: "one", B: "two" })).toBe("KEY one SECRET two");
  });

  it("throws naming the missing variable rather than emitting an empty credential", () => {
    expect(() => substituteEnv("KEY ${GCS_HMAC_ACCESS_ID}", {})).toThrow("GCS_HMAC_ACCESS_ID");
  });
});

describe("versionOf", () => {
  it("takes the numeric prefix", () => {
    expect(versionOf("003_portal_event_ingest.local.up.sql")).toBe("003");
  });
});
