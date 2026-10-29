import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../src/components/ChatPanel';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Pregunta al asistente'), text);
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  return user;
}

const sentMessages = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1].body).messages;

describe('ChatPanel', () => {
  it('muestra carga, luego la respuesta y los datos consultados', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    render(<ChatPanel />);

    await ask('¿Cuánto facturó Tienda La 80?');
    expect(screen.getByRole('status').textContent).toMatch(/Consultando/);
    expect((screen.getByRole('button', { name: 'Consultando…' }) as HTMLButtonElement).disabled).toBe(true);

    resolve(
      json(200, {
        answer: 'Tienda La 80 facturó $ 109.529.',
        tool_calls: [{ name: 'get_merchant_billing', arguments: { merchant_id: 'm-la80' }, result: { total_cop: 109529 }, duration_ms: 4 }],
        warnings: [],
      }),
    );

    expect(await screen.findByText('Tienda La 80 facturó $ 109.529.')).toBeTruthy();
    expect(screen.getByText(/Datos consultados \(1 consulta\)/)).toBeTruthy();
    expect(screen.getByText('Facturación por comercio')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/chat');
    expect(sentMessages(0)).toEqual([{ role: 'user', content: '¿Cuánto facturó Tienda La 80?' }]);
  });

  it('muestra el error del servidor y permite reintentar', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { error: 'El asistente alcanzó el límite de uso gratuito de Groq.', retryable: true }))
      .mockResolvedValueOnce(json(200, { answer: 'Listo.', tool_calls: [], warnings: [] }));
    render(<ChatPanel />);

    const user = await ask('hola');
    expect((await screen.findByRole('alert')).textContent).toMatch(/límite de uso gratuito/);

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Listo.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // El reintento reenvía la misma pregunta, sin duplicarla.
    expect(sentMessages(1)).toEqual([{ role: 'user', content: 'hola' }]);
  });

  it('sin conexión muestra un mensaje claro', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<ChatPanel />);
    await ask('hola');
    expect((await screen.findByRole('alert')).textContent).toMatch(/No hay conexión/);
  });

  it('muestra las advertencias de grounding', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { answer: 'Facturó $ 1.000.000.', tool_calls: [], warnings: ['cifras sin respaldo: 1000000'] }));
    render(<ChatPanel />);
    await ask('cuánto');
    expect((await screen.findByRole('note')).textContent).toMatch(/Verifica esta respuesta/);
  });

  it('el texto del modelo se muestra como texto: no se interpreta HTML', async () => {
    const malicious = '<img src=x onerror="alert(1)"> hola';
    fetchMock.mockResolvedValueOnce(json(200, { answer: malicious, tool_calls: [], warnings: [] }));
    const { container } = render(<ChatPanel />);
    await ask('hola');
    expect(await screen.findByText(malicious)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('las sugerencias envían la pregunta', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { answer: 'ok', tool_calls: [], warnings: [] }));
    render(<ChatPanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Luis Pérez/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentMessages(0)[0].content).toMatch(/Luis Pérez/);
  });
});
