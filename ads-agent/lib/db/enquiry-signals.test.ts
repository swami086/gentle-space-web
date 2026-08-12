import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, listMessages } = vi.hoisted(() => ({
  query: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./enquiry-messages", () => ({ listMessages }));

import { deriveSignals, listSignals, refreshEnquirySignals } from "./enquiry-signals";

const scope = { kind: "org", orgId: "org-1" } as const;

function message(body: string, receivedAt: string) {
  return {
    id: `msg-${receivedAt}`,
    orgId: "org-1",
    enquiryId: "enq-1",
    channel: "web_form" as const,
    body,
    externalId: null,
    replyToken: null,
    isUntrusted: true,
    receivedAt,
  };
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  listMessages.mockReset().mockResolvedValue([]);
});

describe("deriveSignals", () => {
  it("counts pricing questions across messages and keeps the latest timestamp", () => {
    const signals = deriveSignals([
      message("What is the price per desk?", "2026-08-12T04:00:00.000Z"),
      message("Any discount on that pricing?", "2026-08-13T04:00:00.000Z"),
    ]);
    expect(signals).toEqual([
      {
        kind: "asked_about_pricing",
        occurrences: 2,
        lastSeenAt: "2026-08-13T04:00:00.000Z",
      },
    ]);
  });

  it("is case-insensitive and does not double-count one message", () => {
    const signals = deriveSignals([
      message("PRICE and price and pricing", "2026-08-12T04:00:00.000Z"),
    ]);
    expect(signals).toEqual([
      { kind: "asked_about_pricing", occurrences: 1, lastSeenAt: "2026-08-12T04:00:00.000Z" },
    ]);
  });

  it("finds availability, timeline and competitor signals", () => {
    const signals = deriveSignals([
      message(
        "Is it available from next month? We are also looking at WeWork.",
        "2026-08-12T04:00:00.000Z",
      ),
    ]);
    expect(signals.map((s) => s.kind).sort()).toEqual([
      "asked_about_availability",
      "mentioned_competitor",
      "mentioned_timeline",
    ]);
  });

  it("returns nothing rather than guessing when the text says nothing", () => {
    expect(deriveSignals([message("Hi", "2026-08-12T04:00:00.000Z")])).toEqual([]);
  });
});

describe("refreshEnquirySignals", () => {
  it("upserts one row per kind and reports the current set", async () => {
    listMessages.mockResolvedValue([message("price?", "2026-08-12T04:00:00.000Z")]);
    query.mockResolvedValue({
      rows: [
        {
          org_id: "org-1",
          enquiry_id: "enq-1",
          kind: "asked_about_pricing",
          occurrences: 1,
          last_seen_at: new Date("2026-08-12T04:00:00.000Z"),
        },
      ],
    });
    const signals = await refreshEnquirySignals(scope, "enq-1");
    expect(signals).toEqual([
      {
        orgId: "org-1",
        enquiryId: "enq-1",
        kind: "asked_about_pricing",
        occurrences: 1,
        lastSeenAt: "2026-08-12T04:00:00.000Z",
      },
    ]);
    expect(String(query.mock.calls[1][0])).toContain(
      "ON CONFLICT (org_id, enquiry_id, kind) DO UPDATE",
    );
  });

  it("clears a signal that the current text no longer supports", async () => {
    listMessages.mockResolvedValue([message("Hi", "2026-08-12T04:00:00.000Z")]);
    await refreshEnquirySignals(scope, "enq-1");
    expect(String(query.mock.calls[0][0])).toContain("DELETE FROM adsagent.enquiry_signals");
  });
});

describe("listSignals", () => {
  it("orders by occurrences so the loudest signal renders first", async () => {
    await listSignals(scope, "enq-1");
    expect(String(query.mock.calls[0][0])).toContain("ORDER BY occurrences DESC");
  });
});
