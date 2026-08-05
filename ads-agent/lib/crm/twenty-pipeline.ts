// ads-agent/lib/crm/twenty-pipeline.ts

/** The real, configured Twenty pipeline (infra/twenty/README.md "Opportunity stages (API values)")
 * — the single source of truth for every stage list in this app. Corrects the Pencil mock's guessed
 * 4-column "New Brief/Qualified/Proposal/Won" board (see plan's Global Constraints). */
export const PIPELINE_STAGES = [
  { value: "NEW_BRIEF", label: "New Brief" },
  { value: "SHORTLIST", label: "Shortlist" },
  { value: "TOUR", label: "Tour" },
  { value: "NEGOTIATE", label: "Negotiate" },
  { value: "LEGAL", label: "Legal" },
  { value: "HANDOVER", label: "Handover" },
  { value: "RENEWAL", label: "Renewal" },
] as const;

export type PipelineStageValue = (typeof PIPELINE_STAGES)[number]["value"];

export type OpportunityTier = "HOT" | "WARM" | "COLD" | "UNSCORED";

export type Opportunity = {
  id: string;
  name: string;
  stage: string;
  tier: OpportunityTier | null;
  amountInr: number | null;
  contactName: string | null;
  maskedPhone: string | null;
  source: string | null;
  listingName: string | null;
  createdAt: string;
};

type RawAmount = { amountMicros: number; currencyCode?: string } | null | undefined;
type RawPointOfContact =
  | { name?: { firstName?: string; lastName?: string } | null; phones?: { primaryPhoneNumber?: string; primaryPhoneCallingCode?: string } | null }
  | null
  | undefined;

type RawOpportunity = {
  id: string;
  name: string;
  stage: string;
  tier?: string | null;
  amount?: RawAmount;
  pointOfContact?: RawPointOfContact;
  source?: string | null;
  listingName?: string | null;
  createdAt: string;
};

function baseUrl(): string {
  return (process.env.TWENTY_BASE_URL ?? "http://localhost:3020").replace(/\/$/, "");
}

function isConfigured(): boolean {
  return Boolean(process.env.TWENTY_API_KEY?.trim());
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.TWENTY_API_KEY!.trim()}` };
}

/** Masks a phone number to show only the country code, the mobile number's first digit, and its
 * last 4 digits, e.g. "+918800001234" -> "+91 8XXXXX-1234". Assumes a 10-digit mobile number (this
 * codebase's existing India-only convention — lib/crm/twenty.ts hardcodes "+91" the same way). No
 * masking utility existed anywhere in this codebase before this function (verified via Torbit +
 * Grep) — this is new logic, not a reuse. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10) return "—";
  const mobile = digits.slice(-10);
  const countryCode = digits.slice(0, digits.length - 10) || "91";
  return `+${countryCode} ${mobile[0]}XXXXX-${mobile.slice(-4)}`;
}

function toAmountInr(amount: RawAmount): number | null {
  if (!amount) return null;
  return amount.amountMicros / 1_000_000;
}

function toContact(poc: RawPointOfContact): { contactName: string | null; maskedPhone: string | null } {
  if (!poc) return { contactName: null, maskedPhone: null };
  const first = poc.name?.firstName ?? "";
  const last = poc.name?.lastName ?? "";
  const contactName = [first, last].filter(Boolean).join(" ") || null;
  const phone = poc.phones?.primaryPhoneNumber;
  const callingCode = poc.phones?.primaryPhoneCallingCode ?? "+91";
  const maskedPhone = phone ? maskPhone(`${callingCode}${phone}`) : null;
  return { contactName, maskedPhone };
}

function toOpportunity(raw: RawOpportunity): Opportunity {
  const { contactName, maskedPhone } = toContact(raw.pointOfContact);
  return {
    id: raw.id,
    name: raw.name,
    stage: raw.stage,
    tier: (raw.tier as OpportunityTier | undefined) ?? null,
    amountInr: toAmountInr(raw.amount),
    contactName,
    maskedPhone,
    source: raw.source ?? null,
    listingName: raw.listingName ?? null,
    createdAt: raw.createdAt,
  };
}

/** List every open opportunity. Twenty's REST list endpoint shape mirrors the one
 * ads-agent/lib/connectors/twenty.ts's fetchLeadSignal() already reads ({ data: { opportunities: [] } }).
 * Fails soft (empty array) on missing config or a non-ok response — same fail-soft convention as
 * fetchLeadSignal, so a Twenty outage degrades the board to "no leads" rather than a crashed page. */
export async function listOpportunities(): Promise<Opportunity[]> {
  if (!isConfigured()) return [];
  try {
    const res = await fetch(`${baseUrl()}/rest/opportunities?limit=200`, { headers: authHeaders() });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { opportunities?: RawOpportunity[] } };
    const opportunities = json.data?.opportunities ?? [];
    return opportunities.map(toOpportunity);
  } catch {
    return [];
  }
}

/** Fetch a single opportunity by id. NOTE (see plan's Global Constraints — Twenty REST semantics
 * assumption): GET-by-id has no existing precedent in this repo; verify this response envelope
 * against the local Twenty instance during this task's manual-verification step. */
export async function getOpportunity(id: string): Promise<Opportunity | null> {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${baseUrl()}/rest/opportunities/${id}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { opportunity?: RawOpportunity } };
    const opportunity = json.data?.opportunity;
    return opportunity ? toOpportunity(opportunity) : null;
  } catch {
    return null;
  }
}

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

/** Advance (or move back) an opportunity's stage. NOTE (see plan's Global Constraints): PATCH has no
 * existing precedent in this repo either — verify against the local Twenty instance. */
export async function updateOpportunityStage(
  id: string,
  stage: PipelineStageValue,
): Promise<UpdateStageResult> {
  if (!isConfigured()) return { ok: false, error: "Twenty is not configured" };
  try {
    const res = await fetch(`${baseUrl()}/rest/opportunities/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) return { ok: false, error: `Twenty PATCH opportunities/${id} ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sum of amountInr across every opportunity currently returned by listOpportunities() — backs Home's
 * Pipeline Value stat. Twenty has no separate "closed/lost" flag surfaced yet, so this is "everything
 * the pipeline query returns," matching fetchLeadSignal's own "account-wide, no attribution yet" note. */
export async function getPipelineValue(): Promise<number> {
  const opportunities = await listOpportunities();
  return opportunities.reduce((sum, o) => sum + (o.amountInr ?? 0), 0);
}
