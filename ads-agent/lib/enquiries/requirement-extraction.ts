import { chatCompletion, firstChoiceContent, isBifrostConfigured } from "../bifrost/client";
import type { RequirementPatch } from "../db/enquiry-requirements";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    desksMin: { type: ["integer", "null"] },
    desksMax: { type: ["integer", "null"] },
    budgetPerDeskInr: { type: ["number", "null"] },
    moveInBy: { type: ["string", "null"], description: "ISO date, YYYY-MM-DD" },
    mustHaves: { type: "array", items: { type: "string" } },
  },
  required: [],
} as const;

const SYSTEM = `You extract office-space requirements from a broker's call notes.
Return only what the notes actually state. Omit any field the notes do not
mention -- do not infer, do not fill gaps, and do not repeat a previous value.
Desk counts are whole numbers. Budget is rupees per desk per month. Dates are
ISO YYYY-MM-DD.`;

/**
 * Re-validates the model's output in TypeScript even though the request asked
 * for a strict schema: responseFormat is a request, not a guarantee, and a
 * hallucinated desksMin of -3 must not reach a CHECK constraint and 500 the
 * broker's request. A field that fails validation is dropped rather than
 * failing the whole extraction -- a partial diff is useful, an error is not.
 */
export function parseRequirementDiff(raw: string | undefined): RequirementPatch {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const source = parsed as Record<string, unknown>;
  const patch: RequirementPatch = {};

  const desksMin = Number(source.desksMin);
  if (Number.isInteger(desksMin) && desksMin > 0) patch.desksMin = desksMin;

  const desksMax = Number(source.desksMax);
  if (Number.isInteger(desksMax) && desksMax > 0) patch.desksMax = desksMax;

  const min = patch.desksMin;
  const max = patch.desksMax;
  if (typeof min === "number" && typeof max === "number" && max < min) {
    delete patch.desksMin;
    delete patch.desksMax;
  }

  const budget = Number(source.budgetPerDeskInr);
  if (Number.isFinite(budget) && budget >= 0) patch.budgetPerDeskInr = budget;

  if (typeof source.moveInBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.moveInBy)) {
    if (!Number.isNaN(Date.parse(source.moveInBy))) patch.moveInBy = source.moveInBy;
  }

  if (Array.isArray(source.mustHaves)) {
    const cleaned = source.mustHaves
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length <= 120);
    if (cleaned.length > 0) patch.mustHaves = cleaned;
  }

  return patch;
}

export async function extractRequirementDiff(notes: string): Promise<RequirementPatch> {
  if (!notes.trim() || !isBifrostConfigured()) return {};
  try {
    const response = await chatCompletion({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: notes.slice(0, 4000) },
      ],
      // Zero temperature: the same notes must yield the same diff, or the
      // broker cannot trust the chips they are being asked to confirm.
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 20_000,
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "requirement_diff", schema: SCHEMA, strict: true },
      },
    });
    return parseRequirementDiff(firstChoiceContent(response));
  } catch (err) {
    // The broker is mid-call-log. An extraction failure degrades to no chips,
    // never to a failed call log.
    console.error("requirement extraction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
