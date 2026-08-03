import { SITE } from "./site";
import { STEP2_FIELDS, type Step2Answers } from "./leads/step2-fields";

export type NeedType = "office" | "retail" | "lease";

export const NEED_LABELS: Record<NeedType, string> = {
  office: "Office space",
  retail: "Retail space",
  lease: "Lease out my property",
};

export type LeadPayload = {
  name: string;
  phone: string;
  need: NeedType;
  brief: string;
  step2Answers?: Step2Answers;
  propertyName?: string;
  propertyUrl?: string;
};

function step2Lines(payload: LeadPayload): string[] {
  if (!payload.step2Answers) return [];
  return STEP2_FIELDS[payload.need]
    .map((field) => {
      const value = payload.step2Answers?.[field.key]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => Boolean(line));
}

export function buildWhatsAppUrl(payload: LeadPayload): string {
  const isProperty = Boolean(payload.propertyName && payload.propertyUrl);
  const body = isProperty
    ? [
        "Gentle Space CRE - property enquiry",
        "",
        `Property: ${payload.propertyName!.trim()}`,
        `Listing: ${payload.propertyUrl!.trim()}`,
        "",
        `Name: ${payload.name.trim()}`,
        `WhatsApp: ${payload.phone.trim()}`,
        `Brief: ${payload.brief.trim()}`,
      ].join("\n")
    : [
        "Gentle Space CRE - property e-brochure request",
        "",
        `Name: ${payload.name.trim()}`,
        `WhatsApp: ${payload.phone.trim()}`,
        `Need: ${NEED_LABELS[payload.need]}`,
        ...step2Lines(payload),
        ...(payload.brief.trim() ? [`Notes: ${payload.brief.trim()}`] : []),
      ].join("\n");
  return `https://wa.me/${SITE.phoneE164}?text=${encodeURIComponent(body)}`;
}
