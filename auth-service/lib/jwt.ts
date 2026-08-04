import { SignJWT, jwtVerify, importPKCS8, importSPKI, exportJWK } from "jose";
import type { MemberRole } from "./types";

// This literal MUST match the AUTH_ISSUER constant in ads-agent/lib/auth/dal.ts exactly — there is
// no shared package between the two services, so this is intentional duplication (see plan's
// Global Constraints).
const AUTH_ISSUER = "gentlespace-auth-service";
const ACCESS_TOKEN_TTL = "20m";

// jose v6 dropped the KeyLike export; importPKCS8/SPKI resolve to CryptoKey in Node.
type ImportedKey = Awaited<ReturnType<typeof importPKCS8>>;

function pem(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\\n/g, "\n");
}

function kid(): string {
  const value = process.env.AUTH_JWT_KID;
  if (!value) throw new Error("AUTH_JWT_KID is not set");
  return value;
}

let privateKeyPromise: Promise<ImportedKey> | null = null;
function getPrivateKey(): Promise<ImportedKey> {
  if (!privateKeyPromise) privateKeyPromise = importPKCS8(pem("AUTH_JWT_PRIVATE_KEY_PEM"), "RS256");
  return privateKeyPromise;
}

let publicKeyPromise: Promise<ImportedKey> | null = null;
function getPublicKey(): Promise<ImportedKey> {
  if (!publicKeyPromise) publicKeyPromise = importSPKI(pem("AUTH_JWT_PUBLIC_KEY_PEM"), "RS256");
  return publicKeyPromise;
}

export type AccessTokenClaims = {
  sub: string;
  email: string;
  orgId: string | null;
  role: MemberRole | null;
};

export async function mintAccessToken(claims: AccessTokenClaims): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ email: claims.email, orgId: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: "RS256", kid: kid() })
    .setSubject(claims.sub)
    .setIssuer(AUTH_ISSUER)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, { issuer: AUTH_ISSUER });
  return {
    sub: String(payload.sub),
    email: String(payload.email ?? ""),
    orgId: typeof payload.orgId === "string" ? payload.orgId : null,
    role: typeof payload.role === "string" ? (payload.role as MemberRole) : null,
  };
}

export async function getJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const key = await getPublicKey();
  const jwk = await exportJWK(key);
  return { keys: [{ ...jwk, kid: kid(), use: "sig", alg: "RS256" }] };
}
