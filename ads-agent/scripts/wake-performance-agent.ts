import {
  buildPerformanceWakeMessage,
  invokeHermesProfileWakeApi,
  invokeHermesProfileWakeCli,
  passEnvFromProcess,
  resolveWakeTransport,
  wakeLooksComplete,
  WAKE_PASS_ENV_KEYS,
  type HermesWakeInvokeResult,
} from "../lib/hermes/wake-invoke";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WakePerformanceArgs = {
  orgId: string;
  corridor?: string;
};

export type WakePerformanceDeps = {
  invokeCli: typeof invokeHermesProfileWakeCli;
  invokeApi: typeof invokeHermesProfileWakeApi;
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

function hermesApiConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.HERMES_API_SERVER_URL?.trim() && env.HERMES_API_SERVER_KEY?.trim());
}

export async function main(
  env: NodeJS.ProcessEnv,
  argv: string[],
  deps: WakePerformanceDeps = {
    invokeCli: invokeHermesProfileWakeCli,
    invokeApi: invokeHermesProfileWakeApi,
  },
): Promise<number> {
  const args = parseWakeArgs(argv);
  if (env.HERMES_WAKE !== "1") {
    console.log("wake-performance-agent: not scheduled (set HERMES_WAKE=1 to enable)");
    return 0;
  }

  const timeoutRaw = env.HERMES_WAKE_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 300_000;
  const timeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000;
  const transport = resolveWakeTransport(env);
  const message = buildPerformanceWakeMessage(args);

  console.log(
    `wake-performance-agent: invoking Hermes transport=${transport} profile=performance org=${args.orgId}` +
      (args.corridor ? ` corridor=${args.corridor}` : ""),
  );

  let result: HermesWakeInvokeResult;
  if (transport === "api") {
    if (!hermesApiConfigured(env)) {
      console.error(
        "wake-performance-agent: HERMES_API_SERVER_URL and HERMES_API_SERVER_KEY are required for transport=api",
      );
      return 1;
    }
    result = await deps.invokeApi({
      profile: "performance",
      message,
      baseUrl: env.HERMES_API_SERVER_URL!.trim(),
      apiKey: env.HERMES_API_SERVER_KEY!.trim(),
      model: env.HERMES_API_SERVER_MODEL?.trim(),
      timeoutMs: timeout,
    });
  } else {
    result = await deps.invokeCli({
      profile: "performance",
      skill: "performance-review",
      message,
      timeoutMs: timeout,
      container: env.HERMES_DOCKER_CONTAINER?.trim() || "hermes",
      passEnv: passEnvFromProcess(env, [...WAKE_PASS_ENV_KEYS]),
    });
  }

  if (!result.ok) {
    console.error(
      `wake-performance-agent: Hermes invoke failed status=${result.status} error=${result.error}`,
    );
    return 1;
  }
  console.log(`wake-performance-agent: ok\n${result.content}`);
  if (!wakeLooksComplete(result.content)) {
    console.error("wake-performance-agent: finished without proposalId= (incomplete)");
    return 1;
  }
  return 0;
}

const isDirect =
  process.argv[1]?.endsWith("wake-performance-agent.ts") ||
  process.argv[1]?.endsWith("wake-performance-agent.js");
if (isDirect) {
  main(process.env, process.argv.slice(2)).then((c) => process.exit(c));
}
