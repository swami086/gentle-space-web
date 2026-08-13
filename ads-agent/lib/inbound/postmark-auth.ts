import { timingSafeEqual } from "node:crypto";

const BASIC_PREFIX = "basic ";

export function verifyPostmarkBasicAuth(
  authorizationHeader: string | null,
  user: string,
  pass: string,
): boolean {
  if (!authorizationHeader) return false;

  const trimmed = authorizationHeader.trim();
  if (!trimmed.toLowerCase().startsWith(BASIC_PREFIX)) return false;

  const encoded = trimmed.slice(BASIC_PREFIX.length).trim();
  if (!encoded) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }

  const expected = `${user}:${pass}`;
  const actual = Buffer.from(decoded, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (actual.length !== expectedBuf.length) return false;

  return timingSafeEqual(actual, expectedBuf);
}
