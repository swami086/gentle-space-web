import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWhatsAppHubChallenge(
  params: URLSearchParams,
  verifyToken: string,
): string | null {
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

export function verifyWhatsAppSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const providedHex = signatureHeader.slice("sha256=".length);
  const body =
    typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expectedHex = createHmac("sha256", appSecret)
    .update(body)
    .digest("hex");

  if (providedHex.length !== expectedHex.length) return false;

  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
