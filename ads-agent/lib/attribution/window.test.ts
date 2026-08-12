import { describe, it, expect } from "vitest";
import {
  ATTRIBUTION_CLOSE_DAYS,
  classifyEnquiry,
  istCalendarDate,
  trailingWindow,
  windowState,
} from "./window";

describe("istCalendarDate", () => {
  it("uses the IST calendar day, not the UTC one", () => {
    expect(istCalendarDate(new Date("2026-08-11T19:30:00Z"))).toBe("2026-08-12");
  });

  it("keeps a mid-afternoon IST instant on the same day", () => {
    expect(istCalendarDate(new Date("2026-08-12T08:22:00Z"))).toBe("2026-08-12");
  });

  it("puts the last instant before IST midnight on the earlier day", () => {
    expect(istCalendarDate(new Date("2026-08-11T18:29:59Z"))).toBe("2026-08-11");
  });
});

describe("trailingWindow", () => {
  it("returns an inclusive range of the requested length ending today in IST", () => {
    expect(trailingWindow(7, new Date("2026-08-12T08:00:00Z"))).toEqual({
      startDate: "2026-08-06",
      endDate: "2026-08-12",
    });
  });

  it("returns a single day for a window of one", () => {
    expect(trailingWindow(1, new Date("2026-08-12T08:00:00Z"))).toEqual({
      startDate: "2026-08-12",
      endDate: "2026-08-12",
    });
  });

  it("rejects a non-positive length rather than inventing a range", () => {
    expect(() => trailingWindow(0, new Date("2026-08-12T08:00:00Z"))).toThrow(/at least 1 day/);
  });
});

describe("windowState", () => {
  const w = { startDate: "2026-07-01", endDate: "2026-07-07" };

  it("is open on the last day of the window", () => {
    expect(windowState(w, new Date("2026-07-07T10:00:00Z"))).toBe("open");
  });

  it("is still open one day before the close deadline", () => {
    expect(windowState(w, new Date("2026-07-20T10:00:00Z"))).toBe("open");
  });

  it("closes exactly ATTRIBUTION_CLOSE_DAYS after the end date", () => {
    expect(ATTRIBUTION_CLOSE_DAYS).toBe(14);
    expect(windowState(w, new Date("2026-07-21T00:00:00Z"))).toBe("closed");
  });

  it("stays closed long afterwards", () => {
    expect(windowState(w, new Date("2027-01-01T00:00:00Z"))).toBe("closed");
  });
});

describe("classifyEnquiry", () => {
  const w = { startDate: "2026-08-01", endDate: "2026-08-07" };

  it("counts an enquiry on the first day of the window", () => {
    expect(classifyEnquiry(new Date("2026-07-31T19:00:00Z"), w)).toBe("in_window");
  });

  it("counts an enquiry on the last day of the window", () => {
    expect(classifyEnquiry(new Date("2026-08-07T15:00:00Z"), w)).toBe("in_window");
  });

  it("excludes an enquiry before the window", () => {
    expect(classifyEnquiry(new Date("2026-07-30T10:00:00Z"), w)).toBe("outside");
  });

  it("excludes an enquiry after the window", () => {
    expect(classifyEnquiry(new Date("2026-08-08T10:00:00Z"), w)).toBe("outside");
  });
});
