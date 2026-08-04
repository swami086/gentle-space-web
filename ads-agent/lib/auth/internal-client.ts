// Duplicated from ../auth/dal.ts intentionally — see plan's Global Constraints on cross-service type
// duplication (this file talks to auth-service purely over HTTP, never imports its code).
export type MemberRole = "admin" | "operator" | "viewer";

export type OrgMember = {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  lastLoginAt: string | null;
};
export type PendingUser = { userId: string; email: string; name: string | null };

function authServiceUrl(): string {
  const url = process.env.AUTH_SERVICE_URL;
  if (!url) throw new Error("AUTH_SERVICE_URL is not set");
  return url;
}

function internalApiKey(): string {
  const key = process.env.AUTH_SERVICE_INTERNAL_API_KEY;
  if (!key) throw new Error("AUTH_SERVICE_INTERNAL_API_KEY is not set");
  return key;
}

export async function listOrgMembers(): Promise<{ members: OrgMember[]; pending: PendingUser[] }> {
  const res = await fetch(`${authServiceUrl()}/internal/org-members`, {
    headers: { "x-internal-api-key": internalApiKey() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`auth-service internal API error: ${res.status}`);
  return res.json();
}

export async function assignRole(userId: string, role: MemberRole): Promise<void> {
  const res = await fetch(`${authServiceUrl()}/internal/org-members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-api-key": internalApiKey() },
    body: JSON.stringify({ userId, role }),
  });
  if (!res.ok) throw new Error(`auth-service internal API error: ${res.status}`);
}
