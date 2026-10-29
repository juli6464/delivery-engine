import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { projectDelivery } from '../domain/cost.js';
import type { DeliveryEvent, DeliveryProjection, EventType, Tariff } from '../domain/types.js';
import type { Database } from '../db/schema.js';
import { eventSchema, type IncomingEvent } from '../schemas.js';

export type IngestOutcome = 'accepted' | 'duplicate' | 'conflict' | 'invalid' | 'unknown_merchant';

export interface IngestResult {
  outcome: IngestOutcome;
  event_id: string | null;
  message?: string;
  errors?: string;
  delivery?: Pick<DeliveryProjection, 'deliveryId' | 'status' | 'costStatus' | 'costCop' | 'reason'>;
}

/** HTTP sugerido para cada resultado de un evento individual. */
export const HTTP_STATUS: Record<IngestOutcome, number> = {
  accepted: 201,
  duplicate: 200,
  conflict: 409,
  invalid: 400,
  unknown_merchant: 422,
};

const MAX_LOGGED_PAYLOAD = 10_000;

/**
 * Ingesta idempotente de un evento:
 * - event_id nuevo → se guarda y se recalcula la entrega desde TODOS sus eventos (orden de llegada irrelevante).
 * - event_id repetido con el mismo contenido → "duplicate", no cambia nada (reintento del emisor).
 * - event_id repetido con otro contenido → "conflict" (409) y queda registrado; nunca se sobrescribe.
 */
export async function ingestEvent(db: Kysely<Database>, raw: unknown, now: () => Date = () => new Date()): Promise<IngestResult> {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    const eventId = extractEventId(raw);
    const errors = z.prettifyError(parsed.error);
    await reject(db, eventId, `invalid: ${errors}`, raw);
    return { outcome: 'invalid', event_id: eventId, errors };
  }

  const e = parsed.data;
  const hash = payloadHash(e);
  const receivedAt = now().toISOString();

  return db.transaction().execute(async (trx) => {
    const merchant = await trx.selectFrom('merchants').select(['id', 'timezone']).where('id', '=', e.merchant_id).executeTakeFirst();
    if (!merchant) {
      await reject(trx, e.event_id, `unknown_merchant: ${e.merchant_id}`, raw);
      return { outcome: 'unknown_merchant', event_id: e.event_id, message: `comercio desconocido: ${e.merchant_id}` };
    }

    const existing = await trx.selectFrom('events').select('payload_hash').where('event_id', '=', e.event_id).executeTakeFirst();
    if (existing) {
      if (existing.payload_hash === hash) {
        return { outcome: 'duplicate', event_id: e.event_id, message: 'evento ya recibido; sin cambios' };
      }
      await reject(trx, e.event_id, 'conflict: mismo event_id con contenido distinto', raw);
      return { outcome: 'conflict', event_id: e.event_id, message: 'event_id ya existe con contenido distinto' };
    }

    const delivery = await trx.selectFrom('deliveries').select(['merchant_id', 'address']).where('id', '=', e.delivery_id).executeTakeFirst();
    if (delivery && delivery.merchant_id !== e.merchant_id) {
      await reject(trx, e.event_id, `conflict: la entrega ${e.delivery_id} pertenece a otro comercio`, raw);
      return { outcome: 'conflict', event_id: e.event_id, message: 'la entrega pertenece a otro comercio' };
    }

    if (e.courier_id) {
      // Mensajero no registrado: se crea con su id como nombre para no perder el evento (supuesto documentado).
      await trx.insertInto('couriers').values({ id: e.courier_id, name: e.courier_id }).onConflict((oc) => oc.doNothing()).execute();
    }

    await trx
      .insertInto('events')
      .values({
        event_id: e.event_id,
        delivery_id: e.delivery_id,
        type: e.type,
        occurred_at: e.occurred_at,
        received_at: receivedAt,
        lat: e.lat ?? null,
        lon: e.lon ?? null,
        courier_id: e.courier_id ?? null,
        payload: JSON.stringify(e),
        payload_hash: hash,
      })
      .execute();

    const projection = await recompute(trx, e.delivery_id, merchant, e.address ?? delivery?.address ?? null, receivedAt);
    return {
      outcome: 'accepted',
      event_id: e.event_id,
      delivery: {
        deliveryId: projection.deliveryId,
        status: projection.status,
        costStatus: projection.costStatus,
        costCop: projection.costCop,
        reason: projection.reason,
      },
    };
  });
}

/** Recalcula la proyección de una entrega a partir de su historial completo de eventos. */
async function recompute(
  trx: Transaction<Database>,
  deliveryId: string,
  merchant: { id: string; timezone: string },
  address: string | null,
  updatedAt: string,
): Promise<DeliveryProjection> {
  const rows = await trx.selectFrom('events').selectAll().where('delivery_id', '=', deliveryId).execute();
  const events: DeliveryEvent[] = rows.map((r) => ({
    eventId: r.event_id,
    deliveryId: r.delivery_id,
    type: r.type as EventType,
    occurredAt: r.occurred_at,
    ...(r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : {}),
    ...(r.courier_id ? { courierId: r.courier_id } : {}),
  }));

  const tariffRows = await trx.selectFrom('tariffs').selectAll().where('merchant_id', '=', merchant.id).execute();
  const tariffs: Tariff[] = tariffRows.map((t) => ({
    id: t.id,
    baseCop: t.base_cop,
    perKmCop: t.per_km_cop,
    validFrom: t.valid_from,
    validTo: t.valid_to,
  }));

  const p = projectDelivery({ deliveryId, events, tariffs, timezone: merchant.timezone });
  const firstEventAt = rows.reduce((min, r) => (r.occurred_at < min ? r.occurred_at : min), rows[0]!.occurred_at);
  const values = {
    merchant_id: merchant.id,
    courier_id: p.courierId,
    address,
    status: p.status,
    cost_status: p.costStatus,
    cost_cop: p.costCop,
    cost_breakdown: p.breakdown ? JSON.stringify(p.breakdown) : null,
    cost_reason: p.reason,
    first_event_at: firstEventAt,
    completed_at: p.completedAt,
    updated_at: updatedAt,
  };

  await trx
    .insertInto('deliveries')
    .values({ id: deliveryId, ...values })
    .onConflict((oc) => oc.column('id').doUpdateSet(values))
    .execute();

  return p;
}

/** Hash del evento ya validado y normalizado, con claves ordenadas: el formato del JSON no cambia el resultado. */
function payloadHash(e: IncomingEvent): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(e).sort(([a], [b]) => a.localeCompare(b))));
  return createHash('sha256').update(canonical).digest('hex');
}

async function reject(db: Kysely<Database> | Transaction<Database>, eventId: string | null, reason: string, raw: unknown) {
  await db
    .insertInto('ingest_rejections')
    .values({ event_id: eventId, reason: reason.slice(0, 2000), payload: safeStringify(raw).slice(0, MAX_LOGGED_PAYLOAD) })
    .execute();
}

function extractEventId(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'event_id' in raw && typeof raw.event_id === 'string') return raw.event_id.slice(0, 100);
  return null;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
