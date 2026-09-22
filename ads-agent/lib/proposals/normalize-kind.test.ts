import { describe, expect, it } from "vitest";
import { executableProposalKind, isSpendChangeKind } from "./normalize-kind";

describe("executableProposalKind", () => {
  it("maps agent dotted kinds to executor snake_case", () => {
    expect(executableProposalKind("campaign.create")).toBe("create_campaign");
    expect(executableProposalKind("campaign.pause")).toBe("pause");
    expect(executableProposalKind("campaign.budget_change")).toBe("budget_change");
  });

  it("leaves snake_case and unknown kinds unchanged", () => {
    expect(executableProposalKind("pause")).toBe("pause");
    expect(executableProposalKind("enquiry.requirement_update")).toBe(
      "enquiry.requirement_update",
    );
  });
});

describe("isSpendChangeKind", () => {
  it("detects budget change in both vocabularies", () => {
    expect(isSpendChangeKind("budget_change")).toBe(true);
    expect(isSpendChangeKind("campaign.budget_change")).toBe(true);
    expect(isSpendChangeKind("pause")).toBe(false);
  });
});
