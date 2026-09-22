import { BuiltinActionType, createLibrary, createParser, type ActionEvent } from "@openuidev/lang-core";
import type { Library } from "@openuidev/react-lang";
// Import from the "./genui-lib" subpath, not the package root ("@openuidev/react-ui") — the root
// barrel is a "use client" module that does `export *`, which Next.js's client-boundary bundler
// rejects ("It's currently unsupported to use \"export *\" in a client boundary"). The genui-lib
// subpath has no "use client" directive and exports the same openuiChatLibrary/componentGroups.
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
import { crmLibrary } from "./crm-library";
import { analyticsLibrary } from "./analytics-library";

/**
 * Merged OpenUI library for Hermes chat replies: openuiChatLibrary's own content/chart/form
 * components (for plain conversational answers) plus the same CRM/analytics domain components the
 * non-Hermes CRM/Reports panels already use — so a Hermes answer about leads or spend renders
 * identically to the equivalent answer from those panels. See
 * docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md, Section B2.
 */
export const hermesLibrary = createLibrary({
  components: [
    ...Object.values(openuiChatLibrary.components),
    ...Object.values(crmLibrary.components),
    ...Object.values(analyticsLibrary.components),
  ] as unknown as NonNullable<Parameters<typeof createLibrary>[0]["components"]>,
  componentGroups: [
    ...(openuiChatLibrary.componentGroups ?? []),
    { name: "CRM", components: ["OpportunityCard", "OpportunityList", "StageChangeConfirm"] },
    { name: "Analytics", components: ["TrendChart", "DataTable"] },
  ],
}) as Library;

/**
 * Stricter guard for Hermes' free-form OpenUI Lang output. Hermes isn't fine-tuned on OpenUI Lang
 * like the four domain models are, so malformed syntax is more likely — this parses against the
 * merged schema and rejects on ANY validation error (unknown-component, missing-required, etc.) or
 * an unparseable root, instead of letting Renderer surface a broken partial render. See Section B6.
 */
export function looksValidOpenUiLang(response: string, library: Library): boolean {
  try {
    const result = createParser(library.toJSONSchema()).parse(response);
    return result.meta.errors.length === 0 && result.root !== null;
  } catch {
    return false;
  }
}

/**
 * `hermes.tool.progress` events (see server-client.ts) carry the raw MCP tool id
 * (`get_spend_cpl_trend`) — turn that into something readable for the "Working: …" indicator the
 * four chat panels show while Hermes is between tool calls, without a hardcoded name-by-name map
 * to maintain as tools are added/removed.
 */
export function humanizeToolName(tool: string): string {
  return tool.replace(/[_-]+/g, " ").trim() || tool;
}

/**
 * Pure strip lives in hermes-strip.ts so API routes can import without pulling
 * `@openuidev/react-lang` (createContext) into the RSC bundle. Re-export keeps
 * existing client imports (`from hermes-library`) working.
 */
export { stripHermesStepNarration } from "./hermes-strip";

export type ResolvedOpenUiAction = { kind: "send"; text: string } | { kind: "open_url"; url: string } | { kind: "noop" };

/**
 * Translates the Renderer's structured `onAction` event into what a chat panel should do with it.
 * A `FollowUpItem` click, for example, calls `useTriggerAction()` internally (see
 * `@openuidev/react-lang`'s compiled `useFormValidation-*.cjs`), which fires `onAction` with
 * `{ type: "continue_conversation", humanFriendlyMessage: <clicked text> }` — no explicit
 * `@ToAssistant` needed in the OpenUI Lang itself for the common case. `@OpenUrl` actions fire
 * `{ type: "open_url", params: { url } }` instead. Every panel wires this to every `<Renderer
 * onAction>`, not just Hermes-mode ones — it's a no-op today for the non-Hermes domain libraries
 * (none of their components call `triggerAction`), but removes the need to touch these call
 * sites again once default-mode interactivity (follow-ups/forms) is added in a later phase.
 *
 * Hermes composes `OpenUrl` calls itself from free-form model output (unlike the four domain
 * models, which only ever echo tool-result URLs) — restrict to http(s) so a hallucinated
 * `javascript:`/`data:` URI can't execute in the page via `window.open`.
 */
export function resolveOpenUiAction(event: ActionEvent): ResolvedOpenUiAction {
  if (event.type === BuiltinActionType.OpenUrl && typeof event.params.url === "string") {
    const url = event.params.url;
    const isHttpUrl = /^https?:\/\//i.test(url);
    return isHttpUrl ? { kind: "open_url", url } : { kind: "noop" };
  }
  const text = event.humanFriendlyMessage?.trim();
  return text ? { kind: "send", text } : { kind: "noop" };
}
