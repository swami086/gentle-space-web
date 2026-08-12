import type { Scope } from "../db/scope-sql";
import { assertPlatformScope } from "../crm/twenty-pipeline";

type LeadSignal = { hotCount: number; warmCount: number; coldCount: number; unscoredCount: number };

const EMPTY_SIGNAL: LeadSignal = { hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 };

function baseUrl(): string {
  return (process.env.TWENTY_BASE_URL ?? "http://localhost:3020").replace(/\/$/, "");
}

function extractOpportunities(json: unknown): { tier?: unknown }[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return [];
  const opportunities = (data as Record<string, unknown>).opportunities;
  return Array.isArray(opportunities) ? (opportunities as { tier?: unknown }[]) : [];
}

/**
 * Read-only, account-wide lead-tier counts. Twenty has no corridor/UTM field
 * yet, so this cannot attribute leads to a specific campaign — callers
 * record it with campaignId: null, matching the spec's "not every lead is
 * attributable yet" note. Platform-only.
 */
export async function fetchLeadSignal(scope: Scope): Promise<LeadSignal> {
  assertPlatformScope(scope, "fetchLeadSignal");
  const apiKey = process.env.TWENTY_API_KEY?.trim();
  if (!apiKey) return EMPTY_SIGNAL;

  try {
    const res = await fetch(`${baseUrl()}/rest/opportunities?limit=200`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return EMPTY_SIGNAL;

    const opportunities = extractOpportunities(await res.json());
    const signal = { ...EMPTY_SIGNAL };
    for (const opp of opportunities) {
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
        case "UNSCORED":
          signal.unscoredCount++;
          break;
        default:
          if (opp.tier == null) signal.unscoredCount++;
          break;
      }
    }
    return signal;
  } catch {
    return EMPTY_SIGNAL;
  }
}
