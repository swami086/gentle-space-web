/** True when trimmed text is (or starts) an OpenUI Lang component call.
 * Accepts both `root = Name(` and bare `Name(` (models often omit the assignment). */
export function looksLikeOpenUiLang(text: string): boolean {
  return /^(?:root\s*=\s*)?[A-Z]\w*\s*\(/.test(text.trim());
}
