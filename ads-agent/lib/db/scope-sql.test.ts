import { describe, expect, it } from "vitest";
import { scopeClause, type Scope } from "./scope-sql";

const ORG: Scope = { kind: "org", orgId: "11111111-1111-1111-1111-111111111111" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

describe("scopeClause", () => {
  it("constrains org scope to its own org_id", () => {
    expect(scopeClause(ORG)).toEqual({
      sql: "org_id = $1::uuid",
      params: ["11111111-1111-1111-1111-111111111111"],
    });
  });

  it("lets platform scope through without constraining org_id", () => {
    const clause = scopeClause(PLATFORM);
    expect(clause.sql).not.toContain("org_id");
    expect(clause.params).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });

  it("honours a custom column name", () => {
    expect(scopeClause(ORG, "d.org_id").sql).toBe("d.org_id = $1::uuid");
  });

  it("consumes exactly one placeholder in both branches, so caller numbering is stable", () => {
    for (const scope of [ORG, PLATFORM]) {
      const clause = scopeClause(scope);
      expect(clause.params, `${scope.kind} must supply one param`).toHaveLength(1);
      expect(clause.sql).toContain("$1");
      expect(clause.sql).not.toContain("$2");
    }
  });
});
