import type { ChatEntry } from '../hooks/chatReducer';
import { ToolCalls } from './ToolCalls';

export function Message({ entry }: { entry: ChatEntry }) {
  return (
    <li className={`message message-${entry.role}`}>
      <span className="sr-only">{entry.role === 'user' ? 'Tú:' : 'Asistente:'}</span>
      {/* Texto plano (white-space: pre-wrap). No se renderiza Markdown ni HTML de la respuesta del modelo. */}
      <p className="message-text">{entry.content}</p>
      {entry.warnings?.map((w) => (
        <p key={w} className="warning" role="note">
          ⚠ Verifica esta respuesta: {w}
        </p>
      ))}
      {entry.toolCalls && <ToolCalls calls={entry.toolCalls} />}
    </li>
  );
}
