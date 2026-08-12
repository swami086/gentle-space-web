export type PreflightCheckId =
  | "budget_cap"
  | "connector_health"
  | "credit_balance"
  | "keyword_overlap";

export type PreflightCheck = {
  id: PreflightCheckId;
  ok: boolean;
  severity: "block" | "warn";
  message: string;
  detail?: Record<string, unknown>;
};

export type PreflightResult = {
  ok: boolean;
  checks: PreflightCheck[];
};

export type PreflightInput = {
  kind: string;
  payload: Record<string, unknown>;
  orgDailyBudgetCapInr: number | null;
  creditBalance: number;
  connectors: { googleAds: boolean; meta: boolean };
  existingKeywords?: string[];
};

type Platform = "google" | "meta";

function proposedDailyBudgetInr(kind: string, payload: Record<string, unknown>): number | null {
  if (kind === "budget_change") {
    const value = payload.newDailyBudgetInr;
    return typeof value === "number" ? value : null;
  }
  if (kind === "create_campaign") {
    const value = payload.dailyBudgetInr;
    return typeof value === "number" ? value : null;
  }
  return null;
}

function requiredPlatform(kind: string, payload: Record<string, unknown>): Platform | null {
  if (kind === "add_negative_keyword") return "google";
  if (kind === "campaign_strategy") return null;
  if (kind === "create_campaign" || kind === "pause" || kind === "budget_change") {
    const platform = payload.platform;
    return platform === "google" || platform === "meta" ? platform : null;
  }
  return null;
}

function foldKeyword(text: string): string {
  return text.trim().toLocaleLowerCase();
}

function keywordsToCheck(kind: string, payload: Record<string, unknown>): string[] {
  if (kind === "add_negative_keyword") {
    const text = payload.keywordText;
    return typeof text === "string" && text.trim() ? [text] : [];
  }
  if (kind === "create_campaign") {
    const fromKeywords = Array.isArray(payload.keywords)
      ? payload.keywords
          .map((entry) =>
            entry && typeof entry === "object" && "text" in entry && typeof entry.text === "string"
              ? entry.text
              : null,
          )
          .filter((text): text is string => Boolean(text?.trim()))
      : [];
    const fromNegatives = Array.isArray(payload.negativeKeywords)
      ? payload.negativeKeywords.filter((text): text is string => typeof text === "string" && text.trim().length > 0)
      : [];
    return [...fromKeywords, ...fromNegatives];
  }
  return [];
}

function checkBudgetCap(input: PreflightInput): PreflightCheck | null {
  if (input.kind !== "budget_change" && input.kind !== "create_campaign") return null;

  const proposed = proposedDailyBudgetInr(input.kind, input.payload);
  if (input.orgDailyBudgetCapInr === null || proposed === null) {
    return {
      id: "budget_cap",
      ok: true,
      severity: "block",
      message: "Daily budget is within org cap",
    };
  }

  if (proposed > input.orgDailyBudgetCapInr) {
    return {
      id: "budget_cap",
      ok: false,
      severity: "block",
      message: `Proposed daily budget ₹${proposed} exceeds org cap ₹${input.orgDailyBudgetCapInr}`,
      detail: { proposedDailyBudgetInr: proposed, capInr: input.orgDailyBudgetCapInr },
    };
  }

  return {
    id: "budget_cap",
    ok: true,
    severity: "block",
    message: "Daily budget is within org cap",
    detail: { proposedDailyBudgetInr: proposed, capInr: input.orgDailyBudgetCapInr },
  };
}

function checkConnectorHealth(input: PreflightInput): PreflightCheck | null {
  const platform = requiredPlatform(input.kind, input.payload);
  if (!platform) return null;

  const healthy = platform === "google" ? input.connectors.googleAds : input.connectors.meta;
  if (healthy) {
    return {
      id: "connector_health",
      ok: true,
      severity: "block",
      message: `${platform === "google" ? "Google Ads" : "Meta"} connector is configured`,
      detail: { platform },
    };
  }

  return {
    id: "connector_health",
    ok: false,
    severity: "block",
    message: `${platform === "google" ? "Google Ads" : "Meta"} connector is not configured`,
    detail: { platform },
  };
}

function checkCreditBalance(input: PreflightInput): PreflightCheck {
  if (input.creditBalance <= 0) {
    return {
      id: "credit_balance",
      ok: false,
      severity: "warn",
      message: "Credit balance is zero or negative; ads mutations may fail billing checks",
      detail: { creditBalance: input.creditBalance },
    };
  }

  return {
    id: "credit_balance",
    ok: true,
    severity: "warn",
    message: "Credit balance is available",
    detail: { creditBalance: input.creditBalance },
  };
}

function checkKeywordOverlap(input: PreflightInput): PreflightCheck | null {
  if (input.kind !== "add_negative_keyword" && input.kind !== "create_campaign") return null;

  const existing = new Set((input.existingKeywords ?? []).map(foldKeyword));
  const overlaps = keywordsToCheck(input.kind, input.payload).filter((keyword) =>
    existing.has(foldKeyword(keyword)),
  );

  if (overlaps.length > 0) {
    return {
      id: "keyword_overlap",
      ok: false,
      severity: "warn",
      message: "One or more keywords already exist on the campaign",
      detail: { overlaps },
    };
  }

  return {
    id: "keyword_overlap",
    ok: true,
    severity: "warn",
    message: "No keyword overlap detected",
  };
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const checks = [
    checkBudgetCap(input),
    checkConnectorHealth(input),
    checkCreditBalance(input),
    checkKeywordOverlap(input),
  ].filter((check): check is PreflightCheck => check !== null);

  const ok = checks.every((check) => check.ok || check.severity !== "block");
  return { ok, checks };
}
