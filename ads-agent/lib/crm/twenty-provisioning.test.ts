import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertTwentyConnection, setTwentyConnectionState } = vi.hoisted(() => ({
  upsertTwentyConnection: vi.fn(),
  setTwentyConnectionState: vi.fn(),
}));
vi.mock("../db/twenty-connections", () => ({
  upsertTwentyConnection,
  setTwentyConnectionState,
}));

import {
  activateTwentyConnection,
  buildTwentyServicePlan,
  provisionTwentyInstance,
  type CoolifyApi,
} from "./twenty-provisioning";

const input = {
  orgId: "11111111-1111-1111-1111-111111111111",
  orgSlug: "acme-realty",
  projectUuid: "proj-1",
  serverUuid: "srv-1",
  environmentName: "production",
  domainSuffix: "crm.gentlespace.in",
  postgresHost: "postgres.internal",
  postgresPassword: "unit-test-only",
  appSecret: "unit-test-only",
  encryptionKey: "unit-test-only",
  twentyTag: "v1.9.0",
};

function fakeApi(): CoolifyApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    createService: vi.fn(async () => {
      calls.push("createService");
      return { uuid: "svc-abc" };
    }),
    setEnvVars: vi.fn(async () => {
      calls.push("setEnvVars");
    }),
    setFqdn: vi.fn(async () => {
      calls.push("setFqdn");
    }),
    deploy: vi.fn(async () => {
      calls.push("deploy");
    }),
    health: vi.fn(async () => {
      calls.push("health");
      return "healthy" as const;
    }),
  };
}

beforeEach(() => {
  upsertTwentyConnection.mockReset().mockResolvedValue(undefined);
  setTwentyConnectionState.mockReset().mockResolvedValue(undefined);
});

describe("buildTwentyServicePlan", () => {
  it("gives the org its own database name, fqdn and single-workspace mode", () => {
    const plan = buildTwentyServicePlan(input);
    expect(plan.name).toBe("twenty-acme-realty");
    expect(plan.fqdn).toBe("https://acme-realty.crm.gentlespace.in");
    const env = Object.fromEntries(plan.envVars.map((v) => [v.key, v.value]));
    expect(env.IS_MULTIWORKSPACE_ENABLED).toBe("false");
    expect(env.PG_DATABASE_NAME).toBe("twenty_acme_realty");
    expect(env.SERVER_URL).toBe("https://acme-realty.crm.gentlespace.in");
    expect(plan.dockerComposeRaw).toContain("twentycrm/twenty:v1.9.0");
  });

  it("never publishes a host port, because N instances would collide on 3020", () => {
    expect(buildTwentyServicePlan(input).dockerComposeRaw).not.toContain("3020:");
  });

  it("refuses a slug that would not be a safe database name or hostname", () => {
    expect(() => buildTwentyServicePlan({ ...input, orgSlug: "Acme Realty!" })).toThrow(
      /slug must be lowercase/i,
    );
  });
});

describe("provisionTwentyInstance", () => {
  it("registers the connection before deploying, so a crash leaves a traceable row", async () => {
    const api = fakeApi();
    const result = await provisionTwentyInstance(api, input);
    expect(result).toEqual({ serviceUuid: "svc-abc", state: "provisioning" });
    expect(api.calls).toEqual(["createService", "setEnvVars", "setFqdn", "deploy", "health"]);
    expect(upsertTwentyConnection).toHaveBeenCalledWith({
      orgId: input.orgId,
      baseUrl: "https://acme-realty.crm.gentlespace.in",
      apiKeyRef: "env://TWENTY_API_KEY_ACME_REALTY",
      coolifyServiceUuid: "svc-abc",
      twentyVersion: "v1.9.0",
      state: "provisioning",
    });
    expect(setTwentyConnectionState).not.toHaveBeenCalledWith(input.orgId, "active");
  });

  it("marks the connection failed when the instance never becomes healthy", async () => {
    const api = fakeApi();
    api.health = vi.fn(async () => "unhealthy" as const);
    await expect(provisionTwentyInstance(api, input)).rejects.toThrow(/never became healthy/i);
    expect(setTwentyConnectionState).toHaveBeenCalledWith(
      input.orgId,
      "failed",
      expect.stringContaining("healthy"),
    );
  });
});

describe("activateTwentyConnection", () => {
  it("is the only thing that flips the state to active", async () => {
    await activateTwentyConnection(input.orgId, "env://TWENTY_API_KEY_ACME_REALTY", "v1.9.0");
    expect(setTwentyConnectionState).toHaveBeenCalledWith(input.orgId, "active", null);
  });
});
