import { withTenantTransaction } from "../db/tenant-tx";

export type CaptureEnquiryInput = {
  orgId: string;
  name: string;
  phone: string;
  email?: string | null;
  need: string;
  brief: string;
  listingUrl?: string | null;
  listingName?: string | null;
  tier: string;
};

export type CapturedEnquiry = {
  enquiryId: string;
  contactId: string;
  messageId: string;
};

/**
 * The marketing site's capture path. Postgres is the system of record and
 * Twenty is a projection (BD6, reversed 2026-08-12): this function does not
 * call Twenty, and the ads-agent projection worker creates the person and
 * opportunity afterwards. A Twenty outage therefore delays enrichment instead
 * of losing the enquiry, which is what the old synchronous
 * createLeadInTwenty() could not promise.
 *
 * Gentle Space is itself a tenant (TW7), so orgId is a real tenant id and not
 * a special platform path.
 */
export async function captureEnquiry(input: CaptureEnquiryInput): Promise<CapturedEnquiry> {
  return withTenantTransaction(input.orgId, async (client) => {
    const contact = await client.query<{ id: string }>(
      `INSERT INTO adsagent.contacts (org_id, name, phone, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.orgId, input.name, input.phone, input.email ?? null],
    );
    const contactId = contact.rows[0].id;

    const enquiry = await client.query<{ id: string }>(
      `INSERT INTO adsagent.enquiries
         (org_id, contact_id, listing_url, contact_name, contact_phone, contact_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.orgId,
        contactId,
        input.listingUrl ?? null,
        input.name,
        input.phone,
        input.email ?? null,
      ],
    );
    const enquiryId = enquiry.rows[0].id;

    const message = await client.query<{ id: string }>(
      `INSERT INTO adsagent.enquiry_messages
         (org_id, enquiry_id, channel, body, received_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING id`,
      [input.orgId, enquiryId, "web_form", input.brief],
    );

    // The form's structured answers are a *proposal* about the requirement,
    // not the requirement: a human confirms them like any other extraction
    // (C3). listingName and tier travel here so nothing captured is lost
    // before the projection worker reads it.
    await client.query(
      `INSERT INTO adsagent.enquiry_requirement_revisions
         (org_id, enquiry_id, source, proposed)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        input.orgId,
        enquiryId,
        "web_form",
        JSON.stringify({
          need: input.need,
          tier: input.tier,
          listingName: input.listingName ?? null,
        }),
      ],
    );

    return { enquiryId, contactId, messageId: message.rows[0].id };
  });
}
