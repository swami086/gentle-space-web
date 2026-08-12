import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otlpSpanSink, resolveOtlpEndpoint, toOtlpPayload } from "./otlp-sink";
import type { SpanRecord } from "../../mcp/context-server/tool-context";

const SPAN: SpanRecord = {
  name: "execute_tool get_enquiry",
  attributes: {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": "get_enquiry",
    "gen_ai.agent.name": "leads",
    "gentlespace.tenant.id": "11111111-1111-1111-1111-111111111111",
    "gen_ai.client.token.usage": 120,
  },
  startedAt: 1_760_000_000_000,
  endedAt: 1_760_000_000_250,
  status: "ok",
  statusCode: null,
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LANGFUSE_OTLP_ENDPOINT = "http://langfuse-web:3000/api/public/otel/v1/traces";
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LANGFUSE_OTLP_ENDPOINT;
});

describe("toOtlpPayload", () => {
  it("builds one resourceSpans entry with the service name and nanosecond timestamps", () => {
    const payload = toOtlpPayload([SPAN], "context-mcp") as {
      resourceSpans: {
        resource: { attributes: { key: string; value: { stringValue?: string } }[] };
        scopeSpans: { spans: { name: string; startTimeUnixNano: string; endTimeUnixNano: string }[] }[];
      }[];
    };
    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].resource.attributes).toEqual(
      expect.arrayContaining([{ key: "service.name", value: { stringValue: "context-mcp" } }]),
    );
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("execute_tool get_enquiry");
    expect(span.startTimeUnixNano).toBe("1760000000000000000");
    expect(span.endTimeUnixNano).toBe("1760000000250000000");
  });

  it("emits string attributes as stringValue and numbers as intValue", () => {
    const payload = JSON.stringify(toOtlpPayload([SPAN], "context-mcp"));
    expect(payload).toContain('{"key":"gen_ai.tool.name","value":{"stringValue":"get_enquiry"}}');
    expect(payload).toContain('{"key":"gen_ai.client.token.usage","value":{"intValue":"120"}}');
  });

  it("never emits gen_ai.input.messages or gen_ai.output.messages", () => {
    const payload = JSON.stringify(
      toOtlpPayload(
        [{ ...SPAN, attributes: { ...SPAN.attributes, "gen_ai.input.messages": "hello Asha" } }],
        "context-mcp",
      ),
    );
    expect(payload).not.toContain("gen_ai.input.messages");
    expect(payload).not.toContain("hello Asha");
  });

  it("gives every span a 32-hex trace id and a 16-hex span id", () => {
    const payload = toOtlpPayload([SPAN], "context-mcp") as {
      resourceSpans: { scopeSpans: { spans: { traceId: string; spanId: string }[] }[] }[];
    };
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("otlpSpanSink", () => {
  it("POSTs to the endpoint with basic auth built from the Langfuse keys", async () => {
    await otlpSpanSink().emit(SPAN);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://langfuse-web:3000/api/public/otel/v1/traces");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toBe(`Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`);
  });

  it("never throws when the collector is down: telemetry must not break a tool call", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(otlpSpanSink().emit(SPAN)).resolves.toBeUndefined();
  });

  it("is a no-op when no endpoint is configured", async () => {
    delete process.env.LANGFUSE_OTLP_ENDPOINT;
    await otlpSpanSink().emit(SPAN);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveOtlpEndpoint()).toBeNull();
  });
});
