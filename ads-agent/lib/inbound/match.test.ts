import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scope } from "../db/scope-sql";

const {
  normalizeToE164,
  findContactByPhone,
  findEnquiryByReplyToken,
  findOpenEnquiryForContact,
  createContact,
  createEnquiry,
  getContactById,
} = vi.hoisted(() => ({
  normalizeToE164: vi.fn(),
  findContactByPhone: vi.fn(),
  findEnquiryByReplyToken: vi.fn(),
  findOpenEnquiryForContact: vi.fn(),
  createContact: vi.fn(),
  createEnquiry: vi.fn(),
  getContactById: vi.fn(),
}));

vi.mock("./phone", () => ({ normalizeToE164 }));
vi.mock("../db/contacts", () => ({
  createContact,
  findContactByPhone,
  getContactById,
}));
vi.mock("../db/enquiries", () => ({
  createEnquiry,
  findEnquiryByReplyToken,
  findOpenEnquiryForContact,
}));

import type { MatchInput, MatchResult } from "./match";
import { matchOrCreateEnquiry } from "./match";

const scope: Scope = { kind: "org", orgId: "org-platform" };

const existingEnquiry = {
  id: "enq-1",
  contactId: "contact-1",
} as unknown as MatchResult["enquiry"];

const existingContact = {
  id: "contact-1",
  name: "Asha Rao",
  phone: "+919800000000",
  email: "asha@example.com",
} as unknown as MatchResult["contact"];

beforeEach(() => {
  for (const fn of [
    normalizeToE164,
    findContactByPhone,
    findEnquiryByReplyToken,
    findOpenEnquiryForContact,
    createContact,
    createEnquiry,
    getContactById,
  ]) {
    fn.mockReset();
  }
});

describe("matchOrCreateEnquiry (email)", () => {
  it("reuses an existing enquiry when the mailbox hash matches", async () => {
    findEnquiryByReplyToken.mockResolvedValue(existingEnquiry);
    getContactById.mockResolvedValue(existingContact);

    const input: MatchInput = {
      channel: "email",
      mailboxHash: "reply-token-1",
      fromName: "Asha Rao",
      fromEmail: "asha@example.com",
    };

    const result = await matchOrCreateEnquiry(scope, input);

    expect(findEnquiryByReplyToken).toHaveBeenCalledWith(scope, "reply-token-1");
    expect(getContactById).toHaveBeenCalledWith(scope, "contact-1");
    expect(createContact).not.toHaveBeenCalled();
    expect(createEnquiry).not.toHaveBeenCalled();
    expect(result).toEqual({
      enquiry: existingEnquiry,
      contact: existingContact,
      created: false,
    });
  });

  it("creates a new contact and enquiry when there is no hash", async () => {
    const createdContact = {
      id: "contact-9",
      name: "Asha Rao",
      phone: null,
      email: "asha@example.com",
    };
    const createdEnquiry = {
      id: "enq-9",
      contactId: "contact-9",
    };
    createContact.mockResolvedValue(createdContact);
    createEnquiry.mockResolvedValue(createdEnquiry);

    const input: MatchInput = {
      channel: "email",
      mailboxHash: null,
      fromName: "Asha Rao",
      fromEmail: "asha@example.com",
    };

    const result = await matchOrCreateEnquiry(scope, input);

    expect(findEnquiryByReplyToken).not.toHaveBeenCalled();
    expect(createContact).toHaveBeenCalledWith(scope, {
      name: "Asha Rao",
      phone: null,
      email: "asha@example.com",
    });
    expect(createEnquiry).toHaveBeenCalledWith(scope, {
      contactId: "contact-9",
      contactName: "Asha Rao",
      contactPhone: null,
      contactEmail: "asha@example.com",
    });
    expect(result).toEqual({
      enquiry: createdEnquiry,
      contact: createdContact,
      created: true,
    });
  });
});

describe("matchOrCreateEnquiry (whatsapp)", () => {
  it("reuses the newest open enquiry for an existing contact", async () => {
    normalizeToE164.mockReturnValue("+919800000000");
    findContactByPhone.mockResolvedValue(existingContact);
    findOpenEnquiryForContact.mockResolvedValue(existingEnquiry);

    const input: MatchInput = {
      channel: "whatsapp",
      fromPhoneRaw: " 98 0000 0000 ",
      profileName: "Asha Rao",
    };

    const result = await matchOrCreateEnquiry(scope, input);

    expect(normalizeToE164).toHaveBeenCalledWith(" 98 0000 0000 ", "IN");
    expect(findContactByPhone).toHaveBeenCalledWith(scope, "+919800000000");
    expect(findOpenEnquiryForContact).toHaveBeenCalledWith(scope, "contact-1");
    expect(createContact).not.toHaveBeenCalled();
    expect(createEnquiry).not.toHaveBeenCalled();
    expect(result).toEqual({
      enquiry: existingEnquiry,
      contact: existingContact,
      created: false,
    });
  });

  it("creates a new contact and enquiry when there is no existing contact", async () => {
    normalizeToE164.mockReturnValue("+919800000000");
    findContactByPhone.mockResolvedValue(null);
    const createdContact = {
      id: "contact-2",
      name: "Asha Rao",
      phone: "+919800000000",
      email: null,
    };
    const createdEnquiry = {
      id: "enq-2",
      contactId: "contact-2",
    };
    createContact.mockResolvedValue(createdContact);
    createEnquiry.mockResolvedValue(createdEnquiry);

    const input: MatchInput = {
      channel: "whatsapp",
      fromPhoneRaw: "9800000000",
      profileName: "Asha Rao",
    };

    const result = await matchOrCreateEnquiry(scope, input);

    expect(normalizeToE164).toHaveBeenCalledWith("9800000000", "IN");
    expect(findContactByPhone).toHaveBeenCalledWith(scope, "+919800000000");
    expect(createContact).toHaveBeenCalledWith(scope, {
      name: "Asha Rao",
      phone: "+919800000000",
      email: null,
    });
    expect(createEnquiry).toHaveBeenCalledWith(scope, {
      contactId: "contact-2",
      contactName: "Asha Rao",
      contactPhone: "+919800000000",
      contactEmail: null,
    });
    expect(result).toEqual({
      enquiry: createdEnquiry,
      contact: createdContact,
      created: true,
    });
  });
});
