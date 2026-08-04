import { notFound } from "next/navigation";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { getDraftById, listDraftMessages } from "@/lib/db/campaign-drafts";
import { CampaignDraftChat } from "@/components/CampaignDraftChat";

export default async function CampaignDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const { id } = await params;
  const draft = await getDraftById(id);
  if (!draft) notFound();
  const messages = await listDraftMessages(id);

  return <CampaignDraftChat initialDraft={draft} initialMessages={messages} />;
}
