// ads-agent/lib/crm/twenty-pipeline.ts

import { callTwentyTool } from "../bifrost/mcp-client";
import { TWENTY_MCP_TOOLS } from "../bifrost/twenty-mcp-tools";
import type { Scope } from "../db/scope-sql";

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

function isConfigured(): boolean {
  return Boolean(process.env.TWENTY_API_KEY?.trim());
}

/**
 * INTERIM CONTAINMENT — remove at S4, not before.
 *
 * Twenty is one shared pipeline today: it is not partitioned by org, so no
 * scoping in this repository can make that data tenant-safe (tenancy spec, Q4
 * resolution). Worse, Twenty's deduplication actively merges contacts across
 * tenant lines in a shared instance, so this is contamination rather than only
 * a read exposure -- which is why the shared instance is never migrated.
 *
 * Containment lives here, in the client, rather than in the routes, so a new
 * call site inherits the block instead of having to remember it. That is what
 * makes it survive the next feature.
 *
 * It throws rather than returning empty: an empty pipeline is
 * indistinguishable from a quiet leak in the surfaces that render it.
 *
 * The end state is one Twenty instance per org
 * (2026-08-12-twenty-tenancy-ownership-design.md, TW1). This guard is removed
 * only once every org has its own.
 */
export function assertPlatformScope(scope: Scope, fn: string): void {
  if (scope.kind !== "platform") {
    throw new Error(
      `${fn} is platform-only: Twenty is one shared pipeline and is not tenant-safe. ` +
        `Removed at S4, once every org has its own instance.`,
    );
  }
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
  if (raw && typeof raw === "object" && Array.isArray((raw as { records?: unknown }).records)) {
    return ((raw as { records: unknown[] }).records).filter(isRawOpportunity);
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

/** List every open opportunity, via the Twenty MCP server. Platform-only. */
export async function listOpportunities(scope: Scope): Promise<Opportunity[]> {
  assertPlatformScope(scope, "listOpportunities");
  if (!isConfigured()) return [];
  try {
    const result = await callTwentyTool(TWENTY_MCP_TOOLS.listOpportunities, { limit: 200 });
    return extractRawOpportunities(result).map(toOpportunity);
  } catch {
    return [];
  }
}

/** Fetch a single opportunity by id via the Twenty MCP server. Platform-only. */
export async function getOpportunity(scope: Scope, id: string): Promise<Opportunity | null> {
  assertPlatformScope(scope, "getOpportunity");
  if (!isConfigured()) return null;
  try {
    const [record] = extractRawOpportunities(
      await callTwentyTool(TWENTY_MCP_TOOLS.getOpportunity, { id }),
    );
    return record ? toOpportunity(record) : null;
  } catch {
    return null;
  }
}

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

/** Advance (or move back) an opportunity's stage. Platform-only. */
export async function updateOpportunityStage(
  scope: Scope,
  id: string,
  stage: PipelineStageValue,
): Promise<UpdateStageResult> {
  assertPlatformScope(scope, "updateOpportunityStage");
  if (!isConfigured()) return { ok: false, error: "Twenty is not configured" };
  try {
    await callTwentyTool(TWENTY_MCP_TOOLS.updateOpportunity, { id, stage });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sum of amountInr across every opportunity. Backs Home's Pipeline Value stat. Platform-only. */
export async function getPipelineValue(scope: Scope): Promise<number> {
  assertPlatformScope(scope, "getPipelineValue");
  const opportunities = await listOpportunities(scope);
  return opportunities.reduce((sum, o) => sum + (o.amountInr ?? 0), 0);
}
