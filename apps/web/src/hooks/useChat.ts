import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiError } from '../api/client';
import { chatReducer, historyForApi, initialChatState, type ChatEntry } from './chatReducer';

export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const controller = useRef<AbortController | null>(null);

  // Cancela la solicitud en curso si el componente se desmonta.
  useEffect(() => () => controller.current?.abort(), []);

  const request = useCallback(async (messages: ChatEntry[]) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const res = await api.chat(historyForApi(messages), ctrl.signal);
      dispatch({ type: 'answered', content: res.answer, toolCalls: res.tool_calls, warnings: res.warnings });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const e = err instanceof ApiError ? err : new ApiError('Error inesperado.', 0, true);
      dispatch({ type: 'failed', message: e.message, retryable: e.retryable });
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || state.pending) return;
      dispatch({ type: 'sent', content });
      void request([...state.messages, { id: -1, role: 'user', content }]);
    },
    [request, state.messages, state.pending],
  );

  const retry = useCallback(() => {
    if (state.pending || !state.error) return;
    dispatch({ type: 'retried' });
    void request(state.messages);
  }, [request, state.error, state.messages, state.pending]);

  const reset = useCallback(() => {
    controller.current?.abort();
    dispatch({ type: 'reset' });
  }, []);

  return { ...state, send, retry, reset };
}
