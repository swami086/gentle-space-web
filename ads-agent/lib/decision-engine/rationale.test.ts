import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewProposal } from "../types";

vi.mock("../vertex/auth", () => ({
  getVertexAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

const proposal: NewProposal = {
  kind: "pause",
  campaignId: "camp-1",
  triggeredRule: "kill_rule",
  payload: { campaignId: "camp-1", reason: "CPL exceeded 3500 for 3 consecutive snapshots" },
};

function textResponse(text: string) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] }),
    { status: 200 },
  );
}

describe("draftRationale", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      GOOGLE_CLOUD_PROJECT: "test-project",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/fake-vertex-key.json",
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
  });

  it("grounds the system instruction with rule-specific performance-marketing context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await draftRationale(proposal);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.systemInstruction.parts[0].text).toMatch(/consecutive/i);
  });

  it("omits playbook grounding for an unrecognized rule without erroring", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { draftRationale } = await import("./rationale");
    await expect(
      draftRationale({ ...proposal, triggeredRule: "some_future_rule" }),
    ).resolves.toBe("ok");
  });

  it("falls back to a generic string when Vertex AI is not configured", async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
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
