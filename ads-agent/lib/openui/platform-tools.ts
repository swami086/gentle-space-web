import type { ToolSpec } from "@openuidev/lang-core";
import { crmToolProvider, crmToolSpecs } from "./crm-tools";
import { analyticsToolProvider, analyticsToolSpecs } from "./analytics-tools";

export type ToolProviderMap = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

export function composeToolProviders(...providers: ToolProviderMap[]): ToolProviderMap {
  const merged: ToolProviderMap = {};
  for (const provider of providers) {
    for (const [name, fn] of Object.entries(provider)) {
      if (name in merged) throw new Error(`platform-tools: duplicate tool name "${name}" across domains`);
      merged[name] = fn;
    }
  }
  return merged;
}

export function composeToolSpecs(...specLists: ToolSpec[][]): ToolSpec[] {
  const merged: ToolSpec[] = [];
  const seen = new Set<string>();
  for (const specs of specLists) {
    for (const spec of specs) {
      if (seen.has(spec.name)) throw new Error(`platform-tools: duplicate tool spec name "${spec.name}" across domains`);
      seen.add(spec.name);
      merged.push(spec);
    }
  }
  return merged;
}

/**
 * The global Copilot's composed tool registry. Now merges crmToolProvider/crmToolSpecs (Spec 3,
 * Task 9) and analyticsToolProvider/analyticsToolSpecs (Spec 2, Task 10) — Spec 1's Campaign Chat
 * still has no ToolSpec/ToolProvider (unchanged finding from the foundation plan), so no campaign
 * entry exists here yet; add one the same way if/when Campaign Chat gets live tool calls.
 */
export const platformToolProvider: ToolProviderMap = composeToolProviders(crmToolProvider, analyticsToolProvider);
export const platformToolSpecs: ToolSpec[] = composeToolSpecs(crmToolSpecs, analyticsToolSpecs);
