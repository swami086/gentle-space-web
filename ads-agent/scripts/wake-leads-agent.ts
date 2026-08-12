const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWakeArgs(argv: string[]): { orgId: string; enquiryId?: string } {
  let orgId: string | undefined;
  let enquiryId: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--org-id=")) orgId = a.slice("--org-id=".length);
    if (a.startsWith("--enquiry-id=")) enquiryId = a.slice("--enquiry-id=".length);
  }
  if (!orgId || !UUID_RE.test(orgId)) throw new Error("wake-leads-agent: --org-id=<uuid> required");
  if (enquiryId !== undefined && !UUID_RE.test(enquiryId)) {
    throw new Error("wake-leads-agent: --enquiry-id must be uuid");
  }
  return enquiryId ? { orgId, enquiryId } : { orgId };
}

export async function main(env: NodeJS.ProcessEnv, argv: string[]): Promise<number> {
  const args = parseWakeArgs(argv);
  if (env.HERMES_WAKE !== "1") {
    console.log("wake-leads-agent: not scheduled (set HERMES_WAKE=1 to enable)");
    return 0;
  }
  console.log(
    `wake-leads-agent: stub wake org=${args.orgId}` +
      (args.enquiryId ? ` enquiry=${args.enquiryId}` : "") +
      " (Hermes API invoke deferred)",
  );
  return 0;
}

const isDirect =
  process.argv[1]?.endsWith("wake-leads-agent.ts") ||
  process.argv[1]?.endsWith("wake-leads-agent.js");
if (isDirect) {
  main(process.env, process.argv.slice(2)).then((c) => process.exit(c));
}
