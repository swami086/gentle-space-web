import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../db/tenant-tx", () => ({
  withTenantTransaction: async (_orgId: string, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { captureEnquiry } from "./capture";

beforeEach(() => {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
    .mockResolvedValueOnce({ rows: [{ id: "enq-1" }] })
    .mockResolvedValueOnce({ rows: [{ id: "msg-1" }] })
    .mockResolvedValueOnce({ rows: [{ id: "rev-1" }] });
});

const input = {
  orgId: "org-gentle-space",
  name: "Asha Rao",
  phone: "+919800000000",
  need: "office",
  brief: "38 desks in HSR, move in by September",
  listingUrl: "https://gentlespace.in/spaces/hsr-1",
  listingName: "HSR Workspace One",
  tier: "hot",
};

describe("captureEnquiry", () => {
  it("commits the contact, enquiry, message and revision in one transaction", async () => {
    await expect(captureEnquiry(input)).resolves.toEqual({
      enquiryId: "enq-1",
      contactId: "contact-1",
      messageId: "msg-1",
    });

    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("INSERT INTO adsagent.contacts");
    expect(statements[1]).toContain("INSERT INTO adsagent.enquiries");
    expect(statements[2]).toContain("INSERT INTO adsagent.enquiry_messages");
    expect(statements[3]).toContain("INSERT INTO adsagent.enquiry_requirement_revisions");
  });

  it("starts the contact pending so the projection worker enriches it later", async () => {
    await captureEnquiry(input);
    expect(String(query.mock.calls[0][0])).not.toContain("twenty_person_id");
  });

  it("labels the first message as coming via the website form (B4)", async () => {
    await captureEnquiry(input);
    expect(query.mock.calls[2][1]).toContain("web_form");
  });

  it("records the form's own answers as a web_form revision, not as the requirement", async () => {
    await captureEnquiry(input);
    expect(query.mock.calls[3][1]).toContain("web_form");
    expect(query.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(
      "INSERT INTO adsagent.enquiry_requirements",
    );
  });
});
