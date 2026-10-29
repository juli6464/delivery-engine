import { DateTime } from 'luxon';
import { sql, type Kysely } from 'kysely';
import { EVENT_TYPES, type EventType } from '../domain/types.js';
import type { Database } from '../db/schema.js';

// Todas las agregaciones se resuelven aquí, en SQL determinista. El agente LLM solo las invoca.

/** Convierte un rango de días locales [from, to] a instantes UTC [inicio, fin) en la zona indicada. */
export function localDayRange(from: string, to: string, timezone: string): { fromUtc: string; toUtc: string } {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).startOf('day');
  if (!start.isValid || !end.isValid) throw new RangeError(`rango o zona inválidos: ${from}..${to} ${timezone}`);
  return { fromUtc: start.toUTC().toISO()!, toUtc: end.toUTC().toISO()! };
}

export interface MerchantBilling {
  merchant_id: string;
  merchant_name: string;
  timezone: string;
  from: string;
  to: string;
  /** Entregas terminadas (entregada o fallida) en el rango, por fecha local del comercio. */
  deliveries: number;
  delivered: number;
  failed: number;
  /** Solo suma costos en estado "calculado": pendientes y en conflicto no se facturan hasta resolverse. */
  total_cop: number;
  pending: number;
  conflicts: number;
  conflict_cop: number;
}

/**
 * Costo total y número de entregas por comercio en un rango de fechas.
 * Las fechas se interpretan en la zona horaria de cada comercio.
 */
export async function merchantBilling(
  db: Kysely<Database>,
  q: { merchant_id?: string | undefined; from: string; to: string },
): Promise<MerchantBilling[]> {
  let mq = db.selectFrom('merchants').select(['id', 'name', 'timezone']).orderBy('name');
  if (q.merchant_id) mq = mq.where('id', '=', q.merchant_id);
  const merchants = await mq.execute();

  const result: MerchantBilling[] = [];
  for (const m of merchants) {
    const { fromUtc, toUtc } = localDayRange(q.from, q.to, m.timezone);
    const row = await db
      .selectFrom('deliveries')
      .select([
        sql<number>`count(*)`.as('deliveries'),
        sql<number>`coalesce(sum(case when cost_status = ${'calculado'} and status = ${'entregada'} then 1 else 0 end), 0)`.as('delivered'),
        sql<number>`coalesce(sum(case when cost_status = ${'calculado'} and status = ${'fallida'} then 1 else 0 end), 0)`.as('failed'),
        sql<number>`coalesce(sum(case when cost_status = ${'calculado'} then cost_cop else 0 end), 0)`.as('total_cop'),
        sql<number>`coalesce(sum(case when cost_status = ${'pendiente'} then 1 else 0 end), 0)`.as('pending'),
        sql<number>`coalesce(sum(case when cost_status = ${'conflicto'} then 1 else 0 end), 0)`.as('conflicts'),
        sql<number>`coalesce(sum(case when cost_status = ${'conflicto'} then cost_cop else 0 end), 0)`.as('conflict_cop'),
      ])
      .where('merchant_id', '=', m.id)
      .where('completed_at', '>=', fromUtc)
      .where('completed_at', '<', toUtc)
      .executeTakeFirstOrThrow();

    result.push({ merchant_id: m.id, merchant_name: m.name, timezone: m.timezone, from: q.from, to: q.to, ...row });
  }
  return result;
}

export interface CourierStatusReport {
  courier_id: string;
  courier_name: string;
  from: string | null;
  to: string | null;
  timezone: string;
  total: number;
  by_status: Record<EventType, number>;
}

/**
 * Entregas por estado para un mensajero. El rango opcional filtra por la fecha del primer evento
 * de la entrega (las que no han terminado no tienen fecha de cierre), en la zona de operaciones.
 */
export async function courierDeliveriesByStatus(
  db: Kysely<Database>,
  courierId: string,
  q: { from?: string | undefined; to?: string | undefined },
  timezone: string,
): Promise<CourierStatusReport | null> {
  const courier = await db.selectFrom('couriers').select(['id', 'name']).where('id', '=', courierId).executeTakeFirst();
  if (!courier) return null;

  let query = db
    .selectFrom('deliveries')
    .select(['status', sql<number>`count(*)`.as('n')])
    .where('courier_id', '=', courierId)
    .groupBy('status');
  if (q.from) query = query.where('first_event_at', '>=', localDayRange(q.from, q.from, timezone).fromUtc);
  if (q.to) query = query.where('first_event_at', '<', localDayRange(q.to, q.to, timezone).toUtc);

  const by_status = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<EventType, number>;
  for (const r of await query.execute()) by_status[r.status as EventType] = r.n;

  return {
    courier_id: courier.id,
    courier_name: courier.name,
    from: q.from ?? null,
    to: q.to ?? null,
    timezone,
    total: Object.values(by_status).reduce((a, b) => a + b, 0),
    by_status,
  };
}

/** Lista de comercios sin notas internas (las notas solo salen por la vista de perfil). */
export function listMerchants(db: Kysely<Database>) {
  return db.selectFrom('merchants').select(['id', 'name', 'timezone']).orderBy('name').execute();
}

export function listCouriers(db: Kysely<Database>) {
  return db.selectFrom('couriers').select(['id', 'name']).orderBy('name').execute();
}

export async function getDelivery(db: Kysely<Database>, id: string) {
  const d = await db
    .selectFrom('deliveries as d')
    .innerJoin('merchants as m', 'm.id', 'd.merchant_id')
    .leftJoin('couriers as c', 'c.id', 'd.courier_id')
    .select([
      'd.id', 'd.status', 'd.cost_status', 'd.cost_cop', 'd.cost_breakdown', 'd.cost_reason', 'd.address',
      'd.first_event_at', 'd.completed_at', 'm.id as merchant_id', 'm.name as merchant_name', 'm.timezone', 'c.name as courier_name',
    ])
    .where('d.id', '=', id)
    .executeTakeFirst();
  if (!d) return null;

  const events = await db
    .selectFrom('events')
    .select(['event_id', 'type', 'occurred_at', 'received_at', 'lat', 'lon', 'courier_id'])
    .where('delivery_id', '=', id)
    .orderBy('occurred_at')
    .execute();

  return { ...d, cost_breakdown: d.cost_breakdown ? JSON.parse(d.cost_breakdown) : null, events };
}
