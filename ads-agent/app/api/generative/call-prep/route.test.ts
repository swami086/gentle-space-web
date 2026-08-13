import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SCOPE = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const ENQUIRY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const callPrepResult = {
  pack: {
    entity: "enquiry" as const,
    id: ENQUIRY_ID,
    builtAt: "2026-08-13T00:00:00.000Z",
    rowIds: [ENQUIRY_ID],
    facts: {},
  },
  openuiLang: "root = CallPrepCard([{ text: \"a\", citationIds: [\"id\"] }])",
  points: [
    { text: "Open with contact", citationIds: [ENQUIRY_ID] },
    { text: "Confirm timeline", citationIds: [ENQUIRY_ID] },
    { text: "Nail listing fit", citationIds: [ENQUIRY_ID] },
  ],
};

const { guard, buildCallPrep, insertGenerativeAnswer } = vi.hoisted(() => ({
  guard: vi.fn(),
  buildCallPrep: vi.fn(),
  insertGenerativeAnswer: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/generative/call-prep", () => ({ buildCallPrep }));
vi.mock("@/lib/db/generative-answers", () => ({ insertGenerativeAnswer }));

import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/generative/call-prep", {
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
  buildCallPrep.mockResolvedValue(callPrepResult);
  insertGenerativeAnswer.mockResolvedValue({
    id: "prep-1",
    openuiLang: callPrepResult.openuiLang,
    followUps: [],
  });
});

describe("POST /api/generative/call-prep", () => {
  it("requires operator role", async () => {
    await POST(post({ enquiryId: ENQUIRY_ID }));
    expect(guard).toHaveBeenCalledWith("operator");
  });

  it("returns 400 when enquiryId is missing", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("builds call prep, persists call_prep surface, returns points", async () => {
    const res = await POST(post({ enquiryId: ENQUIRY_ID }));
    expect(buildCallPrep).toHaveBeenCalledWith(TEST_SCOPE, ENQUIRY_ID);
    expect(insertGenerativeAnswer).toHaveBeenCalledWith(
      TEST_SCOPE,
      expect.objectContaining({
        surface: "call_prep",
        subjectType: "enquiry",
        subjectId: ENQUIRY_ID,
        packRowIds: callPrepResult.pack.rowIds,
        createdBy: "user-1",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("prep-1");
    expect(json.points).toHaveLength(3);
  });

  it("returns 404 when enquiry is missing", async () => {
    buildCallPrep.mockRejectedValue(new Error("entity_not_found"));
    const res = await POST(post({ enquiryId: ENQUIRY_ID }));
    expect(res.status).toBe(404);
    expect(insertGenerativeAnswer).not.toHaveBeenCalled();
  });
});
