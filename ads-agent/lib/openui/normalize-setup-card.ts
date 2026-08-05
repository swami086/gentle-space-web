/**
 * SetupCard-specific named→positional rewrite. Delegates to the shared
 * multi-component normalizer so campaign chat stays in sync with CRM/Reports.
 */
import {
  DEFAULT_FINAL_URL,
  OPENUI_COMPONENT_PROP_SPECS,
  normalizeNamedKwargsLang,
  splitTopLevelArgs,
} from "./normalize-named-kwargs";

export { DEFAULT_FINAL_URL, splitTopLevelArgs } from "./normalize-named-kwargs";

/** SetupCard Zod key order — must stay in sync with SetupCardSchema. */
export const SETUP_CARD_PROP_KEYS = OPENUI_COMPONENT_PROP_SPECS.SetupCard!.keys;

export type SetupCardPropKey = (typeof SETUP_CARD_PROP_KEYS)[number];

/**
 * If `text` contains `SetupCard(name=…)` / `SetupCard(name: …)`, rewrite to
 * positional OpenUI Lang. Leaves already-positional calls unchanged.
 */
export function normalizeSetupCardLang(text: string): string {
  return normalizeNamedKwargsLang(text, {
    SetupCard: OPENUI_COMPONENT_PROP_SPECS.SetupCard!,
  });
}
