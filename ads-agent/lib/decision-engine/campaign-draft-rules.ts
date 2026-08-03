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
      if (headline.trim().length === 0) {
        errors.push(`headlines[${index}] must not be blank`);
      } else if (headline.length > RSA_HEADLINE_MAX_LEN) {
        errors.push(`headlines[${index}] "${headline}" exceeds ${RSA_HEADLINE_MAX_LEN} characters`);
      }
    });
  }

  if (fields.descriptions) {
    if (fields.descriptions.length > RSA_DESCRIPTION_MAX_COUNT) {
      errors.push(`descriptions: at most ${RSA_DESCRIPTION_MAX_COUNT} allowed, got ${fields.descriptions.length}`);
    }
    fields.descriptions.forEach((description, index) => {
      if (description.trim().length === 0) {
        errors.push(`descriptions[${index}] must not be blank`);
      } else if (description.length > RSA_DESCRIPTION_MAX_LEN) {
        errors.push(`descriptions[${index}] "${description}" exceeds ${RSA_DESCRIPTION_MAX_LEN} characters`);
      }
    });
  }

  if (fields.keywords) {
    fields.keywords.forEach((keyword, index) => {
      if (keyword.text.trim().length === 0) {
        errors.push(`keywords[${index}].text must not be blank`);
      }
    });
  }

  if (fields.dailyBudgetInr !== undefined && fields.dailyBudgetInr !== null && fields.dailyBudgetInr <= 0) {
    errors.push("dailyBudgetInr must be greater than 0");
  }

  return errors;
}

export function isDraftReady(draft: CampaignDraft): boolean {
  if (!draft.corridor?.trim() || !draft.adGroupName?.trim() || !draft.dailyBudgetInr) return false;
  if (draft.keywords.length === 0) return false;
  if (draft.keywords.some((keyword) => keyword.text.trim().length === 0)) return false;
  if (draft.headlines.length < RSA_HEADLINE_MIN_COUNT || draft.headlines.length > RSA_HEADLINE_MAX_COUNT) return false;
  if (draft.headlines.some((headline) => headline.trim().length === 0)) return false;
  if (draft.descriptions.length < RSA_DESCRIPTION_MIN_COUNT || draft.descriptions.length > RSA_DESCRIPTION_MAX_COUNT) return false;
  if (draft.descriptions.some((description) => description.trim().length === 0)) return false;
  return validateDraftFields(draft).length === 0;
}
