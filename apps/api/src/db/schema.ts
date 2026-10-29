import type { ColumnType, Generated } from 'kysely';

// Tipos de las tablas para Kysely. Montos en pesos enteros; fechas en ISO-8601 (texto, UTC).

export interface MerchantsTable {
  id: string;
  name: string;
  /** Zona IANA, p. ej. "America/Bogota". */
  timezone: string;
  /** Dato NO confiable que viene del sistema origen: nunca se interpreta como instrucción. */
  notes: string | null;
  delivery_instructions: string | null;
}

export interface TariffsTable {
  id: string;
  merchant_id: string;
  base_cop: number;
  per_km_cop: number;
  valid_from: string;
  valid_to: string | null;
}

export interface CouriersTable {
  id: string;
  name: string;
}

/** Proyección recalculable desde events. No es la fuente de verdad. */
export interface DeliveriesTable {
  id: string;
  merchant_id: string;
  courier_id: string | null;
  address: string | null;
  status: string;
  cost_status: string;
  cost_cop: number | null;
  /** JSON del CostBreakdown: explica cada costo (trazabilidad). */
  cost_breakdown: string | null;
  cost_reason: string | null;
  /** Hora del primer evento conocido (UTC); sirve para filtrar entregas aún sin terminar. */
  first_event_at: string;
  completed_at: string | null;
  updated_at: string;
}

/** Fuente de verdad, append-only. La PK event_id hace la ingesta idempotente. */
export interface EventsTable {
  event_id: string;
  delivery_id: string;
  type: string;
  occurred_at: string;
  received_at: string;
  lat: number | null;
  lon: number | null;
  courier_id: string | null;
  payload: string;
  payload_hash: string;
}

/** Auditoría de lo rechazado (400/409) para no descartar nada en silencio. */
export interface IngestRejectionsTable {
  id: Generated<number>;
  event_id: string | null;
  reason: string;
  payload: string;
  received_at: ColumnType<string, string | undefined, never>;
}

export interface Database {
  merchants: MerchantsTable;
  tariffs: TariffsTable;
  couriers: CouriersTable;
  deliveries: DeliveriesTable;
  events: EventsTable;
  ingest_rejections: IngestRejectionsTable;
}
