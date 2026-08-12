import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { describeGraphTemplates, GraphQueryError, runGraphQuery } from "./graph-query";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["graph_query"],
};
const CORRIDOR = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockResolvedValue({ rows: [{ node_id: "n1", props: {} }], rowCount: 1 });
});

describe("runGraphQuery", () => {
  it("runs the named template's constant SQL with the values bound as parameters", async () => {
    const rows = await runGraphQuery(CLAIMS, {
      template: "spaces_in_corridor",
      params: { corridor_id: CORRIDOR, limit: 10 },
    });
    expect(rows).toEqual([{ node_id: "n1", props: {} }]);
    const statements = txQuery.mock.calls.map((c) => String(c[0]));
    const select = txQuery.mock.calls.find((c) => String(c[0]).includes("SELECT"))!;
    expect(select[1]).toEqual([CORRIDOR, 10]);
    // The value never reaches the SQL text.
    expect(String(select[0])).not.toContain(CORRIDOR);
    expect(statements.some((s) => s.includes("SET LOCAL statement_timeout"))).toBe(true);
  });

  it("rejects a mutating Cypher statement submitted where a template name goes", async () => {
    await expect(
      runGraphQuery(CLAIMS, {
        template: "MATCH (n:Space) SET n.price = 0 RETURN n",
        params: {},
      }),
    ).rejects.toMatchObject({ code: "unknown_template" });
    expect(txQuery).not.toHaveBeenCalled();
  });

  it.each([
    "MATCH (n) DETACH DELETE n",
    "CREATE (n:Space {name: 'x'})",
    "spaces_in_corridor; DROP TABLE adsagent.proposals",
    "SELECT * FROM adsagent.enquiries",
    "UNION SELECT 1",
  ])("rejects %s without touching the database", async (attack) => {
    await expect(runGraphQuery(CLAIMS, { template: attack, params: {} })).rejects.toBeInstanceOf(
      GraphQueryError,
    );
    expect(txQuery).not.toHaveBeenCalled();
  });

  it("rejects params that fail the template's schema", async () => {
    await expect(
      runGraphQuery(CLAIMS, { template: "spaces_in_corridor", params: { corridor_id: "not-a-uuid" } }),
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(txQuery).not.toHaveBeenCalled();
  });

  it("caps the row limit no matter what the caller asks for", async () => {
    await expect(
      runGraphQuery(CLAIMS, { template: "spaces_in_corridor", params: { corridor_id: CORRIDOR, limit: 100000 } }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("takes no free-form field: an extra key is rejected rather than ignored", async () => {
    await expect(
      runGraphQuery(CLAIMS, {
        template: "spaces_in_corridor",
        params: { corridor_id: CORRIDOR, cypher: "MATCH (n) RETURN n" },
      }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("describeGraphTemplates", () => {
  it("lists every template with its parameter names, so the tool description is generated not written", () => {
    const described = describeGraphTemplates();
    expect(described.map((d) => d.name).sort()).toEqual([
      "corridors_for_contact",
      "enquiries_for_space",
      "spaces_in_corridor",
    ]);
    for (const t of described) expect(t.params.length).toBeGreaterThan(0);
  });
});
