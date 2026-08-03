import { redirect } from "next/navigation";
import { createDraft } from "@/lib/db/campaign-drafts";

export default async function NewCampaignPage() {
  const draft = await createDraft();
  redirect(`/campaigns/drafts/${draft.id}`);
}
