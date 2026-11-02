export type CopyCheckResult = { ok: true } | { ok: false; reason: string };

const RENT_RANGE =
  /\$[\d,]+(?:\.\d+)?\s*(?:to|-)\s*\$[\d,]+(?:\.\d+)?/i;

const RENT_FROM = /\bfrom\s+\$/i;

const FIXED_RENT =
  /(?:\$[\d,]+(?:\.\d+)?|AUD\s*[\d,]+(?:\.\d+)?)[\s\S]{0,48}?\b(?:per\s+)?(?:week|month)\b/i;

export function checkAustraliaCopy(copy: string): CopyCheckResult {
  if (/\bPOA\b/i.test(copy)) {
    return { ok: false, reason: "Lease ads must state a fixed rent, not POA" };
  }

  if (RENT_RANGE.test(copy)) {
    return { ok: false, reason: "Lease ads must state one fixed rent, not a range" };
  }

  if (RENT_FROM.test(copy)) {
    return {
      ok: false,
      reason: "Lease ads must state one fixed rent, not a starting price",
    };
  }

  if (!FIXED_RENT.test(copy)) {
    return {
      ok: false,
      reason: "Lease ads must include one fixed rent with week or month",
    };
  }

  return { ok: true };
}
