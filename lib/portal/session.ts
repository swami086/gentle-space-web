import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "gs_sid";
const SESSION_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function newSessionId(): string {
  return randomBytes(15).toString("base64url");
}

export function readSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const value = rest.join("=");
    return SESSION_SHAPE.test(value) ? value : null;
  }
  return null;
}

export function sessionCookie(sessionId: string): string {
  return [
    `${SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join("; ");
}
