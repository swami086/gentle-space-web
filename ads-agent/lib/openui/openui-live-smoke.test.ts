/**
 * Live Bifrost smoke (opt-in): OPENUI_LIVE_SMOKE=1 npx vitest run lib/openui/openui-live-smoke.test.ts
 *
 * Mocks only getSession (no Next request). Real Bifrost + metering + parsers.
 * Asserts done.reply is non-empty and not the generic parse-fail copy.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(__dirname, "../../.env.local"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

loadEnvLocal();

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
}));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftCampaignChatReply } from "../decision-engine/campaign-chat";
import { draftCrmChatReply } from "../decision-engine/crm-chat";
import { draftReportsChatReply } from "../decision-engine/reports-chat";
import { draftCopilotReply } from "../decision-engine/copilot-chat";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";
import type { CampaignDraft } from "../types";

const LIVE = process.env.OPENUI_LIVE_SMOKE === "1";
const GENERIC_FAIL = /trouble (structuring|putting) that together|could you rephrase/i;

async function drainDone(gen: AsyncGenerator<{ type: string; reply?: string }>) {
  let reply = "";
  for await (const ev of gen) {
    if (ev.type === "done" && typeof ev.reply === "string") reply = ev.reply;
  }
  return reply;
}

function emptyDraft(): CampaignDraft {
  return {
    id: process.env.SMOKE_DRAFT_ID ?? "1911c6d5-d048-484a-b9b6-ba5ac8dfd2c0",
    status: "chatting",
    corridor: null,
    dailyBudgetInr: null,
    adGroupName: null,
    keywords: [],
    headlines: [],
    descriptions: [],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe.skipIf(!LIVE)("OpenUI live Bifrost smoke (all four surfaces)", () => {
  beforeAll(() => {
    getSession.mockResolvedValue({
      userId: DEFAULT_USER_ID,
      email: "smoke@gentlespace.test",
      orgId: DEFAULT_ORG_ID,
      role: "admin" as const,
    });
  });

  it(
    "campaign: propose headlines and descriptions — no generic parse fail",
    async () => {
      const reply = await drainDone(
        draftCampaignChatReply({
          draft: emptyDraft(),
          history: [],
          userMessage: "propose headlines and descriptions",
        }),
      );
      expect(reply.length).toBeGreaterThan(0);
      expect(reply).not.toMatch(GENERIC_FAIL);
    },
    60_000,
  );

  it(
    "crm: show me hot leads — no generic parse fail",
    async () => {
      const reply = await drainDone(
        draftCrmChatReply({ history: [], userMessage: "show me hot leads" }),
      );
      expect(reply.length).toBeGreaterThan(0);
      expect(reply).not.toMatch(GENERIC_FAIL);
    },
    60_000,
  );

  it(
    "reports: show CPL trend this week — no generic parse fail",
    async () => {
      const reply = await drainDone(
        draftReportsChatReply({ history: [], userMessage: "show CPL trend this week" }),
      );
      expect(reply.length).toBeGreaterThan(0);
      expect(reply).not.toMatch(GENERIC_FAIL);
    },
    60_000,
  );

  it(
    "copilot: what's my pipeline value? — no generic parse fail",
    async () => {
      const reply = await drainDone(
        draftCopilotReply({ history: [], userMessage: "what's my pipeline value?" }),
      );
      expect(reply.length).toBeGreaterThan(0);
      expect(reply).not.toMatch(GENERIC_FAIL);
    },
    60_000,
  );
});
