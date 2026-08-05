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
  it("includes every CRM and analytics tool", () => {
    const names = platformToolSpecs.map((s) => s.name);
    expect(names).toContain("list_opportunities");
    expect(names).toContain("advance_opportunity_stage");
    expect(names).toContain("get_spend_cpl_trend");
    expect(platformToolProvider.list_opportunities).toBeDefined();
    expect(platformToolProvider.get_spend_cpl_trend).toBeDefined();
  });

  it("throws on a tool name collision across domains", () => {
    expect(() =>
      composeToolSpecs(
        [{ name: "dup", description: "a", parameters: { type: "object", properties: {}, required: [] } }],
        [{ name: "dup", description: "b", parameters: { type: "object", properties: {}, required: [] } }],
      ),
    ).toThrow(/duplicate/);
  });
});
