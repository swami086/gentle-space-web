import { describe, expect, it } from "vitest";
import { parseActionProposalPayload, resolveActionProposalClick } from "./action-proposal";

const basePayload = {
  v: 1 as const,
  kind: "create_campaign_draft",
  title: "Start campaign draft",
  summary: "Review and confirm before creating a pending proposal.",
  citationIds: ["fact-1"],
};

describe("parseActionProposalPayload", () => {
  it("accepts a valid payload with optional href and proposalId", () => {
    expect(parseActionProposalPayload(basePayload)).toEqual(basePayload);
    expect(
      parseActionProposalPayload({
        ...basePayload,
        href: "/proposals/abc",
        proposalId: "abc",
      }),
    ).toEqual({
      ...basePayload,
      href: "/proposals/abc",
      proposalId: "abc",
    });
  });

  it("requires citationIds to be a string array", () => {
    expect(() => parseActionProposalPayload({ ...basePayload, citationIds: "fact-1" })).toThrow();
    expect(() => parseActionProposalPayload({ ...basePayload, citationIds: undefined })).toThrow();
  });

  it("rejects wrong protocol version", () => {
    expect(() => parseActionProposalPayload({ ...basePayload, v: 2 })).toThrow();
  });
});

describe("resolveActionProposalClick", () => {
  it("navigates to a safe relative href", () => {
    expect(
      resolveActionProposalClick({
        ...basePayload,
        href: "/proposals/550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toEqual({
      kind: "navigate",
      path: "/proposals/550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("navigates to /proposals/[id] when proposalId is set without href", () => {
    expect(
      resolveActionProposalClick({
        ...basePayload,
        proposalId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toEqual({
      kind: "navigate",
      path: "/proposals/550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("rejects absolute external http(s) URLs", () => {
    expect(
      resolveActionProposalClick({
        ...basePayload,
        href: "https://evil.example/phish",
      }),
    ).toEqual({ kind: "noop" });
    expect(
      resolveActionProposalClick({
        ...basePayload,
        href: "http://evil.example/phish",
      }),
    ).toEqual({ kind: "noop" });
  });

  it("rejects protocol-relative and javascript: hrefs", () => {
    expect(
      resolveActionProposalClick({
        ...basePayload,
        href: "//evil.example/phish",
      }),
    ).toEqual({ kind: "noop" });
    expect(
      resolveActionProposalClick({
        ...basePayload,
        href: "javascript:alert(document.cookie)",
      }),
    ).toEqual({ kind: "noop" });
  });

  it("no-ops when neither href nor proposalId can navigate", () => {
    expect(resolveActionProposalClick(basePayload)).toEqual({ kind: "noop" });
    expect(
      resolveActionProposalClick({
        ...basePayload,
        href: "https://evil.example",
        proposalId: "fallback-id",
      }),
    ).toEqual({ kind: "noop" });
  });
});
