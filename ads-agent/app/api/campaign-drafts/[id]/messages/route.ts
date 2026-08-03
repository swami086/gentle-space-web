import { NextResponse } from "next/server";
import {
  appendDraftMessage,
  getDraftById,
  listDraftMessages,
  setDraftStatus,
  updateDraftFields,
} from "@/lib/db/campaign-drafts";
import { draftCampaignChatReply } from "@/lib/decision-engine/campaign-chat";
import { isDraftReady } from "@/lib/decision-engine/campaign-draft-rules";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getDraftById(id);
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (draft.status === "converted") {
    return NextResponse.json({ error: "draft already converted to a proposal" }, { status: 409 });
  }

  const { content } = (await req.json()) as { content: string };
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });

  await appendDraftMessage(id, "user", content);
  const history = await listDraftMessages(id);

  const { reply, fieldUpdates } = await draftCampaignChatReply({
    draft,
    history: history.slice(0, -1),
    userMessage: content,
  });

  await appendDraftMessage(id, "assistant", reply);

  let updatedDraft = draft;
  if (fieldUpdates) {
    updatedDraft = await updateDraftFields(id, fieldUpdates);
    await setDraftStatus(id, isDraftReady(updatedDraft) ? "ready" : "chatting");
    updatedDraft = (await getDraftById(id))!;
  }

  return NextResponse.json({ reply, draft: updatedDraft });
}
