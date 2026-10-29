import { DateTime } from 'luxon';
import { z } from 'zod';
import { EVENT_TYPES } from './domain/types.js';

const id = z.string().trim().min(1).max(100).regex(/^[\w.:-]+$/, 'solo letras, números y . _ : -');

/** Normaliza a UTC ISO: así las comparaciones de rango en la base son correctas como texto. */
const instant = z.iso.datetime({ offset: true }).transform((s) => DateTime.fromISO(s, { setZone: true }).toUTC().toISO()!);

const COORDS_REQUIRED: readonly string[] = ['recogida', 'entregada'];

/**
 * Supuesto: todo evento trae merchant_id además de delivery_id. Si "entregada" llega antes que "creada",
 * igual sabemos de qué comercio es y qué tarifa aplicar.
 */
export const eventSchema = z
  .object({
    event_id: id,
    delivery_id: id,
    merchant_id: id,
    type: z.enum(EVENT_TYPES),
    occurred_at: instant,
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    courier_id: id.optional(),
    address: z.string().trim().max(300).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (COORDS_REQUIRED.includes(e.type) && (e.lat === undefined || e.lon === undefined)) {
      ctx.addIssue({ code: 'custom', message: `el evento "${e.type}" requiere lat y lon`, path: ['lat'] });
    }
  });

export type IncomingEvent = z.infer<typeof eventSchema>;

export const MAX_BATCH = 500;
export const ingestBodySchema = z.union([eventSchema, z.array(z.unknown()).min(1).max(MAX_BATCH)]);

export const day = z.iso.date();

export const billingQuerySchema = z
  .object({ merchant_id: id.optional(), from: day, to: day })
  .refine((q) => q.from <= q.to, { message: '"from" debe ser anterior o igual a "to"', path: ['from'] });

export const courierQuerySchema = z
  .object({ from: day.optional(), to: day.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" debe ser anterior o igual a "to"', path: ['from'] });

export const MAX_SEARCH_LENGTH = 100;
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
