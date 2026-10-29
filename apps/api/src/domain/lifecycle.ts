import { DateTime } from 'luxon';
import type { DeliveryEvent, DeliveryStatus } from './types.js';

/** Orden del ciclo de vida. fallida es terminal y puede ocurrir desde cualquier estado previo a entregada. */
const RANK: Record<DeliveryStatus, number> = {
  creada: 0,
  asignada: 1,
  recogida: 2,
  en_ruta: 3,
  entregada: 4,
  fallida: 4,
};

export function toMillis(iso: string): number {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) throw new RangeError(`fecha inválida: ${iso}`);
  return dt.toMillis();
}

/**
 * Orden canónico: por occurredAt, empate por rango del ciclo de vida y luego por eventId.
 * Es total y determinista, así que el resultado no depende del orden de llegada.
 */
export function sortEvents(events: readonly DeliveryEvent[]): DeliveryEvent[] {
  return [...events].sort(
    (a, b) =>
      toMillis(a.occurredAt) - toMillis(b.occurredAt) ||
      RANK[a.type] - RANK[b.type] ||
      a.eventId.localeCompare(b.eventId),
  );
}

/** Quita duplicados por eventId (defensa en profundidad: la base ya lo impide con la PK). */
export function dedupe(events: readonly DeliveryEvent[]): DeliveryEvent[] {
  const seen = new Map<string, DeliveryEvent>();
  for (const e of events) if (!seen.has(e.eventId)) seen.set(e.eventId, e);
  return [...seen.values()];
}

export interface Lifecycle {
  status: DeliveryStatus;
  /** Evento que define la facturación: el primer terminal en el tiempo. */
  terminal: DeliveryEvent | null;
  /** true si llegaron entregada y fallida para la misma entrega. */
  terminalConflict: boolean;
  courierId: string | null;
}

/**
 * El estado es el de mayor rango presente, no el último por hora:
 * tolera relojes desfasados entre dispositivos y eventos que llegan tarde.
 */
export function deriveLifecycle(events: readonly DeliveryEvent[]): Lifecycle {
  const sorted = sortEvents(dedupe(events));
  if (sorted.length === 0) throw new RangeError('una entrega necesita al menos un evento');

  const terminals = sorted.filter((e) => e.type === 'entregada' || e.type === 'fallida');
  const terminal = terminals[0] ?? null;
  const terminalConflict = new Set(terminals.map((e) => e.type)).size > 1;

  let status: DeliveryStatus = terminal?.type ?? sorted[0]!.type;
  if (!terminal) {
    for (const e of sorted) if (RANK[e.type] > RANK[status]) status = e.type;
  }

  // Mensajero: el último asignado por hora del evento.
  const courierId = sorted.reduce<string | null>((acc, e) => e.courierId ?? acc, null);

  return { status, terminal, terminalConflict, courierId };
}
