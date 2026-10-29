import { DateTime } from 'luxon';
import { haversineKm, isValidPoint } from './geo.js';
import { deriveLifecycle, sortEvents, dedupe, toMillis } from './lifecycle.js';
import { percentOf, roundPesos } from './money.js';
import type { CostBreakdown, DeliveryEvent, DeliveryProjection, Tariff } from './types.js';

export const NIGHT_SURCHARGE_PERCENT = 15;
export const FAILED_BASE_PERCENT = 40;
/** Horario nocturno [20:00, 06:00) en hora local del comercio. */
export const NIGHT_START_HOUR = 20;
export const NIGHT_END_HOUR = 6;

export interface ProjectInput {
  deliveryId: string;
  events: readonly DeliveryEvent[];
  /** Todas las versiones de la tarifa del comercio; se usa la vigente al momento del evento terminal. */
  tariffs: readonly Tariff[];
  /** Zona IANA del comercio, p. ej. "America/Bogota". */
  timezone: string;
}

export function isNight(occurredAt: string, timezone: string): { night: boolean; local: string } {
  const local = DateTime.fromISO(occurredAt, { setZone: true }).setZone(timezone);
  if (!local.isValid) throw new RangeError(`zona horaria inválida: ${timezone}`);
  return {
    night: local.hour >= NIGHT_START_HOUR || local.hour < NIGHT_END_HOUR,
    local: local.toISO({ suppressMilliseconds: true })!,
  };
}

export function tariffAt(tariffs: readonly Tariff[], at: string): Tariff | null {
  const t = toMillis(at);
  return (
    tariffs.find((tf) => toMillis(tf.validFrom) <= t && (tf.validTo === null || t < toMillis(tf.validTo))) ?? null
  );
}

/**
 * Función pura: mismo conjunto de eventos → misma proyección, sin importar orden de llegada ni duplicados.
 * Es lo que se recalcula cada vez que llega un evento nuevo de la entrega.
 */
export function projectDelivery(input: ProjectInput): DeliveryProjection {
  const events = sortEvents(dedupe(input.events));
  const life = deriveLifecycle(events);
  const base: DeliveryProjection = {
    deliveryId: input.deliveryId,
    status: life.status,
    courierId: life.courierId,
    costStatus: 'pendiente',
    costCop: null,
    breakdown: null,
    completedAt: life.terminal?.occurredAt ?? null,
    reason: null,
  };

  const terminal = life.terminal;
  if (!terminal) return { ...base, reason: 'la entrega aún no termina' };

  const tariff = tariffAt(input.tariffs, terminal.occurredAt);
  if (!tariff) return { ...base, reason: `no hay tarifa vigente al ${terminal.occurredAt}` };

  const { night, local } = isNight(terminal.occurredAt, input.timezone);
  let breakdown: CostBreakdown;

  if (terminal.type === 'fallida') {
    const charged = percentOf(tariff.baseCop, FAILED_BASE_PERCENT);
    breakdown = {
      rule: 'fallida',
      tariffId: tariff.id,
      baseCop: tariff.baseCop,
      chargedBaseCop: charged,
      distanceKm: null,
      distanceCop: 0,
      night, // se informa, pero fallida no lleva recargos
      localCompletedAt: local,
      nightSurchargeCop: 0,
      totalCop: charged,
      eventIds: [terminal.eventId],
    };
  } else {
    // Se usa la recogida más temprana: es el inicio real del trayecto.
    const pickup = events.find((e) => e.type === 'recogida');
    if (!pickup) return { ...base, reason: 'falta el evento recogida para calcular la distancia' };
    if (!isValidPoint(pickup) || !isValidPoint(terminal)) {
      return { ...base, reason: 'faltan coordenadas válidas en recogida o entregada' };
    }

    const km = haversineKm(pickup, terminal);
    const distanceCop = roundPesos(km * tariff.perKmCop);
    const subtotal = tariff.baseCop + distanceCop;
    const surcharge = night ? percentOf(subtotal, NIGHT_SURCHARGE_PERCENT) : 0;
    breakdown = {
      rule: 'entregada',
      tariffId: tariff.id,
      baseCop: tariff.baseCop,
      chargedBaseCop: tariff.baseCop,
      distanceKm: Math.round(km * 1000) / 1000,
      distanceCop,
      night,
      localCompletedAt: local,
      nightSurchargeCop: surcharge,
      totalCop: subtotal + surcharge,
      eventIds: [pickup.eventId, terminal.eventId],
    };
  }

  return {
    ...base,
    costStatus: life.terminalConflict ? 'conflicto' : 'calculado',
    costCop: breakdown.totalCop,
    breakdown,
    reason: life.terminalConflict
      ? `llegaron entregada y fallida; se factura por "${terminal.type}" (la más antigua) y queda para revisión`
      : null,
  };
}
