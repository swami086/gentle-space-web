import { describe, it, expect } from "vitest";
import { verifyPostmarkBasicAuth } from "./postmark-auth";

const USER = "postmark-inbound";
const PASS = "s3cret-token";

function basicHeader(user: string, pass: string): string {
  const encoded = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

describe("verifyPostmarkBasicAuth", () => {
  it("accepts valid Basic credentials", () => {
    expect(verifyPostmarkBasicAuth(basicHeader(USER, PASS), USER, PASS)).toBe(true);
  });

  it("rejects a null authorization header", () => {
    expect(verifyPostmarkBasicAuth(null, USER, PASS)).toBe(false);
  });

  it("rejects a missing Basic scheme", () => {
    expect(verifyPostmarkBasicAuth("Bearer token", USER, PASS)).toBe(false);
  });

  it("rejects the wrong password", () => {
    expect(verifyPostmarkBasicAuth(basicHeader(USER, "wrong"), USER, PASS)).toBe(false);
  });

  it("rejects the wrong user", () => {
    expect(verifyPostmarkBasicAuth(basicHeader("other-user", PASS), USER, PASS)).toBe(false);
  });

  it("rejects invalid base64", () => {
    expect(verifyPostmarkBasicAuth("Basic !!!", USER, PASS)).toBe(false);
  });

  it("accepts passwords containing colons", () => {
    const pass = "pa:ss:word";
    expect(verifyPostmarkBasicAuth(basicHeader(USER, pass), USER, pass)).toBe(true);
  });
});
