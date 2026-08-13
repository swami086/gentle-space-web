/**
 * Wake a named Hermes profile.
 *
 * Transports:
 * - `cli` (default): `docker exec` + official `hermes -p <profile> chat`
 *   (Nous docs: aliases are `hermes -p <name>` under the hood; loads that
 *   profile's config/.env/MCP/skills). Prefer CLI when mint needs terminal —
 *   api_server typically disables terminal for security.
 * - `api`: POST /p/<profile>/v1/chat/completions (needs multiplex_profiles;
 *   MCP/terminal may be incomplete on api_server).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type HermesWakeTransport = "cli" | "api";

export type HermesWakeInvokeResult =
  | { ok: true; status: number; content: string }
  | { ok: false; status: number; error: string };

export type HermesWakeApiInput = {
  transport?: "api";
  profile: string;
  message: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

export type HermesWakeCliInput = {
  transport: "cli";
  profile: string;
  skill: string;
  message: string;
  timeoutMs?: number;
  container?: string;
  /** Extra env passed into the container (mint keys, org ids, base URL). */
  passEnv?: Record<string, string>;
  spawnFn?: typeof spawn;
};

export type HermesWakeInvokeInput = HermesWakeApiInput | HermesWakeCliInput;

type ChatCompletionJson = {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string } | string;
};

export function resolveWakeTransport(env: NodeJS.ProcessEnv): HermesWakeTransport {
  const raw = (env.HERMES_WAKE_TRANSPORT || "cli").trim().toLowerCase();
  return raw === "api" ? "api" : "cli";
}

export function hermesProfileChatUrl(baseUrl: string, profile: string): string {
  const root = baseUrl.replace(/\/$/, "");
  const name = profile.trim();
  if (!name) throw new Error("hermes wake: profile is required");
  return `${root}/p/${encodeURIComponent(name)}/v1/chat/completions`;
}

export function buildPerformanceWakeMessage(input: {
  orgId: string;
  corridor?: string;
}): string {
  const corridorLine = input.corridor
    ? `Optional corridor filter: ${input.corridor}.`
    : "No corridor filter.";
  return [
    "CRITICAL: Call tools immediately. NEVER invent AGENT_INTERNAL_API_KEY / org ids / tokens (no test_key).",
    "Follow the performance-review skill.",
    `Org id: ${input.orgId}.`,
    corridorLine,
    "Mint: TOKEN=$(bash /opt/data/profiles/performance/workspace/mint-task-token.sh performance)",
    "Use MCP tools (tool_search if needed): mcp__context_mcp__get_campaign_performance,",
    "mcp__context_mcp__get_context_pack, mcp__context_mcp__create_proposal.",
    "Do NOT look for context-mcp on the filesystem; it is an MCP server.",
    "create_proposal kind=campaign.pause with pack evidence.",
    "Final reply ONLY: proposalId=… campaignId=… spend=… pending=true",
  ].join("\n");
}

export function buildCampaignWakeMessage(input: {
  orgId: string;
  corridor?: string;
}): string {
  const corridor = input.corridor?.trim() || "Whitefield";
  return [
    "CRITICAL: Call tools immediately. NEVER invent AGENT_INTERNAL_API_KEY / org ids / tokens (no test_key).",
    "Follow the campaign-draft skill.",
    `Org id: ${input.orgId}.`,
    `Target corridor: ${corridor}.`,
    "Mint: TOKEN=$(bash /opt/data/profiles/campaign/workspace/mint-task-token.sh campaign)",
    "Required MCP: mcp__context_mcp__get_campaign_performance before propose.",
    "Prefer mcp__context_mcp__create_proposal kind=campaign.create; if stale_data_refusal, report and stop.",
    "Do NOT look for context-mcp on the filesystem.",
    "Final reply ONLY: proposalId=… kind=campaign.create|campaign.budget_change pending=true",
  ].join("\n");
}

