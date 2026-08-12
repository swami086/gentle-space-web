import { describe, expect, it, vi } from "vitest";

const { guard, draftCopilotReply } = vi.hoisted(() => ({
  guard: vi.fn(),
  draftCopilotReply: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/decision-engine/copilot-chat", () => ({ draftCopilotReply }));

import { POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/copilot/chat", { method: "POST", body: JSON.stringify(body) });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice("data:".length).trim()));
}

describe("POST /api/copilot/chat", () => {
  it("returns 401/403 passthrough when guard rejects", async () => {
    const rejection = { ok: false as const, response: new Response(null, { status: 403 }) };
    guard.mockResolvedValue(rejection);
    const res = await POST(postRequest({ content: "hi", history: [] }));
    expect(res.status).toBe(403);
  });

  it("requires operator role", async () => {
    guard.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" }, scope: { kind: "org", orgId: "o1" } });
    draftCopilotReply.mockImplementation(async function* () {
      yield { type: "done", reply: "ok" };
    });
    await POST(postRequest({ content: "hi", history: [] }));
    expect(guard).toHaveBeenCalledWith("operator");
  });

  it("returns 400 when content is missing", async () => {
    guard.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" }, scope: { kind: "org", orgId: "o1" } });
    const res = await POST(postRequest({ content: "", history: [] }));
    expect(res.status).toBe(400);
  });

  it("streams deltas then a done event with the reply", async () => {
    guard.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" }, scope: { kind: "org", orgId: "o1" } });
    draftCopilotReply.mockImplementation(async function* () {
      yield { type: "delta", content: "root = Stat" };
      yield { type: "delta", content: 'Card("Leads", "42")' };
      yield { type: "done", reply: 'root = StatCard("Leads", "42")' };
    });
    const res = await POST(postRequest({ content: "how many leads?", history: [] }));
    const events = await readEvents(res);
    expect(events[0]).toEqual({ delta: "root = Stat" });
    expect(events[1]).toEqual({ delta: 'Card("Leads", "42")' });
    expect(events[2]).toEqual({ done: true, reply: 'root = StatCard("Leads", "42")' });
  });
});
