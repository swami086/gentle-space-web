import type { NeedType } from "../whatsapp";

export type Step2Answers = Record<string, string>;

export type Step2Field = {
  key: string;
  label: string;
  placeholder: string;
};

export const STEP2_FIELDS: Record<NeedType, Step2Field[]> = {
  office: [
    { key: "teamSize", label: "Team size / desks", placeholder: "e.g. 15 desks" },
    { key: "preferredArea", label: "Preferred area or corridor", placeholder: "e.g. Koramangala, HSR" },
    { key: "moveInTimeline", label: "Move-in timeline", placeholder: "e.g. Within 30 days" },
  ],
  retail: [
    { key: "frontageFootfall", label: "Frontage / footfall need", placeholder: "e.g. High-street frontage" },
    { key: "preferredLocality", label: "Preferred locality", placeholder: "e.g. Indiranagar 100 Feet Road" },
    { key: "timeline", label: "Timeline", placeholder: "e.g. Within 60 days" },
  ],
  lease: [
    { key: "propertySize", label: "Property type & size", placeholder: "e.g. 2,000 sqft office floor" },
    { key: "location", label: "Location", placeholder: "e.g. Whitefield" },
    { key: "expectedRentTimeline", label: "Expected rent / timeline", placeholder: "e.g. Rs 80/sqft, immediate" },
  ],
};

export function step2FieldsFor(need: NeedType): Step2Field[] {
  return STEP2_FIELDS[need];
}

/**
 * Folds structured Step 2 answers + free-text notes into one readable string.
 * Shared by the AI qualifier prompt (Task 3) and the CRM `brief` field
 * (Task 5) so both render the same labels from one source of truth. The
 * WhatsApp message (Task 4) renders each answer as its own line instead —
 * a different format, so it does not reuse this function.
 */
export function foldStep2Answers(
  need: NeedType,
  answers: Step2Answers | undefined,
  notes: string,
): string {
  const fields = STEP2_FIELDS[need];
  const lines = answers
    ? fields
        .map((field) => {
          const value = answers[field.key]?.trim();
          return value ? `${field.label}: ${value}` : null;
        })
        .filter((line): line is string => Boolean(line))
    : [];
  return [...lines, notes.trim()].filter(Boolean).join(". ");
}
