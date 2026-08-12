// ads-agent/mcp/context-server/create-proposal.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const readQuery = vi.hoisted(() => vi.fn());
const writeQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_o: string, fn: (tx: { query: typeof readQuery }) => Promise<unknown>) =>
    fn({ query: readQuery }),
  withAgentTenantWriteTx: async (_o: string, fn: (tx: { query: typeof writeQuery }) => Promise<unknown>) =>
    fn({ query: writeQuery }),
}));

import { createAgentProposal, CreateProposalError } from "./create-proposal";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["create_proposal"],
};
const ENQ = "33333333-3333-3333-3333-333333333333";
const PROPOSAL = "55555555-5555-5555-5555-555555555555";

const VALID = {
  kind: "enquiry.requirement_update",
  payload: { desks: 40 },
  rationale: "Asked for 40 desks on the second call.",
  evidence: [ENQ],
};

beforeEach(() => {
  vi.clearAllMocks();
  readQuery.mockResolvedValue({ rows: [{ cdc_lag_seconds: 12 }], rowCount: 1 });
  writeQuery.mockResolvedValue({ rows: [{ proposal_id: PROPOSAL }], rowCount: 1 });
});

describe("createAgentProposal", () => {
  it("calls the SECURITY DEFINER function and returns the new proposal id", async () => {
    expect(await createAgentProposal(CLAIMS, VALID)).toEqual({ proposalId: PROPOSAL });
    const [sql, params] = writeQuery.mock.calls[0];
    expect(String(sql)).toContain("adsagent.agent_create_proposal");
    expect(params).toContain("leads");
    expect(params).toContain(12);
  });

  it("never issues an INSERT of its own", async () => {
    await createAgentProposal(CLAIMS, VALID);
    for (const call of writeQuery.mock.calls) expect(String(call[0])).not.toContain("INSERT");
  });

  it("rejects an empty evidence array — an agent that cannot cite does not propose", async () => {
    await expect(createAgentProposal(CLAIMS, { ...VALID, evidence: [] })).rejects.toMatchObject({
      code: "evidence_empty",
    });
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it("rejects prose in evidence: identifiers only (dataflow review A-4)", async () => {
    await expect(
      createAgentProposal(CLAIMS, {
        ...VALID,
        evidence: ["The client said they need 40 desks by October."],
      }),
    ).rejects.toMatchObject({ code: "evidence_not_identifier" });
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it.each([ENQ, `artifacts/${CLAIMS.orgId}/draft/${ENQ}`, `node:${ENQ}`])(
    "accepts %s as an identifier",
    async (id) => {
      await expect(createAgentProposal(CLAIMS, { ...VALID, evidence: [id] })).resolves.toEqual({
        proposalId: PROPOSAL,
      });
    },
  );

  it("rejects a kind outside the agent vocabulary", async () => {
    await expect(createAgentProposal(CLAIMS, { ...VALID, kind: "campaign.execute" })).rejects.toMatchObject({
      code: "invalid_kind",
    });
  });

  it("refuses a spend-changing proposal when CDC lag exceeds 15 minutes", async () => {
    readQuery.mockResolvedValue({ rows: [{ cdc_lag_seconds: 1200 }], rowCount: 1 });
    await expect(
      createAgentProposal(CLAIMS, { ...VALID, kind: "campaign.budget_change" }),
    ).rejects.toMatchObject({ code: "stale_data_refusal" });
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it("still allows a non-spend proposal under the same lag, because refusing is scoped", async () => {
    readQuery.mockResolvedValue({ rows: [{ cdc_lag_seconds: 1200 }], rowCount: 1 });
    await expect(createAgentProposal(CLAIMS, VALID)).resolves.toEqual({ proposalId: PROPOSAL });
  });

  it("treats a missing manifest as maximally stale rather than as fresh", async () => {
    readQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      createAgentProposal(CLAIMS, { ...VALID, kind: "campaign.create" }),
    ).rejects.toBeInstanceOf(CreateProposalError);
  });

  it("caps the rationale so a completion body cannot be smuggled through it", async () => {
    await expect(
      createAgentProposal(CLAIMS, { ...VALID, rationale: "x".repeat(5000) }),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });
});
