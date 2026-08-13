import { buildWhatsAppUrl, type LeadPayload } from "@/lib/whatsapp";

export type WhatsAppHandoffDeps = {
  openWindow: (url: string, target?: string, features?: string) => Window | null;
  postLead: (payload: LeadPayload) => void | Promise<void>;
};

export function submitWhatsAppHandoff(
  lead: LeadPayload,
  deps: WhatsAppHandoffDeps,
): { whatsappUrl: string } {
  const whatsappUrl = buildWhatsAppUrl(lead);
  deps.openWindow(whatsappUrl, "_blank", "noopener,noreferrer");
  void deps.postLead(lead);
  return { whatsappUrl };
}
