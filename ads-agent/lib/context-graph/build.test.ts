import { describe, it, expect, vi, beforeEach } from "vitest";
import { NODE_KINDS, RELATIONSHIP_KINDS, graphBuildStatements } from "./build";

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";

describe("graph coverage", () => {
  it("builds the eight node kinds whose source data exists", () => {
    expect([...NODE_KINDS]).toEqual([
      "Space",
      "Corridor",
      "Person",
      "Enquiry",
      "Requirement",
      "Campaign",
      "Call",
      "Outcome",
    ]);
  });

  it("builds the nine relationships whose source data exists", () => {
    expect([...RELATIONSHIP_KINDS]).toEqual([
      "PART_OF",
      "LOCATED_IN",
      "ENQUIRED_ABOUT",
      "HAS_REQUIREMENT",
      "TARGETS",
      "GENERATED",
      "ABOUT",
      "RESULTED_IN",
      "SIMILAR_TO",
    ]);
  });

  it("excludes POI/NEAR and Organisation/WORKS_FOR, which have no defined source", () => {
    expect(NODE_KINDS).not.toContain("POI");
    expect(NODE_KINDS).not.toContain("Organisation");
    expect(RELATIONSHIP_KINDS).not.toContain("NEAR");
    expect(RELATIONSHIP_KINDS).not.toContain("WORKS_FOR");
  });
});

describe("graphBuildStatements", () => {
  const statements = graphBuildStatements(ORG, SNAP);

  it("emits one statement per node kind plus one per non-similarity edge kind", () => {
    // SIMILAR_TO is written by buildSimilarityEdges, which reads Postgres.
    expect(statements).toHaveLength(NODE_KINDS.length + RELATIONSHIP_KINDS.length - 1);
  });

  it("scopes every statement to the tenant and the snapshot", () => {
    for (const sql of statements) {
      expect(sql, sql.slice(0, 90)).toContain(`toUUID('${ORG}')`);
      expect(sql, sql.slice(0, 90)).toContain(`toUUID('${SNAP}')`);
      expect(sql, sql.slice(0, 90)).toMatch(/WHERE org_id = toUUID/);
    }
  });

  it("writes only into the graph tables, never into a mirror table", () => {
    for (const sql of statements) {
      expect(sql.trimStart()).toMatch(/^INSERT INTO gentle_space\.graph_(node|edge)/);
    }
  });

  it("carries subject provenance on every person-derived node", () => {
    const person = statements.find((s) => s.includes("'Person'"))!;
    const enquiry = statements.find((s) => s.includes("'Enquiry'"))!;
    expect(person).toContain("subject_ref");
    expect(person).toContain("toString(id)");
    expect(enquiry).toContain("toString(contact_id)");
  });

  it("names a corridor hierarchy edge as PART_OF between two corridors", () => {
    const partOf = statements.find((s) => s.includes("'PART_OF'"))!;
    expect(partOf).toContain("'Corridor', 'PART_OF'");
    expect(partOf).toContain("parent_id");
  });

  it("gives GENERATED a confidence, because attribution is inferred", () => {
    const generated = statements.find((s) => s.includes("'GENERATED'"))!;
    expect(generated).toMatch(/0\.5/);
  });
});

describe("buildSimilarityEdges", () => {
  const chCommand = vi.fn();
  const query = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    chCommand.mockReset();
    query.mockReset();
    vi.doMock("./clickhouse", () => ({ chCommand, chQuery: vi.fn() }));
    vi.doMock("../db/client", () => ({ getPool: () => ({ query }) }));
  });

  it("computes similarity in Postgres and ships only the pairs to ClickHouse", async () => {
    query.mockResolvedValue({
      rows: [
        {
          source_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          target_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          weight: 0.91,
        },
      ],
    });
    const { buildSimilarityEdges } = await import("./build");
    await expect(buildSimilarityEdges(ORG, SNAP)).resolves.toBe(1);

    // The cosine operator runs in Postgres; no vector leaves it.
    expect(String(query.mock.calls[0][0])).toContain("<=>");
    expect(chCommand.mock.calls[0][0]).toContain("'SIMILAR_TO'");
    expect(chCommand.mock.calls[0][0]).not.toContain("embedding");
  });

  it("writes nothing when a tenant has no similar pairs", async () => {
    query.mockResolvedValue({ rows: [] });
    const { buildSimilarityEdges } = await import("./build");
    await expect(buildSimilarityEdges(ORG, SNAP)).resolves.toBe(0);
    expect(chCommand).not.toHaveBeenCalled();
  });
});
