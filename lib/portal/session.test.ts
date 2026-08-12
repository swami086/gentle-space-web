import { describe, it, expect } from "vitest";
import { newSessionId, readSessionId, sessionCookie, SESSION_COOKIE } from "./session";

describe("session id", () => {
  it("generates an opaque id the taxonomy accepts", () => {
    const id = newSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(id).not.toContain("@");
  });

  it("generates a different id each time", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it("reads the id from a cookie header alongside others", () => {
    expect(readSessionId(`theme=dark; ${SESSION_COOKIE}=abcdefabcdefabcdef01; x=1`)).toBe("abcdefabcdefabcdef01");
  });

  it("returns null for a missing or malformed cookie rather than inventing one", () => {
    expect(readSessionId(null)).toBeNull();
    expect(readSessionId("theme=dark")).toBeNull();
    expect(readSessionId(`${SESSION_COOKIE}=short`)).toBeNull();
  });

  it("sets the cookie HttpOnly, SameSite=Lax and Secure", () => {
    const cookie = sessionCookie("abcdefabcdefabcdef01");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
  });
});
