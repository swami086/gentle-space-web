"use client";

import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { copilotReducer, initialCopilotState, type CopilotMessage } from "./copilot-state";

type CopilotContextValue = {
  isOpen: boolean;
  messages: CopilotMessage[];
  pendingQuestion: string | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Opens the Copilot panel and pre-seeds `question` — the handoff target for AskAiTrigger and
   * proactive-signaling badge clicks (foundation spec's Proactive signaling section). */
  seedAndOpen: (question: string) => void;
  clearPendingQuestion: () => void;
  appendMessage: (message: CopilotMessage) => void;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

/**
 * Mounted once at (admin)/layout.tsx (Task 13) so open/closed state and message history survive
 * navigation between Home/Marketing/CRM/Reports — a floating overlay with one continuous
 * conversation, per the foundation spec's Global Copilot persistence requirement.
 */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(copilotReducer, initialCopilotState);

  const value = useMemo<CopilotContextValue>(
    () => ({
      isOpen: state.isOpen,
      messages: state.messages,
      pendingQuestion: state.pendingQuestion,
      open: () => dispatch({ type: "OPEN" }),
      close: () => dispatch({ type: "CLOSE" }),
      toggle: () => dispatch({ type: "TOGGLE" }),
      seedAndOpen: (question: string) => dispatch({ type: "SEED_AND_OPEN", question }),
      clearPendingQuestion: () => dispatch({ type: "CLEAR_PENDING_QUESTION" }),
      appendMessage: (message: CopilotMessage) => dispatch({ type: "APPEND_MESSAGE", message }),
    }),
    [state],
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot() must be called within a CopilotProvider");
  return ctx;
}
