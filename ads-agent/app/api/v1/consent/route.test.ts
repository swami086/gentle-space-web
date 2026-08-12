import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveIngestKey = vi.fn();
const recordConsent = vi.fn();
vi.mock("@/lib/portal/config", () => ({
  resolveIngestKey: (...a: unknown[]) => resolveIngestKey(...a),
  originAllowed: (origin: string | null, allowed: string[]) => Boolean(origin) && allowed.includes(origin!),
  PLATFORM_SCOPE: { kind: "platform", orgId: "00000000-0000-0000-0000-000000000000" },
}));
vi.mock("@/lib/portal/consent", () => ({ recordConsent: (...a: unknown[]) => recordConsent(...a) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

function request(body: Record<string, unknown>, origin = "https://broker.example"): Request {
  return new Request("https://ads.example/api/v1/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

const grant = {
  ingest_key: "pk_live_broker",
  session_id: "abcdefabcdefabcdef01",
  purposes: ["space_recommendation"],
  action: "granted",
  mechanism: "banner",
};

beforeEach(() => {
  resolveIngestKey.mockReset().mockResolvedValue({
    orgId: ORG,
    allowedOrigins: ["https://broker.example"],
    purposesOffered: ["space_recommendation", "site_analytics"],
    noticeVersion: 3,
  });
  recordConsent.mockReset().mockResolvedValue("consent-1");
});

describe("POST /api/v1/consent", () => {
  it("records a grant with the tenant's current notice version", async () => {
    const { POST } = await import("./route");
    const res = await POST(request(grant));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ consent_id: "consent-1" });
    const [, input] = recordConsent.mock.calls[0];
    expect(input).toEqual({
      subjectRef: "abcdefabcdefabcdef01",
      purposes: ["space_recommendation"],
      action: "granted",
      noticeVersion: 3,
      mechanism: "banner",
    });
  });

  it("records a withdrawal", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ ...grant, action: "withdrawn" }));
    expect(res.status).toBe(202);
    expect(recordConsent.mock.calls[0][1].action).toBe("withdrawn");
  });

  it("returns 404 for an unknown key", async () => {
    resolveIngestKey.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(request(grant))).status).toBe(404);
  });

  it("returns 403 for an unregistered origin", async () => {
    const { POST } = await import("./route");
    expect((await POST(request(grant, "https://evil.example"))).status).toBe(403);
  });

  it("rejects a purpose the broker does not offer", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ ...grant, purposes: ["enquiry_handling"] }));
    expect(res.status).toBe(400);
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("rejects an unknown action rather than storing it", async () => {
    const { POST } = await import("./route");
    expect((await POST(request({ ...grant, action: "maybe" }))).status).toBe(400);
  });
});
