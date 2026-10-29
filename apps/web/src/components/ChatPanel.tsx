import { useEffect, useRef } from 'react';
import { useChat } from '../hooks/useChat';
import { Composer } from './Composer';
import { Message } from './Message';

const SUGGESTIONS = [
  '¿Cuánto facturó Tienda La 80 la semana pasada?',
  '¿Cuántas entregas fallidas tiene Luis Pérez?',
  '¿Qué instrucciones de entrega tiene Tienda La 80?',
  '¿Por qué la entrega d-la80-noche costó lo que costó?',
];

export function ChatPanel() {
  const { messages, pending, error, send, retry, reset } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pending, error]);

  return (
    <section className="panel chat" aria-labelledby="chat-title">
      <header className="panel-header">
        <h2 id="chat-title">Asistente de operaciones</h2>
        {messages.length > 0 && (
          <button type="button" className="link" onClick={reset}>
            Nueva conversación
          </button>
        )}
      </header>

      <div className="chat-body">
        {messages.length === 0 && (
          <div className="empty">
            <p>Pregunta en lenguaje natural. Las cifras salen siempre de consultas al sistema, nunca del modelo.</p>
            <ul className="suggestions">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => send(s)} disabled={pending}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ol className="messages" aria-live="polite">
          {messages.map((m) => (
            <Message key={m.id} entry={m} />
          ))}
        </ol>

        {pending && (
          <p className="status" role="status">
            <span className="spinner" aria-hidden="true" /> Consultando el sistema…
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            <span>{error.message}</span>
            {error.retryable && (
              <button type="button" onClick={retry}>
                Reintentar
              </button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <Composer disabled={pending} onSend={send} />
    </section>
  );
}
