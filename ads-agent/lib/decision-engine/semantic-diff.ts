import { stripSmuggle } from "./strip-smuggle";

export type DiffField = {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

function normalizeValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return stripSmuggle(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function diffField(
  field: string,
  before: unknown,
  after: unknown,
): DiffField {
  return {
    field,
    before: normalizeValue(before),
    after: normalizeValue(after),
  };
}

export function semanticDiff(input: {
  kind: string;
  payload: Record<string, unknown>;
  live?: {
    dailyBudgetInr?: number | null;
    status?: string | null;
    name?: string | null;
  };
}): DiffField[] {
  const { kind, payload, live } = input;

  switch (kind) {
    case "budget_change":
      return [
        diffField(
          "dailyBudgetInr",
          live?.dailyBudgetInr ?? null,
          payload.newDailyBudgetInr,
        ),
      ];

    case "pause":
      return [diffField("status", live?.status ?? "active", "paused")];

    case "create_campaign":
      return Object.keys(payload).map((key) => diffField(key, null, payload[key]));

    case "add_negative_keyword": {
      const text = payload.text ?? payload.keywordText;
      return [diffField("keyword", null, text)];
    }

    case "enquiry.requirement_update": {
      const diff = payload.diff;
      if (!diff || typeof diff !== "object" || Array.isArray(diff)) {
        return [];
      }
      return Object.entries(diff as Record<string, unknown>).map(([key, value]) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const entry = value as Record<string, unknown>;
          if ("before" in entry || "after" in entry) {
            return diffField(key, entry.before ?? null, entry.after ?? null);
          }
        }
        return diffField(key, null, value);
      });
    }

    default:
      return [];
  }
}
