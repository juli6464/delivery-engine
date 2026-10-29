import { describe, expect, it } from 'vitest';
import { chatReducer, historyForApi, initialChatState, MAX_HISTORY } from '../src/hooks/chatReducer';
import { minusDays, todayIn } from '../src/format';

describe('chatReducer', () => {
  it('sent → pending; answered → agrega la respuesta con sus datos', () => {
    let s = chatReducer(initialChatState, { type: 'sent', content: 'hola' });
    expect(s).toMatchObject({ pending: true, error: null, messages: [{ role: 'user', content: 'hola' }] });

    s = chatReducer(s, { type: 'answered', content: 'hola!', toolCalls: [{ name: 'list_merchants', arguments: {}, duration_ms: 1 }], warnings: [] });
    expect(s.pending).toBe(false);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(new Set(s.messages.map((m) => m.id)).size).toBe(2);
  });

  it('failed conserva el mensaje del usuario para reintentar', () => {
    let s = chatReducer(initialChatState, { type: 'sent', content: 'hola' });
    s = chatReducer(s, { type: 'failed', message: 'caído', retryable: true });
    expect(s).toMatchObject({ pending: false, error: { message: 'caído', retryable: true } });
    expect(s.messages).toHaveLength(1);

    s = chatReducer(s, { type: 'retried' });
    expect(s).toMatchObject({ pending: true, error: null });
  });

  it('el historial enviado solo lleva rol y texto, nunca resultados de herramientas', () => {
    const s = chatReducer(chatReducer(initialChatState, { type: 'sent', content: 'q' }), {
      type: 'answered',
      content: 'r',
      toolCalls: [{ name: 'x', arguments: {}, result: { secreto: 1 }, duration_ms: 1 }],
      warnings: ['w'],
    });
    expect(historyForApi(s.messages)).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'r' },
    ]);
  });

  it(`recorta el historial a ${MAX_HISTORY} turnos`, () => {
    let s = initialChatState;
    for (let i = 0; i < 30; i++) s = chatReducer(s, { type: 'sent', content: `m${i}` });
    const h = historyForApi(s.messages);
    expect(h).toHaveLength(MAX_HISTORY);
    expect(h.at(-1)!.content).toBe('m29');
  });
});

describe('fechas', () => {
  it('todayIn usa la zona indicada', () => {
    const instant = new Date('2026-10-30T03:00:00Z'); // 22:00 del 29 en Bogotá
    expect(todayIn('America/Bogota', instant)).toBe('2026-10-29');
    expect(todayIn('UTC', instant)).toBe('2026-10-30');
  });

  it('minusDays cruza meses', () => {
    expect(minusDays('2026-11-02', 6)).toBe('2026-10-27');
  });
});
