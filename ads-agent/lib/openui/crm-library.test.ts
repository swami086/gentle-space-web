import { describe, expect, it } from "vitest";
import { OpportunityCardView, OpportunityListView, StageChangeConfirmView, crmLibrary } from "./crm-library";

describe("crmLibrary", () => {
  it("registers OpportunityCard, OpportunityList, and StageChangeConfirm", () => {
    expect(Object.keys(crmLibrary.components).sort()).toEqual(
      ["OpportunityCard", "OpportunityList", "StageChangeConfirm"].sort(),
    );
  });
});

describe("OpportunityCardView", () => {
  it("renders without throwing given null optional fields (OpenUI streaming safety)", () => {
    expect(() =>
      OpportunityCardView({ name: "Priya Sharma", stage: "SHORTLIST", tier: null, amountLabel: null, maskedPhone: null, source: null }),
    ).not.toThrow();
  });
});

describe("OpportunityListView", () => {
  it("renders each opportunity's name", () => {
    const tree = OpportunityListView({
      opportunities: [
        { name: "Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "₹15,000", maskedPhone: "+91 8XXXXX-1234", source: "WhatsApp" },
        { name: "Rohan Mehta", stage: "TOUR", tier: "HOT", amountLabel: null, maskedPhone: null, source: null },
      ],
    });
    expect(JSON.stringify(tree)).toContain("Priya Sharma");
    expect(JSON.stringify(tree)).toContain("Rohan Mehta");
  });

  it("renders an empty-state message for zero opportunities", () => {
    const tree = OpportunityListView({ opportunities: [] });
    expect(JSON.stringify(tree)).toContain("No opportunities found");
  });
});

describe("StageChangeConfirmView", () => {
  it("renders the from/to stage labels", () => {
    const tree = StageChangeConfirmView({ opportunityName: "Priya Sharma", fromStage: "Qualified", toStage: "Tour" });
    const json = JSON.stringify(tree);
    expect(json).toContain("Priya Sharma");
    expect(json).toContain("Qualified");
    expect(json).toContain("Tour");
  });
});
