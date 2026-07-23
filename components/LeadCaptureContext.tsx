"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type LeadCaptureContextValue = {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
};

const LeadCaptureContext = createContext<LeadCaptureContextValue | undefined>(undefined);

export function LeadCaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const value = useMemo(
    () => ({
      open,
      openModal: () => setOpen(true),
      closeModal: () => setOpen(false),
    }),
    [open],
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
