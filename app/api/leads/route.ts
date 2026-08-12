import { NextResponse } from "next/server";
import { qualifyLead } from "@/lib/ai/client";
import { captureEnquiry } from "@/lib/enquiries/capture";
import { foldStep2Answers } from "@/lib/leads/step2-fields";
import type { LeadPayload, NeedType } from "@/lib/whatsapp";

// Node runtime (not edge) so this handler keeps running the AI call and the
// database write to completion even if the client that sent the request gives
// up waiting -- see the design spec's client-abort architecture. Do not forward
// `request`'s own cancellation into qualifyLead or captureEnquiry.
export const runtime = "nodejs";

const NEEDS = new Set<NeedType>(["office", "retail", "lease"]);

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStep2Answers(value: unknown): Record<string, string> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const answers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw.trim()) answers[key] = raw.trim();
  }
  return Object.keys(answers).length > 0 ? answers : undefined;
}

function parseLead(body: unknown): LeadPayload | null {
  if (!isPlainRecord(body)) return null;
  if (typeof body.name !== "string" || typeof body.phone !== "string") return null;
  if (typeof body.brief !== "string" || typeof body.need !== "string") return null;
  if (!NEEDS.has(body.need as NeedType)) return null;
  const name = body.name.trim();
  const phone = body.phone.trim();
  if (!name || !phone) return null;
  const payload: LeadPayload = {
    name,
    phone,
    need: body.need as NeedType,
    brief: body.brief.trim(),
  };
  const step2Answers = parseStep2Answers(body.step2Answers);
  if (step2Answers) payload.step2Answers = step2Answers;
  if (typeof body.propertyName === "string" && body.propertyName.trim()) {
    payload.propertyName = body.propertyName.trim();
  }
  if (typeof body.propertyUrl === "string" && body.propertyUrl.trim()) {
    payload.propertyUrl = body.propertyUrl.trim();
  }
  return payload;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payload = parseLead(raw);
  if (!payload) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const orgId = process.env.GENTLE_SPACE_ORG_ID?.trim() || DEFAULT_ORG_ID;

  const qualification = await qualifyLead({
    need: payload.need,
    step2Answers: payload.step2Answers ?? {},
    notes: payload.brief,
  });

  // Postgres first, always. Twenty is reached later by the ads-agent
  // projection worker, so an outage there cannot lose this enquiry (TW4).
  const captured = await captureEnquiry({
    orgId,
    name: payload.name,
    phone: payload.phone,
    need: payload.need,
    brief: foldStep2Answers(payload.need, payload.step2Answers, payload.brief),
    listingUrl: payload.propertyUrl ?? null,
    listingName: payload.propertyName ?? null,
    tier: qualification.tier,
  });

  // `crm: "pending"` keeps the existing response shape the form already reads,
  // and is now honest: the CRM write has not happened yet and will be done by
  // the projection worker.
  return NextResponse.json({
    ok: true,
    crm: "pending",
    tier: qualification.tier,
    enquiryId: captured.enquiryId,
  });
}
