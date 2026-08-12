import { describe, expect, it } from "vitest";
import { orgIdForWrite } from "./scope-write";

describe("orgIdForWrite", () => {
  it("returns the org id for an org scope", () => {
    expect(orgIdForWrite({ kind: "org", orgId: "org-1" })).toBe("org-1");
  });

  it("throws for platform scope, because a tenant row has no org to belong to", () => {
    expect(() => orgIdForWrite({ kind: "platform", orgId: "org-1" })).toThrow(
      /platform scope cannot write/i,
    );
  });
});
