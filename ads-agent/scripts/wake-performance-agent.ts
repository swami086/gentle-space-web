const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WakePerformanceArgs = {
  orgId: string;
  corridor?: string;
};

export function parseWakeArgs(argv: string[]): WakePerformanceArgs {
  let orgId: string | undefined;
  let corridor: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--org-id=")) orgId = a.slice("--org-id=".length);
    if (a.startsWith("--corridor=")) corridor = a.slice("--corridor=".length);
  }
  if (!orgId || !UUID_RE.test(orgId)) {
    throw new Error("wake-performance-agent: --org-id=<uuid> required");
  }
  const out: WakePerformanceArgs = { orgId };
  if (corridor) out.corridor = corridor;
  return out;
}

export async function main(env: NodeJS.ProcessEnv, argv: string[]): Promise<number> {
  const args = parseWakeArgs(argv);
  if (env.HERMES_WAKE !== "1") {
    console.log("wake-performance-agent: not scheduled (set HERMES_WAKE=1 to enable)");
    return 0;
  }
  console.log(
    `wake-performance-agent: stub wake org=${args.orgId}` +
      (args.corridor ? ` corridor=${args.corridor}` : "") +
      " (Hermes API invoke deferred)",
  );
  return 0;
}

const isDirect =
  process.argv[1]?.endsWith("wake-performance-agent.ts") ||
  process.argv[1]?.endsWith("wake-performance-agent.js");
if (isDirect) {
  main(process.env, process.argv.slice(2)).then((c) => process.exit(c));
}
