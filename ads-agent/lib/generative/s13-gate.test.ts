/**
 * S13 generative surfaces gate — build-sequence checkpoint (F1–F5).
 * Run: npx vitest run lib/generative/s13-gate.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listProposals, getSpendCplTrend, createDraft } = vi.hoisted(() => ({
  listProposals: vi.fn(),
  getSpendCplTrend: vi.fn(),
  createDraft: vi.fn(),
}));

vi.mock("../db/proposals", () => ({ listProposals }));
vi.mock("../db/dashboard", () => ({ getSpendCplTrend }));
vi.mock("../db/campaign-drafts", () => ({ createDraft }));

const { buildGroundingPack, isBifrostConfigured, chatCompletion } = vi.hoisted(() => ({
  buildGroundingPack: vi.fn(),
  isBifrostConfigured: vi.fn(),
  chatCompletion: vi.fn(),
}));

vi.mock("./grounding-pack", () => ({ buildGroundingPack }));
vi.mock("../bifrost/client", () => ({
  isBifrostConfigured,
  chatCompletion,
  firstChoiceContent: (response: { choices?: { message?: { content?: string | null } }[] }) => {
    const content = response.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim().length > 0 ? content.trim() : undefined;
  },
}));

import { createAnalyticsToolProvider } from "../openui/analytics-tools";
import { createCampaignToolProvider } from "../openui/campaign-tools";
import type { Scope } from "../db/scope-sql";
import {
  assertCitationsAllowed,
  CitationNotInPackError,
  extractClaimIdsFromOpenUi,
} from "./citation-gate";
import { parseActionProposalPayload, resolveActionProposalClick } from "./action-proposal";
import { buildCallPrep, templateCallPrepPoints } from "./call-prep";
import type { GenerativeGroundingPack } from "./grounding-pack";

const SESSION_SCOPE: Scope = {
  kind: "org",
  orgId: "10101010-1010-1010-1010-101010101010",
};
const FOREIGN_ORG = "99999999-9999-9999-9999-999999999999";
const ENQUIRY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTIVITY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const LISTING_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const PACK: GenerativeGroundingPack = {
  entity: "enquiry",
  id: ENQUIRY_ID,
  builtAt: "2026-08-13T00:00:00.000Z",
  rowIds: [ENQUIRY_ID, ACTIVITY_ID, LISTING_ID],
  facts: {
    enquiry: {
      id: ENQUIRY_ID,
      contactName: "Alex",
      replyState: "waiting",
      listingId: LISTING_ID,
    },
    activity: [
      {
        id: ACTIVITY_ID,
        kind: "call",
        occurredAt: "2026-08-02T10:30:00.000Z",
      },
    ],
  },
};

function repoPath(...segments: string[]): string {
  return join(__dirname, "..", "..", ...segments);
}

beforeEach(() => {
  listProposals.mockReset();
  getSpendCplTrend.mockReset();
  createDraft.mockReset();
  buildGroundingPack.mockReset();
  isBifrostConfigured.mockReset();
  chatCompletion.mockReset();
  buildGroundingPack.mockResolvedValue(PACK);
  isBifrostConfigured.mockReturnValue(false);
});

describe("s13-gate: citation allowlist (F4)", () => {
  it("rejects a foreign claim id not in pack.rowIds", () => {
    expect(() =>
      assertCitationsAllowed(PACK, ["00000000-0000-0000-0000-000000000000"]),
    ).toThrow(CitationNotInPackError);
    try {
      assertCitationsAllowed(PACK, ["00000000-0000-0000-0000-000000000000"]);
    } catch (err) {
      expect(err).toBeInstanceOf(CitationNotInPackError);
      expect((err as CitationNotInPackError).message).toBe("citation_not_in_pack");
    }
  });

  it("extracts OpenUI claim ids and fails closed when any id is foreign", () => {
    const lang = formatCallPrepLang([
      { text: "Point one", citationIds: [ENQUIRY_ID] },
      { text: "Point two", citationIds: [ACTIVITY_ID] },
      { text: "Point three", citationIds: ["00000000-0000-0000-0000-000000000000"] },
    ]);
    const ids = extractClaimIdsFromOpenUi(lang);
    expect(ids).toContain("00000000-0000-0000-0000-000000000000");
    expect(() => assertCitationsAllowed(PACK, ids)).toThrow(/citation_not_in_pack/);
  });
});

describe("s13-gate: session-scoped OpenUI tools (F1)", () => {
  it("createAnalyticsToolProvider binds session scope, not ADS_AGENT_ORG_ID", async () => {
    process.env.ADS_AGENT_ORG_ID = FOREIGN_ORG;
    listProposals.mockResolvedValue([]);

    const provider = createAnalyticsToolProvider(SESSION_SCOPE);
    await provider.list_pending_proposals({ orgId: FOREIGN_ORG });

    expect(listProposals).toHaveBeenCalledWith(SESSION_SCOPE, "pending");
    expect(listProposals).not.toHaveBeenCalledWith(
      expect.objectContaining({ orgId: FOREIGN_ORG }),
      expect.anything(),
    );
  });

  it("createCampaignToolProvider ignores orgId in tool args", async () => {
    createDraft.mockResolvedValue({ id: "draft-1" });

    const provider = createCampaignToolProvider(SESSION_SCOPE);
    await provider.start_campaign_draft({ orgId: FOREIGN_ORG });

    expect(createDraft).toHaveBeenCalledWith(SESSION_SCOPE);
  });

  it("POST /api/openui/tools route uses guard scope, not env org", () => {
    const routeSrc = readFileSync(repoPath("app/api/openui/tools/route.ts"), "utf8");
    expect(routeSrc).toContain("createPlatformToolProvider(access.scope)");
    expect(routeSrc).not.toMatch(/ADS_AGENT_ORG_ID/);
  });
});

describe("s13-gate: ActionProposal navigation boundary (F2)", () => {
  const base = {
    v: 1 as const,
    kind: "review_proposal",
    title: "Review",
    summary: "Open the pending proposal.",
    citationIds: [ENQUIRY_ID],
  };

  it("rejects javascript: href via resolveActionProposalClick", () => {
    const payload = parseActionProposalPayload({
      ...base,
      href: "javascript:alert(document.cookie)",
    });
    expect(resolveActionProposalClick(payload)).toEqual({ kind: "noop" });
  });

  it("rejects off-origin absolute URLs", () => {
    for (const href of ["https://evil.example/phish", "//evil.example/phish"]) {
      expect(
        resolveActionProposalClick(parseActionProposalPayload({ ...base, href })),
      ).toEqual({ kind: "noop" });
    }
  });

  it("allows safe in-app relative paths only", () => {
    expect(
      resolveActionProposalClick(
        parseActionProposalPayload({ ...base, href: "/proposals/abc-123" }),
      ),
    ).toEqual({ kind: "navigate", path: "/proposals/abc-123" });
  });
});

describe("s13-gate: call-prep three cited points (F3)", () => {
  it("returns exactly three talking points with citations ⊆ pack.rowIds", async () => {
    const result = await buildCallPrep(SESSION_SCOPE, ENQUIRY_ID);

    expect(buildGroundingPack).toHaveBeenCalledWith(SESSION_SCOPE, "enquiry", ENQUIRY_ID);
    expect(result.points).toHaveLength(3);
    for (const point of result.points) {
      expect(point.citationIds.length).toBeGreaterThan(0);
      for (const id of point.citationIds) {
        expect(PACK.rowIds).toContain(id);
      }
    }
    expect(result.openuiLang).toMatch(/^root = CallPrepCard\(\[/);
    expect(extractClaimIdsFromOpenUi(result.openuiLang).every((id) => PACK.rowIds.includes(id))).toBe(
      true,
    );
  });

  it("template fallback stays grounded when Bifrost is unavailable", () => {
    const points = templateCallPrepPoints(PACK);
    expect(points).toHaveLength(3);
    for (const point of points) {
      for (const id of point.citationIds) {
        expect(PACK.rowIds).toContain(id);
      }
    }
  });
});

describe("s13-gate: persistence + wiring (F5 / UX)", () => {
  it("migration 111 enables FORCE RLS on generative_answers", () => {
    const sql = readFileSync(
      repoPath("lib/db/migrations/111_generative_answers.up.sql"),
      "utf8",
    );
    expect(sql).toMatch(/FORCE\s+ROW LEVEL SECURITY/);
    expect(sql).toMatch(/tenant_isolation/);
    expect(sql).toMatch(/current_tenant\(\)/);
  });

  it("getGenerativeAnswer scopes reads by org under RLS transaction", async () => {
    const mod = await import("../db/generative-answers");
    expect(mod.getGenerativeAnswer.toString()).toMatch(/scopeClause/);
    expect(mod.getGenerativeAnswer.toString()).toMatch(/withTenantTransaction/);
  });

  it("AskAiTrigger has a real call site on WhyPanel", () => {
    const whyPanel = readFileSync(
      repoPath("components/generative/WhyPanel.tsx"),
      "utf8",
    );
    const proposalsPage = readFileSync(
      repoPath("app/(admin)/proposals/[id]/page.tsx"),
      "utf8",
    );
    expect(whyPanel).toMatch(/import \{ AskAiTrigger \}/);
    expect(whyPanel).toMatch(/<AskAiTrigger/);
    expect(proposalsPage).toMatch(/WhyPanel/);
  });
});

function formatCallPrepLang(
  points: Array<{ text: string; citationIds: string[] }>,
): string {
  const literals = points
    .map((p) => {
      const ids = p.citationIds.map((id) => JSON.stringify(id)).join(", ");
      return `{ text: ${JSON.stringify(p.text)}, citationIds: [${ids}] }`;
    })
    .join(", ");
  return `root = CallPrepCard([${literals}])`;
}
