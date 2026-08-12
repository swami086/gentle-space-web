import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./twenty-postgres", () => ({ ensureTenantPostgres: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../db/twenty-connections", () => ({ upsertTwentyConnection: vi.fn().mockResolvedValue(undefined) }));

import { upsertTwentyConnection } from "../db/twenty-connections";
import { ensureTenantPostgres } from "./twenty-postgres";
import { localTwentyBaseUrl, localTwentyApiKeyRef, provisionTwentyLocal } from "./twenty-provision-local";

afterEach(() => {
  delete process.env.LOCAL_TWENTY_BASE_URL_TEMPLATE;
  delete process.env.LOCAL_TWENTY_USE_SHARED_KEY;
  delete process.env.SHARED_TWENTY_BASE_URL;
  vi.mocked(ensureTenantPostgres).mockClear();
  vi.mocked(upsertTwentyConnection).mockClear();
});

describe("localTwentyBaseUrl", () => {
  it("uses a slug hostname that is not the shared localhost URL", () => {
    process.env.SHARED_TWENTY_BASE_URL = "http://localhost:3020";
    expect(localTwentyBaseUrl("acme-realty")).toBe("http://twenty-acme-realty.localhost:3020");
  });

  it("honours LOCAL_TWENTY_BASE_URL_TEMPLATE", () => {
    process.env.LOCAL_TWENTY_BASE_URL_TEMPLATE = "http://127.0.0.1:30{slug}";
    expect(localTwentyBaseUrl("acme")).toBe("http://127.0.0.1:30acme");
  });
});

describe("provisionTwentyLocal", () => {
  it("creates tenant postgres and a local registry row without Coolify", async () => {
    process.env.SHARED_TWENTY_BASE_URL = "http://localhost:3020";
    const result = await provisionTwentyLocal({
      orgId: "11111111-1111-1111-1111-111111111111",
      orgSlug: "acme-realty",
      postgresPassword: "unit-test-only",
    });
    expect(result.state).toBe("provisioning");
    expect(ensureTenantPostgres).toHaveBeenCalledOnce();
    expect(upsertTwentyConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        coolifyServiceUuid: "local-acme-realty",
        baseUrl: "http://twenty-acme-realty.localhost:3020",
        apiKeyRef: localTwentyApiKeyRef("acme-realty"),
      }),
    );
  });
});
