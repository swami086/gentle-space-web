import { assertWithinCeiling, recordTokenUsage } from "../../lib/db/agent-cost";
import { assertNoMessageBodies, safeErrorCode } from "../../lib/tracing/redact";
import { assertToolAllowed, verifyTaskToken, type TaskTokenClaims } from "./task-token";

export type SpanRecord = {
  name: string;
  attributes: Record<string, string | number | boolean>;
  startedAt: number;
  endedAt: number;
  status: "ok" | "error";
  statusCode: string | null;
};

export interface SpanSink {
  emit(span: SpanRecord): void | Promise<void>;
}

/** Collects spans in memory. Used by tests, and by nothing else. */
export function bufferSpanSink(): SpanSink & { spans: SpanRecord[] } {
  const spans: SpanRecord[] = [];
  return {
    spans,
    emit(span) {
      spans.push(span);
    },
  };
}

const consoleSpanSink: SpanSink = {
  emit(span) {
    console.log(JSON.stringify({ span: span.name, ...span.attributes, status: span.status }));
  },
};

let sink: SpanSink = consoleSpanSink;

export function setSpanSink(next: SpanSink): void {
  sink = next;
}

export function getSpanSink(): SpanSink {
  return sink;
}

/**
 * The one path every tool call takes: token verification, tool allowlist, cost
 * ceiling, execution, token-usage record, span emission. `registerGuardedTool`
 * in index.ts is the only caller of server.registerTool, so there is no
 * untraced call path on which any of those can be bypassed — which matters
 * because the token metrics are the same signal that enforces the per-tenant
 * ceiling (agent spec §8a).
 */
export async function dispatchTool<T>(
  toolName: string,
  token: string,
  run: (claims: TaskTokenClaims) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let claims: TaskTokenClaims | null = null;
  let status: "ok" | "error" = "ok";
  let statusCode: string | null = null;
  try {
    claims = await verifyTaskToken(token);
    assertToolAllowed(claims, toolName);
    // Halts rather than warns, and before any work is paid for.
    await assertWithinCeiling(claims.orgId);
    return await run(claims);
  } catch (err) {
    status = "error";
    statusCode = safeErrorCode(err);
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    if (claims) {
      // A tool call costs even when it fails, so it meters either way. Metering
      // must not mask the original error, hence the swallow.
      await recordTokenUsage(claims.orgId, {
        profile: claims.profile,
        tool: toolName,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }).catch(() => undefined);
    }
    const attributes: Record<string, string | number | boolean> = {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": toolName,
      "gen_ai.agent.name": claims?.profile ?? "unknown",
      "gentlespace.tenant.id": claims?.orgId ?? "unknown",
      "gentlespace.task.id": claims?.taskId ?? "unknown",
      "gen_ai.client.operation.duration": durationMs,
      "gen_ai.client.token.usage": 0,
    };
    if (statusCode) attributes["error.type"] = statusCode;
    try {
      // Structure only. If an attribute ever violates the rule, the span is
      // dropped rather than emitted — telemetry is never worth a PII leak, and
      // a dropped span cannot change the tool's result.
      assertNoMessageBodies(attributes);
      await getSpanSink().emit({
        name: `execute_tool ${toolName}`,
        attributes,
        startedAt,
        endedAt: Date.now(),
        status,
        statusCode,
      });
    } catch {
      console.warn(JSON.stringify({ event: "span_dropped", tool: toolName }));
    }
  }
}
