import { parseInboundText } from "./parser";

export type InboundRouteResult =
  | { action: "approve_code"; code: string }
  | { action: "pause_own_listings" }
  | { action: "opt_out" }
  | { action: "block_new_proposals" }
  | { action: "allow_proposals" }
  | {
      action: "create_listing";
      dailyMajor: number;
      sector: "residential" | "commercial_office";
      goal: string;
    }
  | { action: "ignore" };

/** Unset or different from the webhook's business phone number id → renter enquiry path. */
export function isConsultantServiceNumber(
  phoneNumberId: string | null,
  configured: string | undefined,
): boolean {
  const expected = configured?.trim();
  if (!expected || !phoneNumberId) return false;
  return phoneNumberId === expected;
}

export function routeInbound(input: { orgId: string; text: string }): InboundRouteResult {
  void input.orgId;
  const parsed = parseInboundText(input.text);

  switch (parsed.type) {
    case "code":
      return { action: "approve_code", code: parsed.code };
    case "pause":
      return { action: "pause_own_listings" };
    case "stop":
      return { action: "opt_out" };
    case "leased":
      return { action: "block_new_proposals" };
    case "resume":
      return { action: "allow_proposals" };
    case "create":
      return {
        action: "create_listing",
        dailyMajor: parsed.dailyMajor,
        sector: parsed.sector,
        goal: parsed.goal,
      };
    default:
      return { action: "ignore" };
  }
}

/** Wrong-code lock threshold; storage of counts lives outside this module. */
export function noteWrongCode(previousCount: number): { locked: true } | Record<string, never> {
  if (previousCount + 1 >= 5) {
    return { locked: true };
  }
  return {};
}
