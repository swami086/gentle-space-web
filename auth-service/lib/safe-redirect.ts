/**
 * Validates a caller-supplied return_to URL against an allowlist before ever redirecting to it.
 * cookieDomain is the bare host (no leading dot), e.g. "gentlespacesolutions.com" — a target is
 * allowed if its hostname equals that host or is a subdomain of it, or if it's localhost/127.0.0.1
 * (for local dev, where auth-service and ads-agent run on different localhost ports).
 */
export function safeReturnTo(value: string | null, baseUrl: string, cookieDomain: string): string {
  const fallback = new URL("/", baseUrl).toString();
  if (!value) return fallback;

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return fallback;
  }

  const isLocalDev = target.hostname === "localhost" || target.hostname === "127.0.0.1";
  const bareDomain = cookieDomain.replace(/^\./, "");
  const isKnownHost =
    bareDomain !== "" &&
    bareDomain !== "localhost" &&
    (target.hostname === bareDomain || target.hostname.endsWith(`.${bareDomain}`));

  return isLocalDev || isKnownHost ? value : fallback;
}
