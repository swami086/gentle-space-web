import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  activateTwentyConnectionRow,
  getTwentyConnection,
  setTwentyConnectionState,
  upsertTwentyConnection,
} from "../db/twenty-connections";
import { ensureTenantPostgres } from "./twenty-postgres";

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
  updateCompose(serviceUuid: string, dockerComposeRaw: string): Promise<void>;
  setEnvVars(serviceUuid: string, vars: { key: string; value: string }[]): Promise<void>;
  setFqdn(serviceUuid: string, fqdn: string): Promise<void>;
  deploy(serviceUuid: string): Promise<void>;
  connectToDockerNetwork(serviceUuid: string): Promise<void>;
  health(serviceUuid: string, opts?: { maxWaitMs?: number; onStatus?: (status: string) => void }): Promise<"healthy" | "unhealthy">;
};

export type ProvisionOptions = {
  /** When false, deploy and return — skip the Coolify health poll (default 90s max). */
  waitForHealth?: boolean;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Coolify 4.1: connect_to_docker_network does not always attach on deploy — join Postgres via SSH. */
function ensureTwentyCoolifyNetwork(serviceUuid: string): void {
  const ssh = process.env.TWENTY_PG_ENSURE_SSH?.trim();
  if (!ssh) return;
  const script = `
docker network connect coolify server-${serviceUuid} 2>/dev/null || true
docker network connect coolify worker-${serviceUuid} 2>/dev/null || true
docker restart server-${serviceUuid} worker-${serviceUuid} 2>/dev/null || true
`.trim();
  execFileSync("ssh", ["-o", "BatchMode=yes", ssh, script], { stdio: "inherit" });
}

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
  opts: ProvisionOptions = {},
): Promise<{ serviceUuid: string; state: "provisioning" }> {
  const plan = buildTwentyServicePlan(input);
  const existing = await getTwentyConnection(input.orgId);
  let uuid: string;

  await ensureTenantPostgres({
    orgSlug: input.orgSlug,
    postgresPassword: input.postgresPassword,
  });

  if (existing?.coolifyServiceUuid && ["provisioning", "failed"].includes(existing.state)) {
    uuid = existing.coolifyServiceUuid;
  } else {
    const created = await api.createService(plan);
    uuid = created.uuid;
    await upsertTwentyConnection({
      orgId: input.orgId,
      baseUrl: plan.fqdn,
      apiKeyRef: plan.apiKeyRef,
      coolifyServiceUuid: uuid,
      twentyVersion: input.twentyTag,
      state: "provisioning",
    });
  }

  await api.setEnvVars(uuid, [
    ...plan.envVars,
    // Avoid ambiguous `redis` DNS once connect_to_docker_network joins the shared coolify network.
    { key: "REDIS_URL", value: `redis://redis-${uuid}:6379` },
  ]);
  await api.setFqdn(uuid, plan.fqdn);
  await api.connectToDockerNetwork(uuid);
  await api.updateCompose(uuid, plan.dockerComposeRaw);
  await api.deploy(uuid);
  ensureTwentyCoolifyNetwork(uuid);

  if (opts.waitForHealth === false) {
    console.log(`twenty: deployed ${uuid} (health poll skipped — check Coolify, then --activate)`);
    return { serviceUuid: uuid, state: "provisioning" };
  }

  const health = await api.health(uuid, {
    maxWaitMs: Number(process.env.TWENTY_PROVISION_HEALTH_MAX_MS ?? 90_000),
    onStatus: (status) => console.log(`twenty: waiting for healthy… (${status})`),
  });
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
  await activateTwentyConnectionRow(orgId, apiKeyRef, twentyVersion);
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
    if (!res.ok) {
      const err = new Error(`coolify ${method} ${apiPath} ${res.status}: ${text.slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : undefined;
  }

  return {
    async createService(plan) {
      const json = (await call("POST", "/api/v1/services", {
        name: plan.name,
        project_uuid: plan.projectUuid,
        server_uuid: plan.serverUuid,
        environment_name: plan.environmentName,
        docker_compose_raw: Buffer.from(plan.dockerComposeRaw, "utf-8").toString("base64"),
        instant_deploy: false,
      })) as { uuid?: string };
      if (!json?.uuid) throw new Error("coolify: service create returned no uuid");
      return { uuid: json.uuid };
    },
    async updateCompose(serviceUuid, dockerComposeRaw) {
      await call("PATCH", `/api/v1/services/${serviceUuid}`, {
        docker_compose_raw: Buffer.from(dockerComposeRaw, "utf-8").toString("base64"),
      });
    },
    async setEnvVars(serviceUuid, vars) {
      for (const v of vars) {
        try {
          await call("POST", `/api/v1/services/${serviceUuid}/envs`, {
            key: v.key,
            value: v.value,
            is_preview: false,
          });
        } catch (err) {
          const status = (err as Error & { status?: number }).status;
          if (status !== 409) throw err;
          await call("PATCH", `/api/v1/services/${serviceUuid}/envs`, {
            key: v.key,
            value: v.value,
            is_preview: false,
          });
        }
      }
    },
    async setFqdn(serviceUuid, fqdn) {
      await call("PATCH", `/api/v1/services/${serviceUuid}`, {
        urls: [{ name: "server", url: fqdn }],
        force_domain_override: true,
      });
    },
    async deploy(serviceUuid) {
      await call("GET", `/api/v1/deploy?uuid=${serviceUuid}`);
    },
    async connectToDockerNetwork(serviceUuid) {
      await call("PATCH", `/api/v1/services/${serviceUuid}`, { connect_to_docker_network: true });
    },
    async health(serviceUuid, opts = {}) {
      const maxWaitMs = opts.maxWaitMs ?? 90_000;
      const intervalMs = 5_000;
      const attempts = Math.ceil(maxWaitMs / intervalMs);
      for (let attempt = 0; attempt < attempts; attempt++) {
        const json = (await call("GET", `/api/v1/services/${serviceUuid}`)) as {
          status?: string;
          applications?: { name: string; status?: string }[];
        };
        const status = json?.status ?? "unknown";
        const server = json?.applications?.find((a) => a.name === "server")?.status;
        opts.onStatus?.(server ? `${status} server=${server}` : status);
        if (status.includes("running:healthy")) return "healthy";
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      return "unhealthy";
    },
  };
}
