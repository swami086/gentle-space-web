/**
 * OpenUI Renderer `onError` is called with `[]` when errors clear
 * (https://www.openui.com/docs/openui-lang/renderer). Hosts must treat empty as resolved —
 * never map `errors[0]?.message ?? fallback` or a successful Query render shows a false error.
 *
 * `excess-args` still renders (extras dropped); don't surface it as a hard UI failure.
 */
export type OpenUiRendererError = {
  code?: string;
  message?: string;
  source?: string;
  hint?: string;
};

const NON_BLOCKING = new Set(["excess-args"]);

export function openUiRenderErrorMessage(errors: OpenUiRendererError[]): string | null {
  if (!errors.length) return null;
  const blocking = errors.filter((e) => !e.code || !NON_BLOCKING.has(e.code));
  if (!blocking.length) return null;
  return blocking[0]?.message?.trim() || "Couldn't render that response.";
}
