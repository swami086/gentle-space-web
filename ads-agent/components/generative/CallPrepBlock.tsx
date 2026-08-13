"use client";

import { useEffect, useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { generativeLibrary } from "@/lib/openui/generative-library";
import { normalizeOpenUiResponse } from "@/lib/openui/normalize-openui-response";
import { openUiRenderErrorMessage } from "@/lib/openui/renderer-errors";

type Props = {
  enquiryId: string;
};

const generativeChatLibrary = generativeLibrary as Library;

export function CallPrepBlock({ enquiryId }: Props) {
  const [openuiLang, setOpenuiLang] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOpenuiLang(null);
    setRenderError(null);

    void fetch("/api/generative/call-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enquiryId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<{ openuiLang: string }>;
      })
      .then((data) => {
        if (!cancelled) setOpenuiLang(data.openuiLang);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load call prep");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enquiryId]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Generating call prep…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!openuiLang) return null;

  const response = normalizeOpenUiResponse(openuiLang);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">Call prep</h2>
      <Renderer
        response={response}
        library={generativeChatLibrary}
        isStreaming={false}
        onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
      />
      {renderError ? <p className="text-xs text-destructive">{renderError}</p> : null}
    </div>
  );
}
