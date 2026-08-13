const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WakeOrchestratorArgs = {
  orgId: string;
  enquiryId?: string;
  kanbanTaskId?: string;
};

export function parseWakeArgs(argv: string[]): WakeOrchestratorArgs {
  let orgId: string | undefined;
  let enquiryId: string | undefined;
  let kanbanTaskId: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--org-id=")) orgId = a.slice("--org-id=".length);
    if (a.startsWith("--enquiry-id=")) enquiryId = a.slice("--enquiry-id=".length);
    if (a.startsWith("--kanban-task-id=")) kanbanTaskId = a.slice("--kanban-task-id=".length);
  }
  if (!orgId || !UUID_RE.test(orgId)) {
    throw new Error("wake-orchestrator-agent: --org-id=<uuid> required");
  }
  if (enquiryId !== undefined && !UUID_RE.test(enquiryId)) {
    throw new Error("wake-orchestrator-agent: --enquiry-id must be uuid");
  }
  if (kanbanTaskId !== undefined && !UUID_RE.test(kanbanTaskId)) {
    throw new Error("wake-orchestrator-agent: --kanban-task-id must be uuid");
  }
  const out: WakeOrchestratorArgs = { orgId };
  if (enquiryId) out.enquiryId = enquiryId;
  if (kanbanTaskId) out.kanbanTaskId = kanbanTaskId;
  return out;
}

export async function main(env: NodeJS.ProcessEnv, argv: string[]): Promise<number> {
  const args = parseWakeArgs(argv);
  if (env.HERMES_WAKE !== "1") {
    console.log("wake-orchestrator-agent: not scheduled (set HERMES_WAKE=1 to enable)");
    return 0;
  }
  console.log(
    `wake-orchestrator-agent: stub wake org=${args.orgId}` +
      (args.enquiryId ? ` enquiry=${args.enquiryId}` : "") +
      (args.kanbanTaskId ? ` kanbanTask=${args.kanbanTaskId}` : "") +
      " (Hermes API invoke deferred)",
  );
  return 0;
}

const isDirect =
  process.argv[1]?.endsWith("wake-orchestrator-agent.ts") ||
  process.argv[1]?.endsWith("wake-orchestrator-agent.js");
if (isDirect) {
  main(process.env, process.argv.slice(2)).then((c) => process.exit(c));
}
