import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type CachedToken = { accessToken: string; expiresAtMs: number };

let cache: CachedToken | null = null;

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function loadServiceAccount(): ServiceAccountKey {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set");
  return JSON.parse(readFileSync(path, "utf8")) as ServiceAccountKey;
}

/** Mint an access token from a local Vertex service-account JSON key. */
export async function getVertexAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAtMs > now + 60_000) return cache.accessToken;

  const sa = loadServiceAccount();
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`vertex token failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cache = {
    accessToken: body.access_token,
    expiresAtMs: now + body.expires_in * 1000,
  };
  return body.access_token;
}

/** Test-only: clear the cached token so tests don't leak state across runs. */
export function _resetVertexAuthCacheForTests(): void {
  cache = null;
}
