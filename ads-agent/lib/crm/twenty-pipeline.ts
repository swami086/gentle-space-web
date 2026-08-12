// ads-agent/lib/crm/twenty-pipeline.ts

import { TWENTY_MCP_TOOLS } from "../bifrost/twenty-mcp-tools";
import type { Scope } from "../db/scope-sql";
import { getTwentyClient } from "./twenty-client";

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

/**
 * OpenUI OpportunityCard / OpportunityList row — exactly the six Zod keys in
 * ads-agent/lib/openui/crm-library.ts (positional arity). Used to reshape raw MCP tool
 * payloads before Phase 2 generate so the model cannot dump ~18 CRM fields into
 * OpportunityCard (official OpenUI: positional args map by Zod key order; excess dropped).
 */
export type OpenUiOpportunityCardRow = {
  name: string;
  stage: string;
  tier: OpportunityTier;
  amountLabel: string;
  maskedPhone: string;
  source: string;
};

export function formatAmountLabelInr(amountInr: number | null): string {
  if (amountInr == null) return "";
  return `₹${Math.round(amountInr).toLocaleString("en-IN")}`;
}

export function toOpenUiOpportunityCard(opp: Opportunity): OpenUiOpportunityCardRow {
  return {
    name: opp.name,
    stage: opp.stage,
    tier: opp.tier ?? "UNSCORED",
    amountLabel: formatAmountLabelInr(opp.amountInr),
    maskedPhone: opp.maskedPhone ?? "",
    source: opp.source ?? "",
  };
}

function isRawOpportunity(value: unknown): value is RawOpportunity {
  return Boolean(value && typeof value === "object" && "id" in value && "name" in value && "stage" in value);
}

function extractRawOpportunities(raw: unknown): RawOpportunity[] {
  if (Array.isArray(raw)) return raw.filter(isRawOpportunity);
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.records)) return obj.records.filter(isRawOpportunity);
    const data = obj.data;
    if (data && typeof data === "object") {
      const dataObj = data as Record<string, unknown>;
      if (Array.isArray(dataObj.opportunities)) return dataObj.opportunities.filter(isRawOpportunity);
      if (dataObj.opportunity && isRawOpportunity(dataObj.opportunity)) return [dataObj.opportunity];
    }
  }
  if (isRawOpportunity(raw)) return [raw];
  return [];
}

/**
 * Host-side reshape of Twenty MCP read-tool results for chat (MCP client best practice:
 * keep tool results focused for the model). list_opportunities → array of OpenUI card
 * rows (all records preserved); get_opportunity → one card row or null. Unknown tools
 * pass through unchanged.
 */
export function reshapeTwentyOpportunityToolResult(toolName: string, raw: unknown): unknown {
  if (toolName === TWENTY_MCP_TOOLS.listOpportunities) {
    return extractRawOpportunities(raw).map((r) => toOpenUiOpportunityCard(toOpportunity(r)));
  }
  if (toolName === TWENTY_MCP_TOOLS.getOpportunity) {
    const [first] = extractRawOpportunities(raw);
    return first ? toOpenUiOpportunityCard(toOpportunity(first)) : null;
  }
  return raw;
}

export type LeadSignal = {
  hotCount: number;
  warmCount: number;
  coldCount: number;
  unscoredCount: number;
};

const EMPTY_SIGNAL: LeadSignal = {
  hotCount: 0,
  warmCount: 0,
  coldCount: 0,
  unscoredCount: 0,
};

/**
 * Every read fails soft to an empty board rather than a crashed page, which is
 * the convention these surfaces already had. The difference after
 * consolidation: the failure is logged with the org, so an unprovisioned
 * tenant is visible instead of looking like a tenant with no leads.
 */
async function readOpportunities(scope: Scope): Promise<RawOpportunity[]> {
  const client = await getTwentyClient(scope.orgId);
  return extractRawOpportunities(await client.listOpportunities(200));
}

export async function listOpportunities(scope: Scope): Promise<Opportunity[]> {
  try {
    return (await readOpportunities(scope)).map(toOpportunity);
  } catch (err) {
    console.error("twenty-pipeline: listOpportunities failed", { scope, err });
    return [];
  }
}

export async function getOpportunity(scope: Scope, id: string): Promise<Opportunity | null> {
  try {
    const client = await getTwentyClient(scope.orgId);
    const [record] = extractRawOpportunities(await client.getOpportunity(id));
    return record ? toOpportunity(record) : null;
  } catch (err) {
    console.error("twenty-pipeline: getOpportunity failed", { scope, id, err });
    return null;
  }
}

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

export async function updateOpportunityStage(
  scope: Scope,
  id: string,
  stage: PipelineStageValue,
): Promise<UpdateStageResult> {
  try {
    const client = await getTwentyClient(scope.orgId);
    await client.updateOpportunityStage(id, stage);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getPipelineValue(scope: Scope): Promise<number> {
  const opportunities = await listOpportunities(scope);
  return opportunities.reduce((sum, o) => sum + (o.amountInr ?? 0), 0);
}

/**
 * Absorbed from the deleted lib/connectors/twenty.ts, which carried a second
 * copy of baseUrl() reading TWENTY_BASE_URL and therefore could not be made
 * tenant-aware (tenancy spec §6).
 */
export async function fetchLeadSignal(scope: Scope): Promise<LeadSignal> {
  const signal = { ...EMPTY_SIGNAL };
  try {
    for (const opp of await readOpportunities(scope)) {
      switch (opp.tier) {
        case "HOT":
          signal.hotCount++;
          break;
        case "WARM":
          signal.warmCount++;
          break;
        case "COLD":
          signal.coldCount++;
          break;
        default:
          signal.unscoredCount++;
          break;
      }
    }
    return signal;
  } catch (err) {
    console.error("twenty-pipeline: fetchLeadSignal failed", { scope, err });
    return EMPTY_SIGNAL;
  }
}
