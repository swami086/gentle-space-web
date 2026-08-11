export type CopilotMessage = { id: string; role: "user" | "assistant"; content: string; hermes?: boolean };

export type CopilotState = {
  isOpen: boolean;
  messages: CopilotMessage[];
  pendingQuestion: string | null;
};

export type CopilotAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "TOGGLE" }
  | { type: "SEED_AND_OPEN"; question: string }
  | { type: "CLEAR_PENDING_QUESTION" }
  | { type: "APPEND_MESSAGE"; message: CopilotMessage };

export const initialCopilotState: CopilotState = {
  isOpen: false,
  messages: [],
  pendingQuestion: null,
};

export function copilotReducer(state: CopilotState, action: CopilotAction): CopilotState {
  switch (action.type) {
    case "OPEN":
      return { ...state, isOpen: true };
    case "CLOSE":
      return { ...state, isOpen: false };
    case "TOGGLE":
      return { ...state, isOpen: !state.isOpen };
    case "SEED_AND_OPEN":
      return { ...state, isOpen: true, pendingQuestion: action.question };
    case "CLEAR_PENDING_QUESTION":
      return { ...state, pendingQuestion: null };
    case "APPEND_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    default:
      return state;
  }
}
