import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewProposal } from "../types";

const proposal: NewProposal = {
  kind: "pause",
  campaignId: "camp-1",
  triggeredRule: "kill_rule",
  payload: { campaignId: "camp-1", reason: "CPL exceeded 3500 for 3 consecutive snapshots" },
};

function textResponse(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200 },
  );
}

describe("draftRationale", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      BIFROST_BASE_URL: "http://localhost:8080",
      BIFROST_CHAT_MODEL: "vertex/gemini-2.5-flash-lite",
    };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns the model's drafted rationale text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse("This campaign has been over budget for 3 straight days."),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await expect(draftRationale(proposal)).resolves.toBe(
      "This campaign has been over budget for 3 straight days.",
    );

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/chat\/completions$/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("system");
  });

  it("grounds the system instruction with rule-specific performance-marketing context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await draftRationale(proposal);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toMatch(/consecutive/i);
  });

  it("omits playbook grounding for an unrecognized rule without erroring", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await expect(
      draftRationale({ ...proposal, triggeredRule: "some_future_rule" }),
    ).resolves.toBe("ok");
  });

  it("falls back to a generic string when Bifrost is not configured", async () => {
    delete process.env.BIFROST_BASE_URL;
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

  it("falls back to a generic string when the API returns empty content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("   ")));
    const { draftRationale } = await import("./rationale");
    await expect(draftRationale(proposal)).resolves.toContain("kill_rule");
  });
});
