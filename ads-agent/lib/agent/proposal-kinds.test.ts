import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_PROPOSAL_KINDS,
  PERFORMANCE_PROPOSAL_KINDS,
  isAllowedProposalKind,
} from "./proposal-kinds";

describe("proposal-kinds", () => {
  it("exports performance kinds (pause only)", () => {
    expect(PERFORMANCE_PROPOSAL_KINDS).toEqual(["campaign.pause"]);
  });

  it("exports campaign kinds (create and budget_change only)", () => {
    expect(CAMPAIGN_PROPOSAL_KINDS).toEqual([
      "campaign.create",
      "campaign.budget_change",
    ]);
  });

  it("performance accepts pause only", () => {
    expect(isAllowedProposalKind("performance", "campaign.pause")).toBe(true);
    expect(isAllowedProposalKind("performance", "campaign.create")).toBe(
      false,
    );
    expect(
      isAllowedProposalKind("performance", "campaign.budget_change"),
    ).toBe(false);
  });

  it("campaign accepts create and budget_change only", () => {
    expect(isAllowedProposalKind("campaign", "campaign.create")).toBe(true);
    expect(isAllowedProposalKind("campaign", "campaign.budget_change")).toBe(
      true,
    );
    expect(isAllowedProposalKind("campaign", "campaign.pause")).toBe(false);
  });

  it("cross-profile rejects foreign kinds", () => {
    for (const kind of CAMPAIGN_PROPOSAL_KINDS) {
      expect(isAllowedProposalKind("performance", kind)).toBe(false);
    }
    for (const kind of PERFORMANCE_PROPOSAL_KINDS) {
      expect(isAllowedProposalKind("campaign", kind)).toBe(false);
    }
  });
});
