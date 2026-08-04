"use client";

import { Renderer } from "@openuidev/react-lang";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignDraft } from "@/lib/types";
import { campaignLibrary, SetupCardView } from "@/lib/openui/campaign-library";

type Props = {
  draft: CampaignDraft;
  streamingText: string;
  isStreaming: boolean;
  onCreateProposal: () => Promise<void>;
  creating: boolean;
};

export function AiSetupView({ draft, streamingText, isStreaming, onCreateProposal, creating }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {isStreaming && streamingText ? (
        <Renderer response={streamingText} library={campaignLibrary} isStreaming={isStreaming} />
      ) : (
        <SetupCardView
          assistantReply=""
          status={draft.status}
          corridor={draft.corridor}
          dailyBudgetInr={draft.dailyBudgetInr}
          adGroupName={draft.adGroupName}
          keywords={draft.keywords}
          headlines={draft.headlines}
          descriptions={draft.descriptions}
          finalUrl={draft.finalUrl}
        />
      )}
      <Button disabled={draft.status !== "ready" || creating} onClick={() => void onCreateProposal()}>
        {creating && <Loader2 className="size-4 animate-spin" />}
        Create Proposal
      </Button>
    </div>
  );
}
