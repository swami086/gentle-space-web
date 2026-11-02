export type CopyCheckResult = { ok: true } | { ok: false; reason: string };

const SALES_LANGUAGE = [
  /\bfor\s+sale\b/i,
  /\bbuy\s+now\b/i,
  /\bfreehold\b/i,
] as const;

const DISCRIMINATORY_LANGUAGE = [
  /\bcaste\b/i,
  /\brace\b/i,
  /\bonly\s+hindus?\b/i,
  /\bonly\s+muslims?\b/i,
  /\bhindus?\s+only\b/i,
  /\bmuslims?\s+only\b/i,
  /\bonly\s+(hindu|muslim|christian|sikh|jain|buddhist)s?\b/i,
  /\b(hindu|muslim|christian|sikh|jain|buddhist)s?\s+only\b/i,
  /\b(must\s+be|open\s+to)\s+(only\s+)?(hindu|muslim|christian|sikh)s?\b/i,
] as const;

export function checkIndiaCopy(copy: string): CopyCheckResult {
  for (const pattern of SALES_LANGUAGE) {
    if (pattern.test(copy)) {
      return { ok: false, reason: "Lease ads must not use sales language" };
    }
  }

  for (const pattern of DISCRIMINATORY_LANGUAGE) {
    if (pattern.test(copy)) {
      return {
        ok: false,
        reason: "Lease ads must not use discriminatory eligibility wording",
      };
    }
  }

  return { ok: true };
}
