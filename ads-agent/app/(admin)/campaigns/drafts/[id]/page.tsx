import { notFound } from "next/navigation";
import { getDraftById, listDraftMessages } from "@/lib/db/campaign-drafts";
import { CampaignDraftChat } from "@/components/CampaignDraftChat";

export default async function CampaignDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getDraftById(id);
  if (!draft) notFound();
  const messages = await listDraftMessages(id);

  return <CampaignDraftChat initialDraft={draft} initialMessages={messages} />;
}
