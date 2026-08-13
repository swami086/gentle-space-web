"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Renderer, type Library } from "@openuidev/react-lang";
import type { ActionEvent } from "@openuidev/lang-core";
import { Loader2 } from "lucide-react";
import { AskAiTrigger } from "@/components/AskAiTrigger";
import { useCopilot } from "@/components/copilot/CopilotProvider";
import { Button } from "@/components/ui/button";
import { parseActionProposalPayload, resolveActionProposalClick } from "@/lib/generative/action-proposal";
import { generativeLibrary } from "@/lib/openui/generative-library";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { resolveOpenUiAction } from "@/lib/openui/hermes-library";
import { openUiRenderErrorMessage } from "@/lib/openui/renderer-errors";

const library = generativeLibrary as Library;

type WhyResponse = {
  id: string;
  openuiLang: string;
  followUps?: string[];
};

type Props = {
  proposalId: string;
  proposalKind?: string;
  /** When set (URL ?why= or prop), load persisted answer on mount. */
  initialAnswerId?: string | null;
};

export function WhyPanel({ proposalId, proposalKind, initialAnswerId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { seedAndOpen } = useCopilot();
  const answerId = initialAnswerId ?? searchParams.get("why");

  const [openuiLang, setOpenuiLang] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadedForId, setLoadedForId] = useState<string | null>(null);

  const persistAnswerId = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("why", id);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const loadAnswer = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/generative/answers/${id}`);
      if (!res.ok) throw new Error("Could not load saved answer");
      const data = (await res.json()) as { openuiLang: string };
      setOpenuiLang(data.openuiLang);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRenderError(null);
    try {
      const res = await fetch("/api/generative/why", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Why generation failed");
      }
      const data = (await res.json()) as WhyResponse;
      setOpenuiLang(data.openuiLang);
      setLoadedForId(data.id);
      persistAnswerId(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [proposalId, persistAnswerId]);

  useEffect(() => {
    if (!answerId || answerId === loadedForId) return;
    void loadAnswer(answerId).then(() => setLoadedForId(answerId));
  }, [answerId, loadedForId, loadAnswer]);

  const handleAction = useCallback(
    (event: ActionEvent) => {
      const params = (event as ActionEvent & { params?: unknown }).params;
      if (params && typeof params === "object" && (params as { v?: unknown }).v === 1) {
        try {
          const click = resolveActionProposalClick(parseActionProposalPayload(params));
          if (click.kind === "navigate") {
            router.push(click.path);
            return;
          }
        } catch {
          /* not an action proposal payload */
        }
      }
      const action = resolveOpenUiAction(event);
      if (action.kind === "send") seedAndOpen(action.text);
      else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
    },
    [router, seedAndOpen],
  );

  const whyQuestion = `Why was this ${proposalKind ?? "proposal"} created? Explain the triggered rule and supporting data.`;

  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">Why</p>
        <div className="flex items-center gap-2">
          <AskAiTrigger question={whyQuestion} onAsk={() => void generate()} />
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void generate()}>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Explain why"}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {renderError && <p className="text-sm text-destructive">{renderError}</p>}
      {openuiLang && looksLikeOpenUiLang(openuiLang) && (
        <Renderer
          response={openuiLang}
          library={library}
          isStreaming={false}
          onAction={handleAction}
          onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
        />
      )}
    </div>
  );
}
