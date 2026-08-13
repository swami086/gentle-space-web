import { stripSmuggle } from "../decision-engine/strip-smuggle";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KanbanIntent = "decompose" | "findings" | "blocked" | "handoff";

export type KanbanAgentMessage = {
  v: 1;
  intent: KanbanIntent;
  orgId: string;
  recordIds: string[];
  taint: boolean;
  summary: string;
};

const INTENTS = new Set<KanbanIntent>(["decompose", "findings", "blocked", "handoff"]);

export function formatKanbanAgentMessage(msg: KanbanAgentMessage): string {
  const body: KanbanAgentMessage = {
    ...msg,
    v: 1,
    summary: stripSmuggle(msg.summary).slice(0, 500),
    recordIds: msg.recordIds.map((id) => stripSmuggle(id)).slice(0, 32),
  };
  return JSON.stringify(body);
}

export function parseKanbanAgentMessage(raw: string): KanbanAgentMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_kanban_message");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("invalid_kanban_message");
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1) throw new Error("invalid_kanban_message");
  if (typeof o.intent !== "string" || !INTENTS.has(o.intent as KanbanIntent)) {
    throw new Error("invalid_kanban_message");
  }
  if (typeof o.orgId !== "string" || !UUID_RE.test(o.orgId)) throw new Error("invalid_kanban_message");
  if (!Array.isArray(o.recordIds) || !o.recordIds.every((x) => typeof x === "string")) {
    throw new Error("invalid_kanban_message");
  }
  if (typeof o.taint !== "boolean") throw new Error("invalid_kanban_message");
  if (typeof o.summary !== "string") throw new Error("invalid_kanban_message");
  return {
    v: 1,
    intent: o.intent as KanbanIntent,
    orgId: o.orgId,
    recordIds: o.recordIds.map((id) => stripSmuggle(id)),
    taint: o.taint,
    summary: stripSmuggle(o.summary).slice(0, 500),
  };
}

export function assertUntaintedForProposal(msg: KanbanAgentMessage): void {
  if (msg.taint) throw new Error("tainted_source");
}
