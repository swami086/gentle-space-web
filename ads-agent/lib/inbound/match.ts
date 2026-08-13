import type { Scope } from "../db/scope-sql";
import type { Enquiry } from "../db/enquiries";
import {
  createEnquiry,
  findEnquiryByReplyToken,
  findOpenEnquiryForContact,
} from "../db/enquiries";
import type { Contact } from "../db/contacts";
import { createContact, findContactByPhone, getContactById } from "../db/contacts";
import { normalizeToE164 } from "./phone";

export type MatchInput =
  | {
      channel: "email";
      mailboxHash: string | null;
      fromName: string;
      fromEmail: string;
    }
  | {
      channel: "whatsapp";
      fromPhoneRaw: string;
      profileName?: string | null;
    };

export type MatchResult = {
  enquiry: Enquiry;
  contact: Contact | null;
  created: boolean;
};

export async function matchOrCreateEnquiry(
  scope: Scope,
  input: MatchInput,
): Promise<MatchResult> {
  if (input.channel === "email") {
    const token = (input.mailboxHash ?? "").trim();
    if (token) {
      const existing = await findEnquiryByReplyToken(scope, token);
      if (existing) {
        const contact =
          existing.contactId != null ? await getContactById(scope, existing.contactId) : null;
        return { enquiry: existing, contact, created: false };
      }
    }

    const contact = await createContact(scope, {
      name: input.fromName,
      phone: null,
      email: input.fromEmail,
    });
    const enquiry = await createEnquiry(scope, {
      contactId: contact.id,
      contactName: contact.name,
      contactPhone: contact.phone,
      contactEmail: contact.email,
    });
    return { enquiry, contact, created: true };
  }

  // whatsapp
  const phone = normalizeToE164(input.fromPhoneRaw, "IN");
  const displayName = input.profileName ?? "WhatsApp contact";

  let contact: Contact | null = null;
  if (phone) {
    contact = await findContactByPhone(scope, phone);
  }

  if (contact) {
    const existing = await findOpenEnquiryForContact(scope, contact.id);
    if (existing) {
      return { enquiry: existing, contact, created: false };
    }
  }

  if (!contact) {
    contact = await createContact(scope, {
      name: displayName,
      phone,
      email: null,
    });
  }

  const enquiry = await createEnquiry(scope, {
    contactId: contact.id,
    contactName: contact.name,
    contactPhone: phone ?? contact.phone,
    contactEmail: contact.email,
  });

  return { enquiry, contact, created: true };
}

