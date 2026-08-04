import { beforeAll, describe, expect, it } from "vitest";
import { mintAccessToken, verifyAccessToken, getJwks } from "./jwt";

beforeAll(() => {
  if (!process.env.AUTH_JWT_PRIVATE_KEY_PEM || !process.env.AUTH_JWT_PUBLIC_KEY_PEM) {
    throw new Error(
      "AUTH_JWT_PRIVATE_KEY_PEM/AUTH_JWT_PUBLIC_KEY_PEM must be set in .env.local for these tests " +
        "(see Task 2 Step 1) — vitest picks up .env.local automatically via dotenv if configured, " +
        "or run with `npx vitest run --env-file=.env.local`.",
    );
  }
});

describe("mintAccessToken / verifyAccessToken round-trip", () => {
  it("mints a token whose claims verify back correctly for an active user", async () => {
    const token = await mintAccessToken({
      sub: "user-1",
      email: "a@x.com",
      orgId: "org-1",
      role: "admin",
    });
    const claims = await verifyAccessToken(token);
    expect(claims).toEqual({ sub: "user-1", email: "a@x.com", orgId: "org-1", role: "admin" });
  });

  it("mints a pending-user token with null orgId/role", async () => {
    const token = await mintAccessToken({ sub: "user-2", email: "b@x.com", orgId: null, role: null });
    const claims = await verifyAccessToken(token);
    expect(claims.orgId).toBeNull();
    expect(claims.role).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await mintAccessToken({ sub: "user-1", email: "a@x.com", orgId: null, role: null });
    const tampered = token.slice(0, -2) + "xx";
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });
});

describe("getJwks", () => {
  it("exposes exactly one RSA public key tagged with the configured kid", async () => {
    const jwks = await getJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: process.env.AUTH_JWT_KID, use: "sig", alg: "RS256" });
    expect(jwks.keys[0]).not.toHaveProperty("d"); // never leak the private exponent
  });
});
