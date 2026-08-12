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
 * Turns any thrown value into a stable code. Never `err.message`: a message can
 * carry an enquiry body or a contact address, and this value reaches a span
 * (datastore §13.3). Task 15 replaces this with the shared `safeErrorCode`.
 */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && /^[a-z_]{3,40}$/.test(code) ? code : "tool_error";
}

/**
 * The one path every tool call takes. Token verification, tool allowlist, span
 * emission — and, from Task 17, the per-tenant cost ceiling. Because
 * registerGuardedTool in index.ts is the only caller of server.registerTool,
 * there is no untraced call path for any of those checks to be bypassed on.
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
    return await run(claims);
  } catch (err) {
    status = "error";
    statusCode = errorCode(err);
    throw err;
  } finally {
    const attributes: Record<string, string | number | boolean> = {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": toolName,
      "gen_ai.agent.name": claims?.profile ?? "unknown",
      "gentlespace.tenant.id": claims?.orgId ?? "unknown",
      "gentlespace.task.id": claims?.taskId ?? "unknown",
      "gen_ai.client.operation.duration": Date.now() - startedAt,
    };
    if (statusCode) attributes["error.type"] = statusCode;
    await getSpanSink().emit({
      name: `execute_tool ${toolName}`,
      attributes,
      startedAt,
      endedAt: Date.now(),
      status,
      statusCode,
    });
  }
}
