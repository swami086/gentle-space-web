import { describe, expect, it } from "vitest";
import {
  displayLocationLine,
  redactSensitiveText,
  sanitizeArea,
} from "./redact";

describe("redactSensitiveText", () => {
  it("drops the RMZ Ecoworld located-at sentence and keeps a clean amenities sentence", () => {
    const input =
      "CoWrks is a large format shared office space located at RMZ Ecoworld, Bellandur, Bangalore. High-speed wireless internet and meeting rooms are available for use.";
    const out = redactSensitiveText(input);
    expect(out.toLowerCase()).not.toContain("located at");
    expect(out.toLowerCase()).not.toContain("rmz ecoworld");
    expect(out).toMatch(/High-speed wireless internet/i);
  });

  it("drops the floor / building sentence from Regus Supreme", () => {
    const input =
      "Our Supreme Centre is situated on the 2nd and 3rd Floor, of the Supreme Overseas Exports India Pvt Ltd Building. Members enjoy quiet focus zones.";
    const out = redactSensitiveText(input);
    expect(out.toLowerCase()).not.toContain("2nd");
    expect(out.toLowerCase()).not.toContain("situated on");
    expect(out).toMatch(/quiet focus zones/i);
  });

  it("drops precise metro distance + road sentence", () => {
    const input =
      "The centre is a 2 minute walk from the local bus stand and a 4 minute walk from Lalbhag Metro station. Within 50 meters you have the Bus Depo. Collaborative desks suit growing teams.";
    const out = redactSensitiveText(input);
    expect(out.toLowerCase()).not.toContain("within 50");
    expect(out.toLowerCase()).not.toContain("2 minute");
    expect(out.toLowerCase()).not.toContain("4 minute");
    expect(out.toLowerCase()).not.toContain("lalbhag");
    expect(out.toLowerCase()).not.toContain("metro station");
    expect(out).toMatch(/Collaborative desks/i);
  });

  it("drops currency and PIN sentences", () => {
    const input =
      "Pricing starts at ₹44,999/*. The PIN code is 560103 for deliveries. Friendly community managers greet guests daily.";
    const out = redactSensitiveText(input);
    expect(out).not.toMatch(/₹/);
    expect(out).not.toMatch(/560103/);
    expect(out).toMatch(/Friendly community managers/i);
  });

  it("returns empty string when every sentence is sensitive", () => {
    expect(redactSensitiveText("Located at RMZ Ecoworld, Bellandur.")).toBe("");
  });
});

describe("sanitizeArea", () => {
  it("extracts locality after cofynd markdown blob", () => {
    expect(
      sanitizeArea(
        "![Location](https://cofynd.com/assets/images/icons/co-location-icon.svg) Ashok Nagar",
      ),
    ).toBe("Ashok Nagar");
  });

  it("extracts locality after truncated map_marker.svg junk", () => {
    expect(sanitizeArea("ap_marker.svg)   BNR Complex")).toBe("BNR Complex");
    expect(
      sanitizeArea(
        "img/img_location_map_marker.svg)   Prema Narayana Enclave",
      ),
    ).toBe("Prema Narayana Enclave");
  });

  it("blanks address-like plot values", () => {
    expect(sanitizeArea("Metropolis Office Park Plot No: 128-P2")).toBe("");
  });

  it("blanks comma-containing values", () => {
    expect(sanitizeArea("Bellandur, Bengaluru")).toBe("");
  });

  it("keeps real localities including Layout and Block", () => {
    expect(sanitizeArea("Bellandur")).toBe("Bellandur");
    expect(sanitizeArea("HSR Layout")).toBe("HSR Layout");
    expect(sanitizeArea("Koramangala 5th Block")).toBe("Koramangala 5th Block");
  });
});

describe("displayLocationLine", () => {
  it("falls back to Bangalore when area is empty", () => {
    expect(displayLocationLine("", "Bengaluru")).toBe("Bangalore");
  });

  it("joins sanitized area and city", () => {
    expect(displayLocationLine("Bellandur", "Bengaluru")).toBe("Bellandur, Bangalore");
  });
});
