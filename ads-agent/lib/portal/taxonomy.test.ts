import { describe, it, expect } from "vitest";
import {
  EVENT_NAMES, EVENT_PURPOSE, MAX_EVENTS_PER_REQUEST, TAXONOMY_VERSION,
  envelopeSchema, purposeFor,
} from "./taxonomy";

const envelope = (overrides: Record<string, unknown> = {}) => ({
  taxonomy_version: TAXONOMY_VERSION,
  session_id: "abcdefabcdefabcdef01",
  events: [{ event: "page_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: { path: "/spaces", referrer: "" } }],
  ...overrides,
});

describe("taxonomy", () => {
  it("covers exactly the seven events in portal spec §6", () => {
    expect([...EVENT_NAMES].sort()).toEqual([
      "contact_revealed", "enquiry_submitted", "filter_applied",
      "listing_view", "page_view", "search_performed", "shortlist_added",
    ]);
  });

  it("maps every event to exactly one purpose", () => {
    for (const name of EVENT_NAMES) expect(EVENT_PURPOSE[name]).toBeTypeOf("string");
    expect(purposeFor("search_performed")).toBe("space_recommendation");
    expect(purposeFor("contact_revealed")).toBe("enquiry_handling");
    expect(purposeFor("page_view")).toBe("site_analytics");
  });

  it("accepts a well-formed envelope", () => {
    expect(envelopeSchema.safeParse(envelope()).success).toBe(true);
  });

  it("rejects an unknown event name, because a purpose cannot be stated for an undefined payload", () => {
    const result = envelopeSchema.safeParse(
      envelope({ events: [{ event: "scroll_depth", occurred_at: "2026-08-12T09:00:00.000Z", payload: {} }] }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing a required field for its event", () => {
    const result = envelopeSchema.safeParse(
      envelope({ events: [{ event: "listing_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: {} }] }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a taxonomy version it does not implement", () => {
    expect(envelopeSchema.safeParse(envelope({ taxonomy_version: 2 })).success).toBe(false);
  });

  it("rejects a session id shaped like an email or a phone number", () => {
    expect(envelopeSchema.safeParse(envelope({ session_id: "visitor@example.com" })).success).toBe(false);
    expect(envelopeSchema.safeParse(envelope({ session_id: "919876543210xxxxxxxx" })).success).toBe(false);
  });

  it("caps the number of events per request", () => {
    const one = envelope().events[0];
    const tooMany = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => one);
    expect(envelopeSchema.safeParse(envelope({ events: tooMany })).success).toBe(false);
  });
});
