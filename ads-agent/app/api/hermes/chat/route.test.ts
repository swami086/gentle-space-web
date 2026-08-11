import { describe, expect, it, vi } from "vitest";

const { requireApiRole, draftHermesReply } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  draftHermesReply: vi.fn(),
}));

vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/decision-engine/hermes-chat", () => ({ draftHermesReply }));

import { POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/hermes/chat", { method: "POST", body: JSON.stringify(body) });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice("data:".length).trim()));
}

describe("POST /api/hermes/chat", () => {
  it("returns 401/403 passthrough when requireApiRole rejects", async () => {
    requireApiRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = await POST(postRequest({ userMessage: "hi", history: [], origin: "copilot" }));
    expect(res.status).toBe(403);
  });

  it("requires operator role", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftHermesReply.mockImplementation(async function* () {
      yield { type: "done", reply: "ok" };
    });
    await POST(postRequest({ userMessage: "hi", history: [], origin: "copilot" }));
    expect(requireApiRole).toHaveBeenCalledWith("operator");
  });

  it("returns 400 when userMessage is missing", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    const res = await POST(postRequest({ userMessage: "", history: [], origin: "copilot" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when origin is missing or invalid", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    const res = await POST(postRequest({ userMessage: "hi", history: [], origin: "not-a-real-origin" }));
    expect(res.status).toBe(400);
  });

  it("streams deltas then a done event with the reply, passing origin through", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftHermesReply.mockImplementation(async function* () {
      yield { type: "delta", content: "Spend is " };
      yield { type: "delta", content: "up 12%." };
      yield { type: "done", reply: "Spend is up 12%." };
    });
    const res = await POST(postRequest({ userMessage: "how's spend?", history: [], origin: "reports" }));
    const events = await readEvents(res);
    expect(events[0]).toEqual({ delta: "Spend is " });
    expect(events[1]).toEqual({ delta: "up 12%." });
    expect(events[2]).toEqual({ done: true, reply: "Spend is up 12%." });
    expect(draftHermesReply).toHaveBeenCalledWith({ history: [], userMessage: "how's spend?", origin: "reports" });
  });

  it("forwards tool_progress events as {tool} frames before the delta/done frames", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftHermesReply.mockImplementation(async function* () {
      yield { type: "tool_progress", tool: "list_opportunities" };
      yield { type: "delta", content: "Found 3 leads." };
      yield { type: "done", reply: "Found 3 leads." };
    });
    const res = await POST(postRequest({ userMessage: "which leads are hot?", history: [], origin: "crm" }));
    const events = await readEvents(res);
    expect(events[0]).toEqual({ tool: "list_opportunities" });
    expect(events[1]).toEqual({ delta: "Found 3 leads." });
    expect(events[2]).toEqual({ done: true, reply: "Found 3 leads." });
  });
});
