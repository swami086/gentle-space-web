import { beforeEach, describe, expect, it, vi } from "vitest";

const { callTwentyTool } = vi.hoisted(() => ({ callTwentyTool: vi.fn() }));
vi.mock("../bifrost/mcp-client", () => ({ callTwentyTool }));

import type { Scope } from "../db/scope-sql";
import {
  assertPlatformScope,
  getOpportunity,
  getPipelineValue,
  listOpportunities,
  updateOpportunityStage,
} from "./twenty-pipeline";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

beforeEach(() => callTwentyTool.mockReset());

describe("assertPlatformScope", () => {
  it("names the function it is protecting in the error", () => {
    expect(() => assertPlatformScope(ORG, "listOpportunities")).toThrow(
      /listOpportunities is platform-only/,
    );
  });

  it("permits platform scope", () => {
    expect(() => assertPlatformScope(PLATFORM, "listOpportunities")).not.toThrow();
  });
});

describe("every Twenty read and write refuses org scope", () => {
  it("listOpportunities throws rather than returning an empty array", async () => {
    await expect(listOpportunities(ORG)).rejects.toThrow("platform-only");
    expect(callTwentyTool, "must not reach Twenty at all").not.toHaveBeenCalled();
  });

  it("getOpportunity throws rather than returning null", async () => {
    await expect(getOpportunity(ORG, "opp-1")).rejects.toThrow("platform-only");
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("updateOpportunityStage throws rather than returning { ok: false }", async () => {
    await expect(updateOpportunityStage(ORG, "opp-1", "NEW_BRIEF")).rejects.toThrow("platform-only");
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("getPipelineValue throws rather than returning 0", async () => {
    await expect(getPipelineValue(ORG)).rejects.toThrow("platform-only");
    expect(callTwentyTool).not.toHaveBeenCalled();
  });
});

describe("platform callers still get data", () => {
  it("listOpportunities reaches Twenty under platform scope", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    callTwentyTool.mockResolvedValue([]);
    await expect(listOpportunities(PLATFORM)).resolves.toEqual([]);
    expect(callTwentyTool).toHaveBeenCalledTimes(1);
  });
});
