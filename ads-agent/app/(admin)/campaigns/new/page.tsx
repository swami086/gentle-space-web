import { redirect } from "next/navigation";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { createDraft } from "@/lib/db/campaign-drafts";

export default async function NewCampaignPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const scope = await scopeForSession(access.session);
  const draft = await createDraft(scope);
  redirect(`/campaigns/drafts/${draft.id}`);
}