export async function invokeHermesProfileWakeApi(
  input: Omit<HermesWakeApiInput, "transport">,
): Promise<HermesWakeInvokeResult> {
  const url = hermesProfileChatUrl(input.baseUrl, input.profile);
  const fetchFn = input.fetchFn ?? fetch;
  const timeoutMs = input.timeoutMs ?? 300_000;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model?.trim() || "hermes-agent",
        messages: [{ role: "user", content: input.message }],
        stream: false,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: msg };
  }

  const text = await res.text();
  let parsed: ChatCompletionJson | null = null;
  try {
    parsed = JSON.parse(text) as ChatCompletionJson;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const errMsg =
      (typeof parsed?.error === "string" && parsed.error) ||
      (typeof parsed?.error === "object" && parsed.error?.message) ||
      text.slice(0, 500) ||
      `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: errMsg };
  }

  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    return { ok: false, status: res.status, error: "empty_completion" };
  }
  return { ok: true, status: res.status, content };
}

/** @deprecated Prefer invokeHermesProfileWake with transport discrimination. */
export async function invokeHermesProfileWake(
  input: HermesWakeApiInput,
): Promise<HermesWakeInvokeResult> {
  return invokeHermesProfileWakeApi(input);
}

export function buildDockerWakeArgs(input: {
  container: string;
  /** Hermes profile name for official `hermes -p <profile>`. */
  profile: string;
  skill: string;
  message: string;
  passEnv: Record<string, string>;
  /** When set, run chat via sh and tee output to this container path. */
  outFile?: string;
  resumeSessionId?: string;
}): string[] {
  const args = ["exec"];
  for (const [k, v] of Object.entries(input.passEnv)) {
    if (v) args.push("-e", `${k}=${v}`);
  }

  const hermesBin = "/opt/hermes/bin/hermes";
  const profile = input.profile.trim();
  // Official selection: https://hermes-agent.nousresearch.com/docs/user-guide/profiles
  // (`hermes -p <name> chat` / alias). Do not rely on HERMES_HOME alone.
  const hermesCmd = input.resumeSessionId
    ? [
        hermesBin,
        "-p",
        profile,
        "chat",
        "--yolo",
        "--accept-hooks",
        "--resume",
        input.resumeSessionId,
        "-q",
        input.message,
      ]
    : [
        hermesBin,
        "-p",
        profile,
        "chat",
        "--yolo",
        "--accept-hooks",
        "-s",
        input.skill,
        "-q",
        input.message,
      ];

  // Redirect inside the container so a large TUI stream cannot stall on the
  // docker exec pipe (live wakes truncated mid-turn without this).
  if (input.outFile) {
    const shell = [
      ...hermesCmd.map(shellQuote),
      ">",
      shellQuote(input.outFile),
      "2>&1",
      ";",
      "echo",
      `WAKE_EXIT:$?`,
      ";",
      "cat",
      shellQuote(input.outFile),
    ].join(" ");
    // Absolute hermes path — use sh -c (no login PATH needed).
    args.push(input.container, "sh", "-c", shell);
    return args;
  }

  args.push(input.container, ...hermesCmd);
  return args;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function extractHermesSessionId(text: string): string | null {
  const m = text.match(/Session:\s+([0-9]{8}_[0-9]{6}_[0-9a-f]+)/i);
  return m?.[1] ?? null;
}

export function wakeLooksComplete(text: string): boolean {
  return /proposalId\s*=\s*[0-9a-f-]{36}/i.test(text);
}

async function runDockerSpawn(
  spawnFn: typeof spawn,
  dockerArgs: string[],
  timeoutMs: number,
): Promise<HermesWakeInvokeResult> {
  return await new Promise<HermesWakeInvokeResult>((resolve) => {
    const child: ChildProcessWithoutNullStreams = spawnFn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, status: 0, error: `timeout_after_${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 0, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const content = stdout.trim();
      const exitMatch = content.match(/WAKE_EXIT:(\d+)/);
      const effectiveCode = exitMatch ? Number(exitMatch[1]) : (code ?? 1);
      if (effectiveCode === 0 && content.length > 0) {
        resolve({ ok: true, status: 0, content });
        return;
      }
      resolve({
        ok: false,
        status: effectiveCode,
        error: (stderr.trim() || content || `exit_${effectiveCode}`).slice(0, 800),
      });
    });
  });
}

export async function invokeHermesProfileWakeCli(
  input: Omit<HermesWakeCliInput, "transport">,
): Promise<HermesWakeInvokeResult> {
  const container = (input.container || "hermes").trim() || "hermes";
  const profile = input.profile.trim();
  if (!profile) {
    return { ok: false, status: 0, error: "profile_required" };
  }
  const timeoutMs = input.timeoutMs ?? 300_000;
  const spawnFn = input.spawnFn ?? spawn;
  const outFile = `/tmp/hermes-wake-${profile}-${Date.now()}.log`;
  const passEnv = input.passEnv ?? {};

  const first = await runDockerSpawn(
    spawnFn,
    buildDockerWakeArgs({
      container,
      profile,
      skill: input.skill,
      message: input.message,
      passEnv,
      outFile,
    }),
    timeoutMs,
  );
  if (!first.ok) return first;
  if (wakeLooksComplete(first.content)) return first;

  const sessionId = extractHermesSessionId(first.content);
  if (!sessionId) return first;

  const resumeMsg = [
    "CRITICAL: Call mcp__context_mcp__create_proposal NOW with kind=campaign.pause (or campaign.create if this is campaign profile).",
    "Reuse the task_token and evidence already gathered this session.",
    "Do not narrate. Final reply MUST include a real UUID line: proposalId=<uuid>",
  ].join(" ");
  const second = await runDockerSpawn(
    spawnFn,
    buildDockerWakeArgs({
      container,
      profile,
      skill: input.skill,
      message: resumeMsg,
      passEnv,
      outFile: `${outFile}.resume`,
      resumeSessionId: sessionId,
    }),
    timeoutMs,
  );
  if (!second.ok) return second;
  return {
    ok: true,
    status: 0,
    content: `${first.content}\n--- resume ---\n${second.content}`,
  };
}

export function passEnvFromProcess(
  env: NodeJS.ProcessEnv,
  keys: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

export const WAKE_PASS_ENV_KEYS = [
  "AGENT_INTERNAL_API_KEY",
  "PERFORMANCE_ORG_ID",
  "CAMPAIGN_ORG_ID",
  "ADS_AGENT_BASE_URL",
] as const;
