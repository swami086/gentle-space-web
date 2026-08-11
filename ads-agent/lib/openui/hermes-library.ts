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
 * Hermes' underlying model (Gemini 2.5 Pro via Vertex, `reasoning_effort: high`) already separates
 * true chain-of-thought into a distinct `reasoning`/`thought` channel that never reaches this app
 * (see hermes-agent's gemini_native_adapter.py: `part.get("thought") is True`). What lands in the
 * visible `content` string instead is the model's own step-by-step narration of its tool-use plan —
 * bolded headers like "**Finding Ad Spend Trends** I'm now going to..." — which is genuine answer
 * content from Hermes' point of view, not something any Hermes config setting removes: neither
 * `display.tool_progress: off` nor `display.interim_assistant_messages: false` touch it (verified
 * against Hermes' own docs/source — both gate separate progress-event and mid-turn-message channels,
 * not this one). Since the system-prompt instruction not to narrate is a soft constraint the model
 * doesn't reliably obey, strip it here: keep whatever text follows the LAST "**Bold Header**" marker,
 * since the model always narrates its plan before its actual conclusion, never after.
 *
 * Hermes doesn't always bother with bold headers, though — cheaper models (gemini-2.5-flash) often
 * narrate in plain prose instead ("I've successfully parsed the JSON string. Now I am transforming
 * ... root = TrendChart(...)"), which leaves `looksLikeOpenUiLang` failing (it requires the OpenUI
 * statement to be the very first thing in the string) and the whole reply falling back to a wall of
 * raw text. Apply the same "keep only what follows the LAST marker" logic a second time, using a
 * bare `root = Component(` as the marker instead of a bold header, chaining off whatever the header
 * pass already trimmed.
 */
/**
 * Hermes' prompt already says "never named kwargs, always positional args in Zod key order"
 * (buildHermesSystemPreamble in lib/decision-engine/hermes-chat.ts), matching the OpenUI Lang v0.5
 * spec's own rule ("Positional only: write `Stack([children], "row", "l")` NOT `Stack([children],
 * direction: "row", gap: "l")`" — openui.com/docs/openui-lang/specification-v05). Cheaper models
 * ignore that instruction in practice, emitting e.g. `TrendChart("title", points=[...])`. The
 * installed `@openuidev/lang-core` parser has no leniency flag for this — it's positional-only with
 * no fallback — so `looksValidOpenUiLang` correctly rejects the call and the whole reply falls back
 * to plain text. Since re-prompting doesn't reliably fix it (same class of problem as the narration
 * above), normalize syntactically instead: drop any `identifier=` that immediately follows a `(` or
 * `,` inside a call. This turns `Component(a, name=b)` into `Component(a, b)` without touching
 * top-level `$var = ...` / `var = Query(...)` assignments (never preceded by `(` or `,`) or
 * object-literal `"key": value` pairs (colon, not equals).
 */
function stripNamedKwargs(text: string): string {
  return text.replace(/([(,]\s*)[a-zA-Z_]\w*\s*=\s*(?!=)/g, "$1");
}

export function stripHermesStepNarration(text: string): string {
  // Header spans are usually a short noun phrase ("**Finding Ad Spend Trends**") but Hermes
  // sometimes writes a full sentence as the "header" instead — cap generously (200 chars) rather
  // than assuming they're short, since an unmatched header leaves the whole wall of text intact.
  const headers = [...text.matchAll(/\*\*[^*\n]{2,200}\*\*/g)];
  const last = headers[headers.length - 1];
  const afterHeader = last ? text.slice(last.index! + last[0].length).trim() : text;
  const result = afterHeader || text.trim();

  const rootStatements = [...result.matchAll(/root\s*=\s*[A-Z]\w*\s*\(/g)];
  const lastRoot = rootStatements[rootStatements.length - 1];
  const withoutLeadingProse = lastRoot && lastRoot.index! > 0 ? result.slice(lastRoot.index!).trim() : result;
  return stripNamedKwargs(withoutLeadingProse);
}

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
