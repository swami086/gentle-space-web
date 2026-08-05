import { describe, expect, it } from "vitest";
import { composeToolProviders, composeToolSpecs, platformToolProvider, platformToolSpecs } from "./platform-tools";
import type { ToolSpec } from "@openuidev/lang-core";

describe("composeToolProviders", () => {
  it("merges multiple domain tool-provider maps into one", () => {
    const a = { get_users: async () => [1, 2] };
    const b = { get_leads: async () => [3] };
    const merged = composeToolProviders(a, b);
    expect(Object.keys(merged).sort()).toEqual(["get_leads", "get_users"]);
  });

  it("throws on a duplicate tool name across domains", () => {
    const a = { get_users: async () => [] };
    const b = { get_users: async () => [] };
    expect(() => composeToolProviders(a, b)).toThrow(/duplicate tool name "get_users"/);
  });

  it("returns an empty object when called with no providers", () => {
    expect(composeToolProviders()).toEqual({});
  });
});

describe("composeToolSpecs", () => {
  const spec = (name: string): ToolSpec => ({ name, inputSchema: {}, outputSchema: {} });

  it("merges multiple domain tool-spec lists into one", () => {
    const merged = composeToolSpecs([spec("get_users")], [spec("get_leads")]);
    expect(merged.map((s) => s.name).sort()).toEqual(["get_leads", "get_users"]);
  });

  it("throws on a duplicate tool spec name across domains", () => {
    expect(() => composeToolSpecs([spec("get_users")], [spec("get_users")])).toThrow(/duplicate tool spec name "get_users"/);
  });

  it("returns an empty array when called with no spec lists", () => {
    expect(composeToolSpecs()).toEqual([]);
  });
});

describe("platformToolProvider / platformToolSpecs", () => {
  it("compose zero domain tool sets today — no domain has authored a ToolSpec/ToolProvider yet (see this plan's Global Constraints)", () => {
    expect(platformToolProvider).toEqual({});
    expect(platformToolSpecs).toEqual([]);
  });
});
