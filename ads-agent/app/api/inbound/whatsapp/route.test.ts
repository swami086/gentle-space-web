import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyWhatsAppHubChallenge,
  verifyWhatsAppSignature,
  platformOrgScope,
  withTenantTransaction,
  insertInboundEvent,
} = vi.hoisted(() => ({
  verifyWhatsAppHubChallenge: vi.fn(),
  verifyWhatsAppSignature: vi.fn(),
  platformOrgScope: vi.fn(),
  withTenantTransaction: vi.fn(),
  insertInboundEvent: vi.fn(),
}));

vi.mock("../../../../lib/inbound/whatsapp-verify", () => ({
  verifyWhatsAppHubChallenge: (...args: unknown[]) => verifyWhatsAppHubChallenge(...args),
  verifyWhatsAppSignature: (...args: unknown[]) => verifyWhatsAppSignature(...args),
}));

vi.mock("../../../../lib/inbound/platform-scope", () => ({
  platformOrgScope: (...args: unknown[]) => platformOrgScope(...args),
}));

vi.mock("../../../../lib/db/tx", () => ({
  withTenantTransaction: (...args: unknown[]) => withTenantTransaction(...args),
}));

vi.mock("../../../../lib/db/inbound-events", () => ({
  insertInboundEvent: (...args: unknown[]) => insertInboundEvent(...args),
}));

const scope = { kind: "org" as const, orgId: "platform-org-1" };

beforeEach(() => {
  verifyWhatsAppHubChallenge.mockReset();
  verifyWhatsAppSignature.mockReset();
  platformOrgScope.mockReset().mockReturnValue(scope);
  withTenantTransaction.mockReset().mockImplementation(
    async (_scope: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
  );
  insertInboundEvent.mockReset();
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-token";
  process.env.WHATSAPP_APP_SECRET = "app-secret";
});

describe("GET /api/inbound/whatsapp", () => {
  it("returns hub.challenge when verification succeeds", async () => {
    verifyWhatsAppHubChallenge.mockReturnValue("12345");
    const { GET } = await import("./route");

    const res = await GET(
      new Request(
        "https://ads.example/api/inbound/whatsapp?hub.verify_token=verify-token&hub.challenge=12345",
      ),
    );

    expect(verifyWhatsAppHubChallenge).toHaveBeenCalledWith(expect.any(URLSearchParams), "verify-token");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("12345");
  });

  it("returns 403 when verification fails", async () => {
    verifyWhatsAppHubChallenge.mockReturnValue(null);
    const { GET } = await import("./route");

    const res = await GET(
      new Request(
        "https://ads.example/api/inbound/whatsapp?hub.verify_token=bad-token&hub.challenge=12345",
      ),
    );

    expect(res.status).toBe(403);
  });
});

describe("POST /api/inbound/whatsapp", () => {
  const signature = "sha256=signature";

  function makeRequest(body: unknown): Request {
    return new Request("https://ads.example/api/inbound/whatsapp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: JSON.stringify(body),
    });
  }

  it("rejects invalid signatures with 401 and no writes", async () => {
    verifyWhatsAppSignature.mockReturnValue(false);
    const { POST } = await import("./route");

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(401);
    expect(withTenantTransaction).not.toHaveBeenCalled();
    expect(insertInboundEvent).not.toHaveBeenCalled();
  });

  it("verifies signature on raw body, inserts events, and returns 200", async () => {
    verifyWhatsAppSignature.mockReturnValue(true);
    insertInboundEvent.mockResolvedValue({ id: "evt-1", inserted: true });

    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: "wamid.1", text: { body: "hello" } },
                  { id: "wamid.2", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyText = JSON.stringify(payload);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(payload));

    expect(verifyWhatsAppSignature).toHaveBeenCalledWith(bodyText, signature, "app-secret");
    expect(withTenantTransaction).toHaveBeenCalledWith(scope, expect.any(Function));
    expect(insertInboundEvent).toHaveBeenCalledTimes(2);
    expect(insertInboundEvent).toHaveBeenCalledWith(
      scope,
      expect.anything(),
      expect.objectContaining({ channel: "whatsapp", externalId: "wamid.1" }),
    );
    expect(insertInboundEvent).toHaveBeenCalledWith(
      scope,
      expect.anything(),
      expect.objectContaining({ channel: "whatsapp", externalId: "wamid.2" }),
    );
    expect(res.status).toBe(200);
  });

  it("handles payloads with no messages as a no-op 200", async () => {
    verifyWhatsAppSignature.mockReturnValue(true);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ object: "whatsapp_business_account", entry: [] }),
    );

    expect(insertInboundEvent).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

