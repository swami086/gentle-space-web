import { describe, expect, it } from "vitest";
import { scopeFor } from "./scope";
import type { Session } from "./dal";

const session: Session = {
  userId: "u1",
  email: "a@b.com",
  orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  role: "admin",
};

describe("scopeFor", () => {
  it("gives an internal org platform scope", () => {
    expect(scopeFor(session, "internal")).toEqual({ kind: "platform", orgId: session.orgId });
  });

  it("hard-bounds an external org to itself", () => {
    expect(scopeFor(session, "external")).toEqual({ kind: "org", orgId: session.orgId });
  });

  it("refuses a session with no org rather than defaulting one", () => {
    expect(() => scopeFor({ ...session, orgId: null }, "external")).toThrow("session has no orgId");
  });
});
