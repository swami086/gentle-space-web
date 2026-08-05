import type { ToolSpec } from "@openuidev/lang-core";

export type ToolProviderMap = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

/** Merges any number of domain tool-provider maps into one, throwing on a name collision (two
 * domains registering the same tool name is a bug, not a valid override — silently letting the
 * second one win would hide it). */
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

/** Same collision-detection behavior as composeToolProviders, for the prompt-facing ToolSpec[] side. */
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
 * The global Copilot's composed tool registry. Currently merges ZERO domain tool sets — verified
 * during this plan's codebase investigation: Spec 1's Campaign Chat never defined a
 * ToolSpec/ToolProvider (SetupCard is pure structured-output parsing, no Query()/Mutation() calls;
 * see docs/superpowers/specs/2026-08-05-openui-platform-foundation-design.md's Architecture
 * correction), and Specs 2/3 (CRM, Reports) are approved-but-unbuilt. This is the intended
 * extension point: when a domain adds its first `<domain>-tools.ts` (a ToolProviderMap + ToolSpec[]
 * pair, real examples once Spec 2/3 land), import and add it to the two calls below — no other
 * change needed here.
 */
export const platformToolProvider: ToolProviderMap = composeToolProviders(
  // no domain tool providers exist yet — add e.g. campaignToolProvider here once a domain defines one
);
export const platformToolSpecs: ToolSpec[] = composeToolSpecs(
  // no domain tool specs exist yet
);
