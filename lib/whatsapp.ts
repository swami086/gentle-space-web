import { SITE } from "./site";

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
};

export function buildWhatsAppUrl(payload: LeadPayload): string {
  const body = [
    "Gentle Space — property e-brochure request",
    "",
    `Name: ${payload.name.trim()}`,
    `WhatsApp: ${payload.phone.trim()}`,
    `Need: ${NEED_LABELS[payload.need]}`,
    `Brief: ${payload.brief.trim()}`,
  ].join("\n");
  return `https://wa.me/${SITE.phoneE164}?text=${encodeURIComponent(body)}`;
}
