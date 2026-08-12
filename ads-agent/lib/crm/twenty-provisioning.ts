import { readFileSync } from "node:fs";
import path from "node:path";
import { setTwentyConnectionState, upsertTwentyConnection } from "../db/twenty-connections";

export type PlanInput = {
  orgId: string;
  orgSlug: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  domainSuffix: string;
  postgresHost: string;
  postgresPassword: string;
  appSecret: string;
  encryptionKey: string;
  twentyTag: string;
};

export type TwentyServicePlan = {
  name: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  dockerComposeRaw: string;
  envVars: { key: string; value: string }[];
  fqdn: string;
  apiKeyRef: string;
};

export type CoolifyApi = {
  createService(plan: TwentyServicePlan): Promise<{ uuid: string }>;
  setEnvVars(serviceUuid: string, vars: { key: string; value: string }[]): Promise<void>;
  setFqdn(serviceUuid: string, fqdn: string): Promise<void>;
  deploy(serviceUuid: string): Promise<void>;
  health(serviceUuid: string): Promise<"healthy" | "unhealthy">;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function buildTwentyServicePlan(input: PlanInput): TwentyServicePlan {
  if (!SLUG.test(input.orgSlug)) {
    throw new Error(
      `twenty provisioning: slug must be lowercase alphanumeric with single hyphens, got "${input.orgSlug}"`,
    );
  }
  const underscored = input.orgSlug.replace(/-/g, "_");
  const fqdn = `https://${input.orgSlug}.${input.domainSuffix}`;
  const compose = readFileSync(
    path.join(process.cwd(), "..", "infra/twenty/docker-compose.tenant.yml"),
    "utf-8",
  ).replace(/\$\{TAG\}/g, input.twentyTag);

  return {
    name: `twenty-${input.orgSlug}`,
    projectUuid: input.projectUuid,
    serverUuid: input.serverUuid,
    environmentName: input.environmentName,
    dockerComposeRaw: compose,
    fqdn,
    apiKeyRef: `env://TWENTY_API_KEY_${underscored.toUpperCase()}`,
    envVars: [
      { key: "ORG_SLUG", value: input.orgSlug },
      { key: "TAG", value: input.twentyTag },
      { key: "IS_MULTIWORKSPACE_ENABLED", value: "false" },
      { key: "SERVER_URL", value: fqdn },
      { key: "PG_DATABASE_HOST", value: input.postgresHost },
      { key: "PG_DATABASE_PORT", value: "5432" },
      { key: "PG_DATABASE_USER", value: `twenty_${underscored}` },
      { key: "PG_DATABASE_PASSWORD", value: input.postgresPassword },
      { key: "PG_DATABASE_NAME", value: `twenty_${underscored}` },
      { key: "APP_SECRET", value: input.appSecret },
      { key: "ENCRYPTION_KEY", value: input.encryptionKey },
    ],
  };
}

/**
 * Registers the connection as 'provisioning' before deploying, so a crash
 * halfway leaves a row naming the Coolify service rather than an orphaned
 * container nobody can find. Stops short of 'active': Twenty exposes no
 * endpoint for generating an API key (§9.5), so activation is a separate,
 * deliberate call after the manual step.
 */
export async function provisionTwentyInstance(
  api: CoolifyApi,
  input: PlanInput,
): Promise<{ serviceUuid: string; state: "provisioning" }> {
  const plan = buildTwentyServicePlan(input);
  const { uuid } = await api.createService(plan);

  await upsertTwentyConnection({
    orgId: input.orgId,
    baseUrl: plan.fqdn,
    apiKeyRef: plan.apiKeyRef,
    coolifyServiceUuid: uuid,
    twentyVersion: input.twentyTag,
    state: "provisioning",
  });

  await api.setEnvVars(uuid, plan.envVars);
  await api.setFqdn(uuid, plan.fqdn);
  await api.deploy(uuid);

  const health = await api.health(uuid);
  if (health !== "healthy") {
    await setTwentyConnectionState(
      input.orgId,
      "failed",
      `service ${uuid} never became healthy after deploy`,
    );
    throw new Error(`twenty provisioning: service ${uuid} never became healthy after deploy`);
  }

  return { serviceUuid: uuid, state: "provisioning" };
}

export async function activateTwentyConnection(
  orgId: string,
  apiKeyRef: string,
  twentyVersion: string,
): Promise<void> {
  void apiKeyRef;
  void twentyVersion;
  await setTwentyConnectionState(orgId, "active", null);
}

export function createCoolifyApi(baseUrl: string, token: string): CoolifyApi {
  const base = baseUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function call(method: string, apiPath: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${base}${apiPath}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`coolify ${method} ${apiPath} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : undefined;
  }

  return {
    async createService(plan) {
      const json = (await call("POST", "/api/v1/services", {
        name: plan.name,
        project_uuid: plan.projectUuid,
        server_uuid: plan.serverUuid,
        environment_name: plan.environmentName,
        docker_compose_raw: plan.dockerComposeRaw,
        instant_deploy: false,
      })) as { uuid?: string };
      if (!json?.uuid) throw new Error("coolify: service create returned no uuid");
      return { uuid: json.uuid };
    },
    async setEnvVars(serviceUuid, vars) {
      for (const v of vars) {
        await call("POST", `/api/v1/services/${serviceUuid}/envs`, {
          key: v.key,
          value: v.value,
          is_preview: false,
        });
      }
    },
    async setFqdn(serviceUuid, fqdn) {
      await call("PATCH", `/api/v1/services/${serviceUuid}`, { domains: fqdn });
    },
    async deploy(serviceUuid) {
      await call("GET", `/api/v1/deploy?uuid=${serviceUuid}`);
    },
    async health(serviceUuid) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const json = (await call("GET", `/api/v1/services/${serviceUuid}`)) as {
          status?: string;
        };
        if (json?.status?.includes("running:healthy")) return "healthy";
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      return "unhealthy";
    },
  };
}
