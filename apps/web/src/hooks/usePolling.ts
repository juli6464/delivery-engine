import { useCallback, useEffect, useRef, useState } from 'react';

interface PollingState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: Date | null;
}

/**
 * Consulta periódica ("casi tiempo real"). Se pausa con la pestaña oculta y no superpone solicitudes.
 * Se eligió polling sobre SSE/WebSockets por simplicidad a esta escala (ver README).
 */
export function usePolling<T>(fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number) {
  const [state, setState] = useState<PollingState<T>>({ data: null, error: null, loading: true, updatedAt: null });
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcher(ctrl.signal);
      setState({ data, error: null, loading: false, updatedAt: new Date() });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      // Se conservan los últimos datos buenos y se muestra el error al lado.
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : 'Error al cargar', loading: false }));
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null;
    }
  }, [fetcher]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, intervalMs);
    return () => {
      clearInterval(timer);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load, intervalMs]);

  return { ...state, refresh: load };
}
