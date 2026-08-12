import { randomBytes } from "node:crypto";
import type { SpanRecord, SpanSink } from "../../mcp/context-server/tool-context";

/**
 * Instrumented to the OTEL GenAI conventions rather than to Langfuse's SDK, so
 * the backend can be swapped without re-instrumenting (datastore §13.2).
 *
 * Emitted as OTLP/HTTP JSON with `fetch` and no OTEL SDK, because the standing
 * constraint is no new dependencies and this is one POST of one envelope. If
 * batching, context propagation across processes, or metric instruments become
 * necessary, that is the point to ask about adding @opentelemetry/sdk-node —
 * not before.
 *
 * Set OTEL_SEMCONV_STABILITY_OPT_IN=http,database when upgrading to OTEL SDK
 * so gen_ai.* attributes stay on the stable semantic convention track.
 */
const FORBIDDEN_ATTRIBUTES = new Set([
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.prompt",
  "gen_ai.completion",
]);

export function resolveOtlpEndpoint(): string | null {
  const raw = process.env.LANGFUSE_OTLP_ENDPOINT?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function attributeValue(value: string | number | boolean) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: value };
}

export function toOtlpPayload(spans: SpanRecord[], serviceName: string): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: "gentlespace.context-mcp", version: "1.0.0" },
            spans: spans.map((span) => ({
              traceId: randomBytes(16).toString("hex"),
              spanId: randomBytes(8).toString("hex"),
              name: span.name,
              kind: 1,
              startTimeUnixNano: `${span.startedAt}000000`,
              endTimeUnixNano: `${span.endedAt}000000`,
              // Message bodies are never captured on spans. Filtering here as
              // well as at the call site means a future caller cannot add one
              // by accident (datastore §13.3).
              attributes: Object.entries(span.attributes)
                .filter(([key]) => !FORBIDDEN_ATTRIBUTES.has(key))
                .map(([key, value]) => ({ key, value: attributeValue(value) })),
              status: span.status === "error" ? { code: 2, message: span.statusCode ?? "" } : { code: 1 },
            })),
          },
        ],
      },
    ],
  };
}

export function otlpSpanSink(serviceName = "context-mcp"): SpanSink {
  return {
    async emit(span: SpanRecord): Promise<void> {
      const endpoint = resolveOtlpEndpoint();
      if (!endpoint) return;
      const auth = Buffer.from(
        `${process.env.LANGFUSE_PUBLIC_KEY ?? ""}:${process.env.LANGFUSE_SECRET_KEY ?? ""}`,
      ).toString("base64");
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
          body: JSON.stringify(toOtlpPayload([span], serviceName)),
        });
      } catch {
        // A collector being down must never fail a tool call, and the caught
        // error is deliberately not logged: it can carry the request body.
      }
    },
  };
}
