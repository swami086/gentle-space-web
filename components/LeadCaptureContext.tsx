"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

export type PropertyLeadContext = { propertyName: string; propertyUrl: string };

/** Accepts property context or a click event (Home CTAs pass `onClick={openModal}`). */
export type OpenModalArg = PropertyLeadContext | MouseEvent;

type LeadCaptureContextValue = {
  open: boolean;
  propertyContext: PropertyLeadContext | null;
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

export function LeadCaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [propertyContext, setPropertyContext] = useState<PropertyLeadContext | null>(null);

  const value = useMemo(
    () => ({
      open,
      propertyContext,
      openModal: (ctx?: OpenModalArg) => {
        setPropertyContext(isPropertyLeadContext(ctx) ? ctx : null);
        setOpen(true);
      },
      closeModal: () => {
        setOpen(false);
        setPropertyContext(null);
      },
    }),
    [open, propertyContext],
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
