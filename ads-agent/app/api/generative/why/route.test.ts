import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SCOPE = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PROPOSAL_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const pack = {
  entity: "proposal" as const,
  id: PROPOSAL_ID,
  builtAt: "2026-08-13T00:00:00.000Z",
  rowIds: [PROPOSAL_ID, "cccccccc-cccc-cccc-cccc-cccccccccccc"],
  facts: {
    proposal: {
      id: PROPOSAL_ID,
      kind: "pause",
      status: "pending",
      triggeredRule: "kill_rule",
      rationale: "CPL high",
    },
  },
};

const { guard, buildGroundingPack, insertGenerativeAnswer } = vi.hoisted(() => ({
  guard: vi.fn(),
  buildGroundingPack: vi.fn(),
  insertGenerativeAnswer: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/generative/grounding-pack", () => ({ buildGroundingPack }));
vi.mock("@/lib/db/generative-answers", () => ({ insertGenerativeAnswer }));

import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/generative/why", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "user-1", orgId: TEST_SCOPE.orgId, role: "operator" },
    scope: TEST_SCOPE,
  });
  buildGroundingPack.mockResolvedValue(pack);
  insertGenerativeAnswer.mockResolvedValue({
    id: "answer-1",
    openuiLang: 'root = WhyCard("body", ["id"])',
    followUps: ["What metrics drove this?"],
  });
});

describe("POST /api/generative/why", () => {
  it("requires operator role", async () => {
    await POST(post({ proposalId: PROPOSAL_ID }));
    expect(guard).toHaveBeenCalledWith("operator");
  });

  it("returns guard response when unauthorized", async () => {
    const forbidden = new Response(null, { status: 403 });
    guard.mockResolvedValue({ ok: false, response: forbidden });
    const res = await POST(post({ proposalId: PROPOSAL_ID }));
    expect(res).toBe(forbidden);
  });

  it("returns 400 when proposalId is missing", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("builds pack, gates citations, persists, and returns id + lang", async () => {
    const res = await POST(post({ proposalId: PROPOSAL_ID }));
    expect(buildGroundingPack).toHaveBeenCalledWith(TEST_SCOPE, "proposal", PROPOSAL_ID);
    expect(insertGenerativeAnswer).toHaveBeenCalledWith(
      TEST_SCOPE,
      expect.objectContaining({
        surface: "why",
        subjectType: "proposal",
        subjectId: PROPOSAL_ID,
        packRowIds: pack.rowIds,
        createdBy: "user-1",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("answer-1");
    expect(json.openuiLang).toContain("WhyCard");
    expect(json.followUps).toEqual(["What metrics drove this?"]);
  });

  it("returns 404 when the proposal pack is missing", async () => {
    buildGroundingPack.mockRejectedValue(new Error("entity_not_found"));
    const res = await POST(post({ proposalId: PROPOSAL_ID }));
    expect(res.status).toBe(404);
    expect(insertGenerativeAnswer).not.toHaveBeenCalled();
  });

  it("returns 400 when citations fall outside the pack", async () => {
    buildGroundingPack.mockResolvedValue({ ...pack, rowIds: [] });
    const res = await POST(post({ proposalId: PROPOSAL_ID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "citation_not_in_pack" });
  });
});
