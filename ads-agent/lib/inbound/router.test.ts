import { describe, expect, it } from "vitest";
import { noteWrongCode, routeInbound } from "./router";

const orgId = "org-platform-1";

describe("routeInbound", () => {
  it("routes a 6-digit code to approve_code", () => {
    expect(routeInbound({ orgId, text: "123456" })).toEqual({
      action: "approve_code",
      code: "123456",
    });
  });

  it("routes PAUSE to pause_own_listings", () => {
    expect(routeInbound({ orgId, text: "PAUSE" })).toEqual({ action: "pause_own_listings" });
  });

  it("routes STOP to opt_out, not pause", () => {
    expect(routeInbound({ orgId, text: "STOP" })).toEqual({ action: "opt_out" });
    expect(routeInbound({ orgId, text: "STOP" }).action).not.toBe("pause_own_listings");
  });

  it("routes LEASED to block_new_proposals", () => {
    expect(routeInbound({ orgId, text: "LEASED" })).toEqual({ action: "block_new_proposals" });
  });

  it("routes RESUME to allow_proposals", () => {
    expect(routeInbound({ orgId, text: "RESUME" })).toEqual({ action: "allow_proposals" });
  });

  it("routes unknown text to ignore", () => {
    expect(routeInbound({ orgId, text: "hello" })).toEqual({ action: "ignore" });
  });
});

describe("noteWrongCode", () => {
  it("does not lock before the fifth wrong code", () => {
    expect(noteWrongCode(0)).toEqual({});
    expect(noteWrongCode(3)).toEqual({});
  });

  it("locks on the fifth wrong code", () => {
    expect(noteWrongCode(4)).toEqual({ locked: true });
  });
});
