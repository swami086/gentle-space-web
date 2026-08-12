/**
 * One seam for open question B4 (which secret store backs api_key_ref). The
 * registry stores a reference, never a key, so replacing this function is the
 * whole change when B4 is answered.
 *
 * Supported today: "env://VAR_NAME", read from the process environment.
 */
export async function resolveTwentyApiKey(apiKeyRef: string): Promise<string> {
  if (apiKeyRef.startsWith("env://")) {
    const name = apiKeyRef.slice("env://".length);
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`twenty: secret ${apiKeyRef} is not set`);
    return value;
  }
  throw new Error(
    `twenty: unsupported api_key_ref scheme "${apiKeyRef}" — see open question B4`,
  );
}
