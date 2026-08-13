import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SCOPE = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const ANSWER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const row = {
  id: ANSWER_ID,
  orgId: TEST_SCOPE.orgId,
  surface: "why" as const,
  subjectType: "proposal",
  subjectId: "prop-1",
  packRowIds: ["row-a"],
  openuiLang: 'root = WhyCard("Because", ["row-a"])',
  followUps: ["What changed?"],
  createdBy: "user-1",
  createdAt: "2026-08-13T00:00:00.000Z",
};

const { guard, getGenerativeAnswer } = vi.hoisted(() => ({
  guard: vi.fn(),
  getGenerativeAnswer: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/db/generative-answers", () => ({ getGenerativeAnswer }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "user-1", orgId: TEST_SCOPE.orgId, role: "viewer" },
    scope: TEST_SCOPE,
  });
  getGenerativeAnswer.mockResolvedValue(row);
});

describe("GET /api/generative/answers/[id]", () => {
  it("requires viewer role", async () => {
    await GET(new Request("http://localhost"), { params: Promise.resolve({ id: ANSWER_ID }) });
    expect(guard).toHaveBeenCalledWith("viewer");
  });

  it("returns guard response when unauthorized", async () => {
    const forbidden = new Response(null, { status: 403 });
    guard.mockResolvedValue({ ok: false, response: forbidden });
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: ANSWER_ID }),
    });
    expect(res).toBe(forbidden);
  });

  it("returns persisted answer under scope", async () => {
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: ANSWER_ID }),
    });
    expect(getGenerativeAnswer).toHaveBeenCalledWith(TEST_SCOPE, ANSWER_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(ANSWER_ID);
    expect(json.openuiLang).toContain("WhyCard");
    expect(json.followUps).toEqual(["What changed?"]);
  });

  it("returns 404 when answer is missing", async () => {
    getGenerativeAnswer.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});
