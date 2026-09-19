import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { draftHermesReply, type HermesChatMessage, type HermesChatOrigin } from "@/lib/decision-engine/hermes-chat";
import { getDraftById } from "@/lib/db/campaign-drafts";
import { persistCampaignDraftFromHermesReply } from "@/lib/hermes/persist-campaign-draft";

const VALID_ORIGINS: HermesChatOrigin[] = ["copilot", "crm", "reports", "campaign"];

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;

  const body = (await req.json()) as {
    userMessage?: string;
    history?: HermesChatMessage[];
    origin?: string;
    draftId?: string;
  };
  const userMessage = body.userMessage?.trim();
  if (!userMessage) return NextResponse.json({ error: "userMessage is required" }, { status: 400 });

  const origin = body.origin as HermesChatOrigin;
  if (!VALID_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: `origin must be one of: ${VALID_ORIGINS.join(", ")}` }, { status: 400 });
  }

  const draftId = body.draftId?.trim();
  if (origin === "campaign" && !draftId) {
    return NextResponse.json({ error: "draftId is required when origin is campaign" }, { status: 400 });
  }

  const { scope } = access;
  let campaignDraft = null;
  if (origin === "campaign" && draftId) {
    const owned = await ownedOr404((s) => getDraftById(s, draftId), scope);
    if (!owned.ok) return owned.response;
    if (owned.entity.status === "converted") {
      return NextResponse.json({ error: "draft already converted to a proposal" }, { status: 409 });
    }
    campaignDraft = owned.entity;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        let reply = "";
        for await (const event of draftHermesReply({ history: body.history ?? [], userMessage, origin })) {
          if (event.type === "delta") send({ delta: event.content });
          else if (event.type === "tool_progress") send({ tool: event.tool });
          else reply = event.reply;
        }
        if (origin === "campaign" && campaignDraft && draftId) {
          const updatedDraft = await persistCampaignDraftFromHermesReply(scope, draftId, reply, campaignDraft);
          send({ done: true, reply, draft: updatedDraft });
        } else {
          send({ done: true, reply });
        }
      } catch (err) {
        send({ done: true, error: err instanceof Error ? err.message : "internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
