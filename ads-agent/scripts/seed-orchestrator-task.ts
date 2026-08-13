const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SeedArgs = {
  orgId: string;
  enquiryId?: string;
  idempotencyKey: string;
};

export function parseSeedArgs(argv: string[]): SeedArgs {
  let orgId: string | undefined;
  let enquiryId: string | undefined;
  let idempotencyKey: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--org-id=")) orgId = a.slice("--org-id=".length);
    if (a.startsWith("--enquiry-id=")) enquiryId = a.slice("--enquiry-id=".length);
    if (a.startsWith("--idempotency-key=")) idempotencyKey = a.slice("--idempotency-key=".length);
  }
  if (!orgId || !UUID_RE.test(orgId)) {
    throw new Error("seed-orchestrator-task: --org-id=<uuid> required");
  }
  if (!idempotencyKey) {
    throw new Error("seed-orchestrator-task: --idempotency-key=<key> required");
  }
  if (enquiryId !== undefined && !UUID_RE.test(enquiryId)) {
    throw new Error("seed-orchestrator-task: --enquiry-id must be uuid");
  }
  return enquiryId ? { orgId, enquiryId, idempotencyKey } : { orgId, idempotencyKey };
}

export function buildKanbanCreateCommand(args: SeedArgs, env: NodeJS.ProcessEnv): string {
  const board = env.GS_KANBAN_BOARD ?? "gs-agents";
  const bin = env.HERMES_KANBAN_BIN ?? "hermes";
  const title = args.enquiryId
    ? `Triage enquiry outcome [idemp:${args.idempotencyKey}]`
    : `Orchestrate tenant work [idemp:${args.idempotencyKey}]`;
  const parts = [
    bin,
    "kanban",
    "create",
    `--board=${board}`,
    `--tenant=${args.orgId}`,
    `--title=${JSON.stringify(title)}`,
    `--idempotency-key=${args.idempotencyKey}`,
  ];
  if (args.enquiryId) parts.push(`--record-id=${args.enquiryId}`);
  return parts.join(" ");
}

export async function main(env: NodeJS.ProcessEnv, argv: string[]): Promise<number> {
  const args = parseSeedArgs(argv);
  const cmd = buildKanbanCreateCommand(args, env);

  if (env.HERMES_WAKE !== "1") {
    console.log(`seed-orchestrator-task: intended command: ${cmd}`);
    return 0;
  }

  if (env.HERMES_KANBAN_BIN) {
    console.log(`seed-orchestrator-task: would run: ${cmd} (Hermes kanban invoke deferred)`);
    return 0;
  }

  console.log(`seed-orchestrator-task: HERMES_KANBAN_BIN unset (Hermes kanban invoke deferred)`);
  return 0;
}

const isDirect =
  process.argv[1]?.endsWith("seed-orchestrator-task.ts") ||
  process.argv[1]?.endsWith("seed-orchestrator-task.js");
if (isDirect) {
  main(process.env, process.argv.slice(2)).then((c) => process.exit(c));
}
