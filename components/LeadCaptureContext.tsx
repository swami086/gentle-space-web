"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { NeedType } from "@/lib/whatsapp";

export type PropertyLeadContext = { propertyName: string; propertyUrl: string };

/** Seeds the modal's need + brief when opened from the hero quick-brief. */
export type BriefPrefill = { need?: NeedType; brief?: string };

/** Accepts property context, a brief prefill, or a click event (CTAs pass `onClick={openModal}`). */
export type OpenModalArg = PropertyLeadContext | BriefPrefill | MouseEvent;

type LeadCaptureContextValue = {
  open: boolean;
  propertyContext: PropertyLeadContext | null;
  prefill: BriefPrefill | null;
  openModal: (ctx?: OpenModalArg) => void;
  closeModal: () => void;
};

const LeadCaptureContext = createContext<LeadCaptureContextValue | undefined>(undefined);

function isPropertyLeadContext(value: unknown): value is PropertyLeadContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "propertyName" in value &&
    "propertyUrl" in value &&
    typeof (value as PropertyLeadContext).propertyName === "string" &&
    typeof (value as PropertyLeadContext).propertyUrl === "string"
  );
}

function isBriefPrefill(value: unknown): value is BriefPrefill {
  return (
    typeof value === "object" &&
    value !== null &&
    ("need" in value || "brief" in value)
  );
}

export function LeadCaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [propertyContext, setPropertyContext] = useState<PropertyLeadContext | null>(null);
  const [prefill, setPrefill] = useState<BriefPrefill | null>(null);

  const value = useMemo(
    () => ({
      open,
      propertyContext,
      prefill,
      openModal: (ctx?: OpenModalArg) => {
        if (isPropertyLeadContext(ctx)) {
          setPropertyContext(ctx);
          setPrefill(null);
        } else if (isBriefPrefill(ctx)) {
          setPrefill(ctx);
          setPropertyContext(null);
        } else {
          setPropertyContext(null);
          setPrefill(null);
        }
        setOpen(true);
      },
      closeModal: () => {
        setOpen(false);
        setPropertyContext(null);
        setPrefill(null);
      },
    }),
    [open, propertyContext, prefill],
  );

  return <LeadCaptureContext.Provider value={value}>{children}</LeadCaptureContext.Provider>;
}

export function useLeadCapture(): LeadCaptureContextValue {
  const context = useContext(LeadCaptureContext);
  if (!context) {
    throw new Error("useLeadCapture must be used within a LeadCaptureProvider");
  }
  return context;
}
