import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getEnquiryById } from "@/lib/db/enquiries";
import { listActivities } from "@/lib/db/enquiry-activities";
import { listMessages } from "@/lib/db/enquiry-messages";
import { getRequirement } from "@/lib/db/enquiry-requirements";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  // Scoped read, so another tenant's id and a nonexistent id are the same
  // null. 404 either way: a 403 would confirm the row exists.
  const enquiry = await getEnquiryById(scope, id);
  if (!enquiry) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [messages, activities, requirement] = await Promise.all([
    listMessages(scope, id),
    listActivities(scope, id),
    getRequirement(scope, id),
  ]);
  return NextResponse.json({ enquiry, messages, activities, requirement });
}
