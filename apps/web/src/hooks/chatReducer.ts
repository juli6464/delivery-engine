import type { Role, ToolTrace } from '../api/types';

export interface ChatEntry {
  id: number;
  role: Role;
  content: string;
  toolCalls?: ToolTrace[];
  warnings?: string[];
}

export interface ChatState {
  messages: ChatEntry[];
  pending: boolean;
  error: { message: string; retryable: boolean } | null;
  nextId: number;
}

export type ChatAction =
  | { type: 'sent'; content: string }
  | { type: 'retried' }
  | { type: 'answered'; content: string; toolCalls: ToolTrace[]; warnings: string[] }
  | { type: 'failed'; message: string; retryable: boolean }
  | { type: 'reset' };

export const initialChatState: ChatState = { messages: [], pending: false, error: null, nextId: 1 };

/** Máximo de turnos que se reenvían al servidor como contexto (el servidor acepta 20). */
export const MAX_HISTORY = 20;

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'sent':
      return {
        ...state,
        messages: [...state.messages, { id: state.nextId, role: 'user', content: action.content }],
        nextId: state.nextId + 1,
        pending: true,
        error: null,
      };
    case 'retried':
      return { ...state, pending: true, error: null };
    case 'answered':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: state.nextId, role: 'assistant', content: action.content, toolCalls: action.toolCalls, warnings: action.warnings },
        ],
        nextId: state.nextId + 1,
        pending: false,
      };
    case 'failed':
      return { ...state, pending: false, error: { message: action.message, retryable: action.retryable } };
    case 'reset':
      return initialChatState;
  }
}

/** Historial que se envía a la API: solo texto de user/assistant, nunca resultados de herramientas. */
export function historyForApi(messages: ChatEntry[]): { role: Role; content: string }[] {
  return messages.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content }));
}
