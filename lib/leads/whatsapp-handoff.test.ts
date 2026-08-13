import { describe, expect, it, vi } from "vitest";
import { submitWhatsAppHandoff } from "./whatsapp-handoff";
import type { LeadPayload } from "@/lib/whatsapp";

const lead: LeadPayload = {
  name: "Ada",
  phone: "+91 90000 00000",
  need: "office",
  brief: "hi",
};

describe("submitWhatsAppHandoff", () => {
  it("opens WhatsApp before postLead is invoked", () => {
    const order: string[] = [];
    const openWindow = vi.fn(() => {
      order.push("open");
      return null;
    });
    const postLead = vi.fn(() => {
      order.push("post");
      return new Promise(() => {}); // never resolves
    });

    const { whatsappUrl } = submitWhatsAppHandoff(lead, { openWindow, postLead });

    expect(order).toEqual(["open", "post"]);
    expect(openWindow).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(whatsappUrl.startsWith("https://wa.me/")).toBe(true);
    expect(postLead).toHaveBeenCalledWith(lead);
  });

  it("does not await a hanging postLead before returning", async () => {
    let resolvePost!: () => void;
    const postLead = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePost = resolve;
        }),
    );
    const openWindow = vi.fn(() => null);

    const result = submitWhatsAppHandoff(lead, { openWindow, postLead });
    expect(result.whatsappUrl).toContain("wa.me");
    expect(openWindow).toHaveBeenCalledTimes(1);
    resolvePost();
    await Promise.resolve();
  });
});
