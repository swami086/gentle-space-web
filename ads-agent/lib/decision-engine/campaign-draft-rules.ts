import type { CampaignDraft, CampaignDraftFields } from "../types";

export const RSA_HEADLINE_MAX_LEN = 30;
export const RSA_HEADLINE_MIN_COUNT = 3;
export const RSA_HEADLINE_MAX_COUNT = 15;
export const RSA_DESCRIPTION_MAX_LEN = 90;
export const RSA_DESCRIPTION_MIN_COUNT = 2;
export const RSA_DESCRIPTION_MAX_COUNT = 4;

export function validateDraftFields(fields: CampaignDraftFields): string[] {
  const errors: string[] = [];

  if (fields.headlines) {
    if (fields.headlines.length > RSA_HEADLINE_MAX_COUNT) {
      errors.push(`headlines: at most ${RSA_HEADLINE_MAX_COUNT} allowed, got ${fields.headlines.length}`);
    }
    fields.headlines.forEach((headline, index) => {
      if (headline.length > RSA_HEADLINE_MAX_LEN) {
        errors.push(`headlines[${index}] "${headline}" exceeds ${RSA_HEADLINE_MAX_LEN} characters`);
      }
    });
  }

  if (fields.descriptions) {
    if (fields.descriptions.length > RSA_DESCRIPTION_MAX_COUNT) {
      errors.push(`descriptions: at most ${RSA_DESCRIPTION_MAX_COUNT} allowed, got ${fields.descriptions.length}`);
    }
    fields.descriptions.forEach((description, index) => {
      if (description.length > RSA_DESCRIPTION_MAX_LEN) {
        errors.push(`descriptions[${index}] "${description}" exceeds ${RSA_DESCRIPTION_MAX_LEN} characters`);
      }
    });
  }

  if (fields.dailyBudgetInr !== undefined && fields.dailyBudgetInr !== null && fields.dailyBudgetInr <= 0) {
    errors.push("dailyBudgetInr must be greater than 0");
  }

  return errors;
}

export function isDraftReady(draft: CampaignDraft): boolean {
  if (!draft.corridor || !draft.adGroupName || !draft.dailyBudgetInr) return false;
  if (draft.keywords.length === 0) return false;
  if (draft.headlines.length < RSA_HEADLINE_MIN_COUNT || draft.headlines.length > RSA_HEADLINE_MAX_COUNT) return false;
  if (draft.descriptions.length < RSA_DESCRIPTION_MIN_COUNT || draft.descriptions.length > RSA_DESCRIPTION_MAX_COUNT) return false;
  return validateDraftFields(draft).length === 0;
}
