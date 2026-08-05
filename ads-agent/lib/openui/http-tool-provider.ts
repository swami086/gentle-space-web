import type { ToolProviderMap } from "./platform-tools";

/**
 * Client-safe toolProvider: each OpenUI Query()/Mutation() becomes a POST to
 * `/api/openui/tools`. Keeps server modules (pg, Twenty) out of the client bundle.
 */
export function createHttpToolProvider(toolNames: string[]): ToolProviderMap {
  const map: ToolProviderMap = {};
  for (const name of toolNames) {
    map[name] = async (args: Record<string, unknown>) => {
      const res = await fetch("/api/openui/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args: args ?? {} }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `tool "${name}" failed (${res.status})`);
      }
      return res.json();
    };
  }
  return map;
}
