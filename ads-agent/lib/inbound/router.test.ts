import { describe, expect, it } from "vitest";
import { isConsultantServiceNumber, noteWrongCode, routeInbound } from "./router";

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

  it("routes a spend limit and a goal to create_listing", () => {
    expect(routeInbound({ orgId, text: "500 Lease the flat" })).toEqual({
      action: "create_listing",
      dailyMajor: 500,
      sector: "residential",
      goal: "Lease the flat",
    });
  });
});

describe("isConsultantServiceNumber", () => {
  it("is false when the consultant line is unset or different", () => {
    expect(isConsultantServiceNumber("111", undefined)).toBe(false);
    expect(isConsultantServiceNumber("111", "   ")).toBe(false);
    expect(isConsultantServiceNumber(null, "111")).toBe(false);
    expect(isConsultantServiceNumber("222", "111")).toBe(false);
  });

  it("matches the configured phone number id", () => {
    expect(isConsultantServiceNumber("111", "111")).toBe(true);
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
