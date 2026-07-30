import { describe, expect, it } from "vitest";
import { buildWhatsAppUrl } from "./whatsapp";

describe("buildWhatsAppUrl", () => {
  it("builds wa.me URL with encoded template", () => {
    const url = buildWhatsAppUrl({
      name: "Ada",
      phone: "+91 90000 00000",
      need: "office",
      brief: "ORR, 20 seats",
    });
    expect(url.startsWith("https://wa.me/918105279639?text=")).toBe(true);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Name: Ada");
    expect(text).toContain("WhatsApp: +91 90000 00000");
    expect(text).toContain("Need: Office space");
    expect(text).toContain("Brief: ORR, 20 seats");
    expect(text).toContain("Gentle Space — property e-brochure request");
  });

  it("includes property enquiry fields when present", () => {
    const url = buildWhatsAppUrl({
      name: "Ada",
      phone: "+91 90000 00000",
      need: "office",
      brief: "Need tour",
      propertyName: "WeWork Prestige Atlanta",
      propertyUrl: "https://gentle-space-web.onrender.com/spaces/wework-prestige",
    });
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Gentle Space — property enquiry");
    expect(text).toContain("Property: WeWork Prestige Atlanta");
    expect(text).toContain(
      "Listing: https://gentle-space-web.onrender.com/spaces/wework-prestige",
    );
  });
});
