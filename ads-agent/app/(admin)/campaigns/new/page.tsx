import { redirect } from "next/navigation";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { createDraft } from "@/lib/db/campaign-drafts";

export default async function NewCampaignPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const draft = await createDraft();
  redirect(`/campaigns/drafts/${draft.id}`);
}
