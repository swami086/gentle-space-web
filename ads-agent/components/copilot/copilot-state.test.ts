import { describe, expect, it } from "vitest";
import { copilotReducer, initialCopilotState, type CopilotMessage } from "./copilot-state";

describe("copilotReducer", () => {
  it("starts closed with no messages", () => {
    expect(initialCopilotState.isOpen).toBe(false);
    expect(initialCopilotState.messages).toEqual([]);
    expect(initialCopilotState.pendingQuestion).toBeNull();
  });

  it("OPEN sets isOpen true; CLOSE sets it false; TOGGLE flips it", () => {
    let state = copilotReducer(initialCopilotState, { type: "OPEN" });
    expect(state.isOpen).toBe(true);
    state = copilotReducer(state, { type: "CLOSE" });
    expect(state.isOpen).toBe(false);
    state = copilotReducer(state, { type: "TOGGLE" });
    expect(state.isOpen).toBe(true);
    state = copilotReducer(state, { type: "TOGGLE" });
    expect(state.isOpen).toBe(false);
  });

  it("SEED_AND_OPEN opens the panel and sets pendingQuestion", () => {
    const state = copilotReducer(initialCopilotState, { type: "SEED_AND_OPEN", question: "Why did CPL rise?" });
    expect(state.isOpen).toBe(true);
    expect(state.pendingQuestion).toBe("Why did CPL rise?");
  });

  it("CLEAR_PENDING_QUESTION nulls it out without touching messages or isOpen", () => {
    const seeded = copilotReducer(initialCopilotState, { type: "SEED_AND_OPEN", question: "q" });
    const cleared = copilotReducer(seeded, { type: "CLEAR_PENDING_QUESTION" });
    expect(cleared.pendingQuestion).toBeNull();
    expect(cleared.isOpen).toBe(true);
  });

  it("APPEND_MESSAGE appends to the message history, preserving order", () => {
    const m1: CopilotMessage = { id: "1", role: "user", content: "hi" };
    const m2: CopilotMessage = { id: "2", role: "assistant", content: "hello" };
    let state = copilotReducer(initialCopilotState, { type: "APPEND_MESSAGE", message: m1 });
    state = copilotReducer(state, { type: "APPEND_MESSAGE", message: m2 });
    expect(state.messages).toEqual([m1, m2]);
  });

  it("state survives being threaded through multiple actions in sequence (simulates a route change not resetting it)", () => {
    let state = initialCopilotState;
    state = copilotReducer(state, { type: "OPEN" });
    state = copilotReducer(state, { type: "APPEND_MESSAGE", message: { id: "1", role: "user", content: "hi" } });
    // A route change does not dispatch any action — this just documents that copilotReducer never
    // resets state on its own; CopilotProvider owns the same reducer instance across navigation
    // because it's mounted once at (admin)/layout.tsx (verified manually in Task 13).
    expect(state.isOpen).toBe(true);
    expect(state.messages).toHaveLength(1);
  });
});
