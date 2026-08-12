import type { Scope } from "../db/scope-sql";

export const ARTIFACT_CONTENT_TYPES = [
  "talking_points",
  "draft",
  "context_pack",
  "trace_payload",
  "call_recording",
] as const;

export type ArtifactContentType = (typeof ARTIFACT_CONTENT_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function tenantPrefix(scope: Scope): string {
  if (!UUID.test(scope.orgId)) {
    throw new Error(`tenantPrefix: orgId is not a uuid: ${scope.orgId}`);
  }
  return `artifacts/${scope.orgId}/`;
}

export function artifactStorageKey(
  scope: Scope,
  contentType: ArtifactContentType,
  artifactId: string,
): string {
  if (!(ARTIFACT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new Error(`artifactStorageKey: unknown content type: ${contentType}`);
  }
  if (!UUID.test(artifactId)) {
    throw new Error(`artifactStorageKey: artifactId is not a uuid: ${artifactId}`);
  }
  return `${tenantPrefix(scope)}${contentType}/${artifactId}`;
}

export function orgIdFromKey(key: string): string | null {
  const match = /^artifacts\/([^/]+)\//.exec(key);
  if (!match || !UUID.test(match[1])) return null;
  return match[1];
}
