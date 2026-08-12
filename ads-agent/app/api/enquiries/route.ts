import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { createContact } from "@/lib/db/contacts";
import { countEnquiriesByState, createEnquiry, listEnquiries, REPLY_STATES } from "@/lib/db/enquiries";
import { addMessage } from "@/lib/db/enquiry-messages";
import { createRevision } from "@/lib/db/enquiry-requirements";
import { withTenantTransaction } from "@/lib/db/tx";
import type { ReplyState } from "@/lib/db/enquiries";

export async function GET(req: Request) {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  const { scope } = access;

  const stateParam = new URL(req.url).searchParams.get("state");
  if (stateParam && !REPLY_STATES.includes(stateParam as ReplyState)) {
    return NextResponse.json(
      { error: `state must be one of ${REPLY_STATES.join(", ")}` },
      { status: 400 },
    );
  }

  const [enquiries, counts] = await Promise.all([
    listEnquiries(scope, stateParam ? { replyState: stateParam as ReplyState } : {}),
    countEnquiriesByState(scope),
  ]);
  return NextResponse.json({ enquiries, counts });
}

type CreateBody = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  brief?: unknown;
  listingUrl?: unknown;
};

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!name || !phone) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400 });
  }
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const listingUrl =
    typeof body.listingUrl === "string" && body.listingUrl.trim() ? body.listingUrl.trim() : null;

  // One transaction: the contact, the enquiry and the first message either all
  // exist or none do. Twenty is not involved on this path at all.
  const created = await withTenantTransaction(scope, async (client) => {
    const contact = await createContact(scope, { name, phone, email }, client);
    const enquiry = await createEnquiry(
      scope,
      { contactId: contact.id, contactName: name, contactPhone: phone, contactEmail: email, listingUrl },
      client,
    );
    if (brief) {
      await addMessage(
        scope,
        { enquiryId: enquiry.id, channel: "web_form", body: brief },
        client,
      );
      await createRevision(
        scope,
        { enquiryId: enquiry.id, source: "web_form", proposed: {} },
        client,
      );
    }
    return { enquiryId: enquiry.id, contactId: contact.id };
  });

  return NextResponse.json(created, { status: 201 });
}
