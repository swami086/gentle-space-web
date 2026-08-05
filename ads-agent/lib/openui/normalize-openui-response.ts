/**
 * OpenUI Lang statements should be `root = ComponentName(...)`. Models often omit `root =`
 * and/or emit SetupCard named kwargs — coerce before createParser.
 */
import { normalizeSetupCardLang } from "./normalize-setup-card";

/** Prepend `root = ` when the model emits a bare `ComponentName(` call. */
export function ensureOpenUiRootAssignment(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (/^root\s*=/.test(t)) return t;
  if (/^[A-Z]\w*\s*\(/.test(t)) return `root = ${t}`;
  return t;
}

/** Coerce root assignment + SetupCard named→positional rewrite for Copilot/shared parsers. */
export function normalizeOpenUiResponse(text: string): string {
  let t = ensureOpenUiRootAssignment(text.trim());
  if (/SetupCard\s*\(/.test(t)) t = normalizeSetupCardLang(t);
  return t;
}
