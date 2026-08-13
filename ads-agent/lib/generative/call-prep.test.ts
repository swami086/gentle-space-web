import { beforeEach, describe, expect, it, vi } from "vitest";

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

import type { Scope } from "../db/scope-sql";
import type { GenerativeGroundingPack } from "./grounding-pack";
import {
  buildCallPrep,
  formatCallPrepOpenUiLang,
  templateCallPrepPoints,
} from "./call-prep";
import { extractClaimIdsFromOpenUi } from "./citation-gate";

const ORG: Scope = { kind: "org", orgId: "10101010-1010-1010-1010-101010101010" };
const ENQUIRY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTIVITY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const LISTING_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const CORRIDOR_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const PACK: GenerativeGroundingPack = {
  entity: "enquiry",
  id: ENQUIRY_ID,
  builtAt: "2026-08-13T00:00:00.000Z",
  rowIds: [ENQUIRY_ID, ACTIVITY_ID, LISTING_ID, CORRIDOR_ID],
  facts: {
    enquiry: {
      id: ENQUIRY_ID,
      contactName: "Alex",
      replyState: "waiting",
      listingId: LISTING_ID,
      corridorId: CORRIDOR_ID,
      lastActivityAt: "2026-08-02T00:00:00.000Z",
    },
    activity: [
      {
        id: ACTIVITY_ID,
        kind: "call",
        occurredAt: "2026-08-02T10:30:00.000Z",
        callOutcome: "spoke_interested",
      },
    ],
  },
};

beforeEach(() => {
  buildGroundingPack.mockReset();
  isBifrostConfigured.mockReset();
  chatCompletion.mockReset();
  buildGroundingPack.mockResolvedValue(PACK);
  isBifrostConfigured.mockReturnValue(false);
});

describe("templateCallPrepPoints", () => {
  it("returns exactly three deterministic points from pack facts", () => {
    const points = templateCallPrepPoints(PACK);
    expect(points).toHaveLength(3);
    expect(points[0]?.text).toContain("Alex");
    expect(points[0]?.text).toContain("waiting");
    expect(points[0]?.citationIds).toEqual([ENQUIRY_ID]);
    expect(points[1]?.text).toContain("call");
    expect(points[1]?.text).toContain("2026-08-02");
    expect(points[1]?.citationIds).toEqual([ACTIVITY_ID]);
    expect(points[2]?.citationIds).toEqual([LISTING_ID]);
  });

  it("soft-degrades when listing attribution is missing", () => {
    const pack: GenerativeGroundingPack = {
      ...PACK,
      rowIds: [ENQUIRY_ID, CORRIDOR_ID],
      facts: {
        enquiry: {
          id: ENQUIRY_ID,
          contactName: null,
          replyState: "called",
          listingId: null,
          corridorId: CORRIDOR_ID,
        },
        activity: [],
      },
    };
    const points = templateCallPrepPoints(pack);
    expect(points).toHaveLength(3);
    expect(points[0]?.text).toContain("the contact");
    expect(points[1]?.text).toContain("No call or message logged yet");
    expect(points[2]?.text).toContain("Corridor is known");
    expect(points[2]?.citationIds).toEqual([CORRIDOR_ID]);
  });
});

describe("formatCallPrepOpenUiLang", () => {
  it("emits document-format CallPrepCard with object literals", () => {
    const points = templateCallPrepPoints(PACK);
    const lang = formatCallPrepOpenUiLang(points);
    expect(lang).toMatch(/^root = CallPrepCard\(\[/);
    expect(lang).toContain('text: "Open with Alex');
    expect(lang).toContain(`citationIds: [${JSON.stringify(ENQUIRY_ID)}]`);
    expect(extractClaimIdsFromOpenUi(lang)).toEqual(
      expect.arrayContaining([ENQUIRY_ID, ACTIVITY_ID, LISTING_ID]),
    );
  });
});

describe("buildCallPrep", () => {
  it("loads the enquiry pack and returns three gated points", async () => {
    const result = await buildCallPrep(ORG, ENQUIRY_ID);

    expect(buildGroundingPack).toHaveBeenCalledWith(ORG, "enquiry", ENQUIRY_ID);
    expect(result.pack).toBe(PACK);
    expect(result.points).toHaveLength(3);
    for (const point of result.points) {
      for (const id of point.citationIds) {
        expect(PACK.rowIds).toContain(id);
      }
    }
    expect(result.openuiLang).toBe(formatCallPrepOpenUiLang(result.points));
  });

  it("uses the deterministic template when Bifrost is unavailable", async () => {
    isBifrostConfigured.mockReturnValue(false);

    const result = await buildCallPrep(ORG, ENQUIRY_ID);

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(result.points).toEqual(templateCallPrepPoints(PACK));
  });

  it("uses Bifrost output when configured and citations are valid", async () => {
    isBifrostConfigured.mockReturnValue(true);
    chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              points: [
                { text: "Confirm budget range.", citationIds: [ENQUIRY_ID] },
                { text: "Ask about move-in timing.", citationIds: [ACTIVITY_ID] },
                { text: "Verify listing fit.", citationIds: [LISTING_ID] },
              ],
            }),
          },
        },
      ],
    });

    const result = await buildCallPrep(ORG, ENQUIRY_ID);

    expect(chatCompletion).toHaveBeenCalledOnce();
    expect(result.points).toEqual([
      { text: "Confirm budget range.", citationIds: [ENQUIRY_ID] },
      { text: "Ask about move-in timing.", citationIds: [ACTIVITY_ID] },
      { text: "Verify listing fit.", citationIds: [LISTING_ID] },
    ]);
  });

  it("falls back to the template when Bifrost returns foreign citations", async () => {
    isBifrostConfigured.mockReturnValue(true);
    chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              points: [
                { text: "Bad cite.", citationIds: ["00000000-0000-0000-0000-000000000000"] },
                { text: "Also bad.", citationIds: [ENQUIRY_ID] },
                { text: "Still bad.", citationIds: [ENQUIRY_ID] },
              ],
            }),
          },
        },
      ],
    });

    const result = await buildCallPrep(ORG, ENQUIRY_ID);

    expect(result.points).toEqual(templateCallPrepPoints(PACK));
  });

  it("falls back to the template when Bifrost fails", async () => {
    isBifrostConfigured.mockReturnValue(true);
    chatCompletion.mockRejectedValue(new Error("bifrost unreachable"));

    const result = await buildCallPrep(ORG, ENQUIRY_ID);

    expect(result.points).toEqual(templateCallPrepPoints(PACK));
  });
});
