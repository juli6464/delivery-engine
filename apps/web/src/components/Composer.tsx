import { useState, type FormEvent, type KeyboardEvent } from 'react';

const MAX_LENGTH = 2000;

export function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (disabled || !text.trim()) return;
    onSend(text);
    setText('');
  };

  // Enter envía; Shift+Enter agrega una línea.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) submit(e);
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="chat-input" className="sr-only">
        Pregunta al asistente
      </label>
      <textarea
        id="chat-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MAX_LENGTH}
        rows={2}
        placeholder="Ej.: ¿Cuánto facturó Tienda La 80 la semana pasada?"
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        {disabled ? 'Consultando…' : 'Enviar'}
      </button>
    </form>
  );
}
