import { upsertTwentyConnection } from "../db/twenty-connections";
import { ensureTenantPostgres } from "./twenty-postgres";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type LocalProvisionInput = {
  orgId: string;
  orgSlug: string;
  postgresPassword: string;
  twentyTag?: string;
};

/** Distinct from SHARED_TWENTY_BASE_URL (localhost:3020) so the coverage gate passes locally. */
export function localTwentyBaseUrl(orgSlug: string): string {
  const template = process.env.LOCAL_TWENTY_BASE_URL_TEMPLATE?.trim();
  if (template) {
    return template.replaceAll("{slug}", orgSlug).replace(/\/$/, "");
  }
  return `http://twenty-${orgSlug}.localhost:3020`;
}

export function localTwentyApiKeyRef(orgSlug: string): string {
  if (process.env.LOCAL_TWENTY_USE_SHARED_KEY === "1") {
    return "env://TWENTY_API_KEY";
  }
  const underscored = orgSlug.replace(/-/g, "_").toUpperCase();
  return `env://TWENTY_API_KEY_${underscored}`;
}

/**
 * Local dev path (§9 steps 1–3, 5): tenant Postgres on gentle-space-pg + registry row.
 * No Coolify — point Twenty at the tenant DB manually or via a future local compose profile.
 */
export async function provisionTwentyLocal(
  input: LocalProvisionInput,
): Promise<{ baseUrl: string; state: "provisioning" }> {
  if (!SLUG.test(input.orgSlug)) {
    throw new Error(
      `twenty local provision: slug must be lowercase alphanumeric with single hyphens, got "${input.orgSlug}"`,
    );
  }

  await ensureTenantPostgres({
    orgSlug: input.orgSlug,
    postgresPassword: input.postgresPassword,
  });

  const baseUrl = localTwentyBaseUrl(input.orgSlug);
  const shared = process.env.SHARED_TWENTY_BASE_URL?.replace(/\/$/, "");
  if (shared && baseUrl.replace(/\/$/, "") === shared) {
    throw new Error(
      "twenty local provision: base URL must differ from SHARED_TWENTY_BASE_URL — set LOCAL_TWENTY_BASE_URL_TEMPLATE",
    );
  }

  await upsertTwentyConnection({
    orgId: input.orgId,
    baseUrl,
    apiKeyRef: localTwentyApiKeyRef(input.orgSlug),
    coolifyServiceUuid: `local-${input.orgSlug}`,
    twentyVersion: input.twentyTag ?? process.env.TWENTY_TAG ?? "latest",
    state: "provisioning",
  });

  return { baseUrl, state: "provisioning" };
}
