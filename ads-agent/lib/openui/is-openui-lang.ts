/** True when trimmed text begins a `root = ComponentName(` OpenUI Lang statement. */
export function looksLikeOpenUiLang(text: string): boolean {
  return /root\s*=\s*[A-Z]\w*\s*\(/.test(text.trim());
}
