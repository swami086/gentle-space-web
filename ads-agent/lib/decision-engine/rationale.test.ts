import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewProposal } from "../types";

const proposal: NewProposal = {
  kind: "pause",
  campaignId: "camp-1",
  triggeredRule: "kill_rule",
  payload: { campaignId: "camp-1", reason: "CPL exceeded 3500 for 3 consecutive snapshots" },
};

describe("draftRationale", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, OPENAI_API_KEY: "test-key" };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns the model's drafted rationale text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "This campaign has been over budget for 3 straight days." } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await expect(draftRationale(proposal)).resolves.toBe(
      "This campaign has been over budget for 3 straight days.",
    );
  });

  it("grounds the system prompt with rule-specific performance-marketing context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await draftRationale(proposal);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const systemMessage = body.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMessage.content).toMatch(/consecutive/i);
  });

  it("omits playbook grounding for an unrecognized rule without erroring", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await expect(
      draftRationale({ ...proposal, triggeredRule: "some_future_rule" }),
    ).resolves.toBe("ok");
  });

  it("falls back to a generic string when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const { draftRationale } = await import("./rationale");
    await expect(draftRationale(proposal)).resolves.toContain("kill_rule");
  });

  it("falls back to a generic string when the API call throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { draftRationale } = await import("./rationale");
    await expect(draftRationale(proposal)).resolves.toContain("kill_rule");
  });

  it("falls back to a generic string when the API returns a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const { draftRationale } = await import("./rationale");
    await expect(draftRationale(proposal)).resolves.toContain("kill_rule");
  });
});
