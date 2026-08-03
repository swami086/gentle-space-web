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
    expect(text).toContain("Notes: ORR, 20 seats");
    expect(text).toContain("Gentle Space CRE - property e-brochure request");
  });

  it("renders step2Answers as labeled lines before Notes", () => {
    const url = buildWhatsAppUrl({
      name: "Ada",
      phone: "+91 90000 00000",
      need: "office",
      brief: "Flexible on move-in",
      step2Answers: { teamSize: "15 desks", preferredArea: "Koramangala, HSR" },
    });
    const text = decodeURIComponent(url.split("text=")[1]);
    const teamSizeIdx = text.indexOf("Team size / desks: 15 desks");
    const areaIdx = text.indexOf("Preferred area or corridor: Koramangala, HSR");
    const notesIdx = text.indexOf("Notes: Flexible on move-in");
    expect(teamSizeIdx).toBeGreaterThan(-1);
    expect(areaIdx).toBeGreaterThan(teamSizeIdx);
    expect(notesIdx).toBeGreaterThan(areaIdx);
  });

  it("omits the Notes line when brief is empty and skips blank step2Answers", () => {
    const url = buildWhatsAppUrl({
      name: "Ada",
      phone: "+91 90000 00000",
      need: "office",
      brief: "",
      step2Answers: { teamSize: "15 desks", preferredArea: "" },
    });
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Team size / desks: 15 desks");
    expect(text).not.toContain("Preferred area");
    expect(text).not.toContain("Notes:");
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
    expect(text).toContain("Gentle Space CRE - property enquiry");
    expect(text).toContain("Property: WeWork Prestige Atlanta");
    expect(text).toContain(
      "Listing: https://gentle-space-web.onrender.com/spaces/wework-prestige",
    );
  });
});
