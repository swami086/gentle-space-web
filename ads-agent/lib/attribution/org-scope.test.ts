import { describe, it, expect } from "vitest";
import { orgScopeFromSession } from "./org-scope";

describe("orgScopeFromSession", () => {
  it("returns org scope for a session with an org", () => {
    expect(
      orgScopeFromSession({
        userId: "u1",
        email: "a@b.c",
        orgId: "33333333-3333-3333-3333-333333333333",
        role: "viewer",
      }),
    ).toEqual({ kind: "org", orgId: "33333333-3333-3333-3333-333333333333" });
  });

  it("throws for a session with no org rather than reading unscoped", () => {
    expect(() =>
      orgScopeFromSession({ userId: "u1", email: "a@b.c", orgId: null, role: "viewer" }),
    ).toThrow(/no org/);
  });
});
