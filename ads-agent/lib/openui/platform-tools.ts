import type { ToolSpec } from "@openuidev/lang-core";
import type { Scope } from "../db/scope-sql";
import { campaignToolProvider, campaignToolSpecs } from "./campaign-tools";
import { createCrmToolProvider, crmToolSpecs } from "./crm-tools";
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
 * The global Copilot's composed tool registry — campaign (start draft), CRM, and analytics.
 * Embedded Campaign Chat still owns rich SetupCard editing; Copilot only starts a draft + deep-link.
 */
export function createPlatformToolProvider(scope: Scope): ToolProviderMap {
  return composeToolProviders(
    campaignToolProvider,
    createCrmToolProvider(scope),
    analyticsToolProvider,
  );
}

export const platformToolSpecs: ToolSpec[] = composeToolSpecs(campaignToolSpecs, crmToolSpecs, analyticsToolSpecs);
