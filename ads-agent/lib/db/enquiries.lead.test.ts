import { describe, expect, it } from "vitest";

import { classifyInboundLead } from "./enquiries";

describe("classifyInboundLead", () => {
  it("does not store test leads and alerts owner only", () => {
    expect(
      classifyInboundLead({ formId: "f1", googleAssetId: null, isTest: true }),
    ).toEqual({ store: false, alertOwnerOnly: true });
  });

  it("ignores leads with no form or asset id", () => {
    expect(
      classifyInboundLead({ formId: null, googleAssetId: null, isTest: false }),
    ).toEqual({ store: false, alertOwnerOnly: false });
  });

  it("stores real leads when a form id is present", () => {
    expect(
      classifyInboundLead({ formId: "f1", googleAssetId: null, isTest: false }),
    ).toEqual({ store: true, alertOwnerOnly: false });
  });

  it("stores real leads when a google asset id is present", () => {
    expect(
      classifyInboundLead({ formId: null, googleAssetId: "asset-1", isTest: false }),
    ).toEqual({ store: true, alertOwnerOnly: false });
  });
});
