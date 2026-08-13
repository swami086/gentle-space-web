import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SCOPE = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const ENQUIRY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const pack = {
  entity: "enquiry" as const,
  id: ENQUIRY_ID,
  builtAt: "2026-08-13T00:00:00.000Z",
  rowIds: [ENQUIRY_ID],
  facts: { enquiry: { id: ENQUIRY_ID, replyState: "waiting" } },
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
  return new Request("http://localhost/api/generative/ask", {
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
    id: "ask-1",
    openuiLang: 'root = WhyCard("answer", ["id"])',
    followUps: [],
  });
});

describe("POST /api/generative/ask", () => {
  it("requires operator role", async () => {
    await POST(post({ question: "Why is CPL up?" }));
    expect(guard).toHaveBeenCalledWith("operator");
  });

  it("returns 400 when question is missing", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when only subjectType is provided", async () => {
    const res = await POST(post({ question: "Hi", subjectType: "enquiry" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid subjectType", async () => {
    const res = await POST(
      post({ question: "Hi", subjectType: "invalid", subjectId: ENQUIRY_ID }),
    );
    expect(res.status).toBe(400);
  });

  it("persists a general ask without a grounding pack", async () => {
    const res = await POST(post({ question: "What should I focus on today?" }));
    expect(buildGroundingPack).not.toHaveBeenCalled();
    expect(insertGenerativeAnswer).toHaveBeenCalledWith(
      TEST_SCOPE,
      expect.objectContaining({
        surface: "ask",
        subjectType: "general",
        packRowIds: [],
      }),
    );
    expect(res.status).toBe(200);
  });

  it("loads pack when subject is provided and persists cited answer", async () => {
    const res = await POST(
      post({ question: "What's the status?", subjectType: "enquiry", subjectId: ENQUIRY_ID }),
    );
    expect(buildGroundingPack).toHaveBeenCalledWith(TEST_SCOPE, "enquiry", ENQUIRY_ID);
    expect(insertGenerativeAnswer).toHaveBeenCalledWith(
      TEST_SCOPE,
      expect.objectContaining({
        surface: "ask",
        subjectType: "enquiry",
        subjectId: ENQUIRY_ID,
        packRowIds: pack.rowIds,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("ask-1");
  });

  it("returns 404 when the subject entity is missing", async () => {
    buildGroundingPack.mockRejectedValue(new Error("entity_not_found"));
    const res = await POST(
      post({ question: "Status?", subjectType: "enquiry", subjectId: ENQUIRY_ID }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when citations are outside the pack", async () => {
    buildGroundingPack.mockResolvedValue({ ...pack, rowIds: [] });
    const res = await POST(
      post({ question: "Status?", subjectType: "enquiry", subjectId: ENQUIRY_ID }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "citation_not_in_pack" });
  });
});
