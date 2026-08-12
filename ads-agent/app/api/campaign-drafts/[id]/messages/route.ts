import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import {
  appendDraftMessage,
  getDraftById,
  listDraftMessages,
  setDraftStatus,
  updateDraftFields,
} from "@/lib/db/campaign-drafts";
import { draftCampaignChatReply } from "@/lib/decision-engine/campaign-chat";
import { isDraftReady } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getDraftById(s, id), scope);
  if (!owned.ok) return owned.response;
  const draft = owned.entity;
  if (draft.status === "converted") {
    return NextResponse.json({ error: "draft already converted to a proposal" }, { status: 409 });
  }

  const { content } = (await req.json()) as { content: string };
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });

  await appendDraftMessage(scope, id, "user", content);
  const history = await listDraftMessages(scope, id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        let reply = "";
        let fieldUpdates: CampaignDraftFields | null = null;

        for await (const event of draftCampaignChatReply({
          draft,
          history: history.slice(0, -1),
          userMessage: content,
        })) {
          if (event.type === "delta") {
            send({ delta: event.content });
          } else {
            reply = event.reply;
            fieldUpdates = event.fieldUpdates;
          }
        }

        await appendDraftMessage(scope, id, "assistant", reply);

        let updatedDraft = draft;
        if (fieldUpdates) {
          updatedDraft = await updateDraftFields(scope, id, fieldUpdates);
          await setDraftStatus(scope, id, isDraftReady(updatedDraft) ? "ready" : "chatting");
          updatedDraft = (await getDraftById(scope, id))!;
        }

        send({ done: true, reply, draft: updatedDraft });
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
