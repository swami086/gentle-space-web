import type { LeadPayload } from "@/lib/whatsapp";
import { foldStep2Answers } from "@/lib/leads/step2-fields";
import type { LeadQualification } from "@/lib/leads/qualify-types";

export type TwentyCrmStatus = "created" | "skipped" | "failed";

export type TwentyCreateLeadResult = {
  status: TwentyCrmStatus;
  personId?: string;
  opportunityId?: string;
  error?: string;
};

function baseUrl(): string {
  return (process.env.TWENTY_BASE_URL ?? "http://localhost:3020").replace(/\/$/, "");
}

export function isTwentyConfigured(): boolean {
  return Boolean(process.env.TWENTY_API_KEY?.trim() && baseUrl());
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts[0] ?? "Unknown";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "-";
  return { firstName, lastName };
}

function digitsPhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function extractId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const rec = json as Record<string, unknown>;
  if (typeof rec.id === "string") return rec.id;
  const data = rec.data;
  if (data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string") {
    return (data as { id: string }).id;
  }
  return undefined;
}

async function twentyPost(
  path: string,
  body: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = process.env.TWENTY_API_KEY!.trim();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    return { ok: false, error: `Twenty ${path} ${res.status}: ${text.slice(0, 200)}` };
  }
  const id = extractId(json);
  if (!id) return { ok: false, error: `Twenty ${path}: missing id in response` };
  return { ok: true, id };
}

/**
 * Create Person + Opportunity. Field names must match Twenty workspace
 * (see infra/twenty/README.md, populated by the human bootstrap task). Stage
 * label defaults to "New brief". Step 2 structured answers fold into `brief`
 * via foldStep2Answers rather than becoming separate CRM fields.
 */
export async function createLeadInTwenty(
  payload: LeadPayload,
  qualification: LeadQualification,
): Promise<TwentyCreateLeadResult> {
  if (!isTwentyConfigured()) return { status: "skipped" };

  const { firstName, lastName } = splitName(payload.name);
  const phone = digitsPhone(payload.phone);

  try {
    const person = await twentyPost("/rest/people", {
      name: { firstName, lastName },
      phones: {
        primaryPhoneNumber: phone.replace(/^\+?91/, "").replace(/^\+/, "") || phone,
        primaryPhoneCountryCode: "IN",
        primaryPhoneCallingCode: "+91",
      },
    });
    if (!person.ok) return { status: "failed", error: person.error };

    const opportunityBody: Record<string, unknown> = {
      name: `${payload.need}: ${firstName} ${lastName}`.slice(0, 120),
      pointOfContactId: person.id,
      need: payload.need,
      brief: foldStep2Answers(payload.need, payload.step2Answers, payload.brief),
      source: "website",
      stage: "New brief",
      tier: qualification.tier,
      cheatSheet: qualification.cheatSheet,
    };
    if (payload.propertyUrl) opportunityBody.listingUrl = payload.propertyUrl.trim();
    if (payload.propertyName) opportunityBody.listingName = payload.propertyName.trim();

    const opp = await twentyPost("/rest/opportunities", opportunityBody);
    if (!opp.ok) return { status: "failed", personId: person.id, error: opp.error };

    return { status: "created", personId: person.id, opportunityId: opp.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  }
}
