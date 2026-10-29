// Tipos del dominio. Este módulo y sus hermanos en domain/ son puros: sin I/O, sin reloj, sin base de datos.

export const EVENT_TYPES = ['creada', 'asignada', 'recogida', 'en_ruta', 'entregada', 'fallida'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface DeliveryEvent {
  eventId: string;
  deliveryId: string;
  type: EventType;
  /** Momento en que ocurrió en el mundo real (ISO-8601 con offset). No es la hora de llegada al sistema. */
  occurredAt: string;
  lat?: number;
  lon?: number;
  courierId?: string;
}

export interface Tariff {
  id: string;
  baseCop: number;
  perKmCop: number;
  /** Vigencia [validFrom, validTo) en ISO-8601. validTo null = vigente. */
  validFrom: string;
  validTo: string | null;
}

export type DeliveryStatus = EventType;
export type CostStatus = 'pendiente' | 'calculado' | 'conflicto';

export interface CostBreakdown {
  rule: 'entregada' | 'fallida';
  tariffId: string;
  baseCop: number;
  /** Para fallida: el 40% de la base. Para entregada: la base completa. */
  chargedBaseCop: number;
  distanceKm: number | null;
  distanceCop: number;
  night: boolean;
  /** Hora local del comercio del evento terminal, para explicar el recargo. */
  localCompletedAt: string;
  nightSurchargeCop: number;
  totalCop: number;
  /** Eventos que intervinieron en el cálculo (trazabilidad). */
  eventIds: string[];
}

export interface DeliveryProjection {
  deliveryId: string;
  status: DeliveryStatus;
  courierId: string | null;
  costStatus: CostStatus;
  costCop: number | null;
  breakdown: CostBreakdown | null;
  /** occurredAt del evento terminal que define la facturación. */
  completedAt: string | null;
  /** Por qué el costo está pendiente o en conflicto. */
  reason: string | null;
}
