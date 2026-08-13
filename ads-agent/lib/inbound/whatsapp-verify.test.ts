import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWhatsAppHubChallenge, verifyWhatsAppSignature } from "./whatsapp-verify";

describe("verifyWhatsAppHubChallenge", () => {
  it("returns hub.challenge when verify_token matches", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "tok",
      "hub.challenge": "12345",
    });
    expect(verifyWhatsAppHubChallenge(params, "tok")).toBe("12345");
  });
  it("returns null on token mismatch", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "bad",
      "hub.challenge": "12345",
    });
    expect(verifyWhatsAppHubChallenge(params, "tok")).toBeNull();
  });
});

describe("verifyWhatsAppSignature", () => {
  it("accepts valid sha256 HMAC", () => {
    const body = '{"a":1}';
    const sig = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyWhatsAppSignature(body, `sha256=${sig}`, "secret")).toBe(true);
  });
  it("rejects missing/invalid signatures", () => {
    expect(verifyWhatsAppSignature("{}", null, "secret")).toBe(false);
    expect(verifyWhatsAppSignature("{}", "sha256=dead", "secret")).toBe(false);
  });
});
