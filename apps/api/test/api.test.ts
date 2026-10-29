import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, migrate } from '../src/db/connection.js';
import type { Database } from '../src/db/schema.js';
import { localDayRange } from '../src/services/queries.js';
import { escapeLike } from '../src/services/search.js';
import { seed } from '../src/seed/seed.js';

const API_KEY = 'clave-de-prueba-123';
const REFERENCE = DateTime.utc(2026, 10, 29, 15);

let db: Kysely<Database>;
let app: FastifyInstance;

beforeEach(async () => {
  db = createDb(':memory:');
  await migrate(db);
  await seed(db, REFERENCE);
  app = await buildApp({ db, config: loadConfig({ OPS_API_KEY: API_KEY }) });
});
afterEach(async () => {
  await app.close();
  await db.destroy();
});

const headers = { 'x-api-key': API_KEY };
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/events', headers, payload: payload as object });
const get = (url: string) => app.inject({ method: 'GET', url, headers });

const newEvent = (over: Record<string, unknown> = {}) => ({
  event_id: 'nuevo-1',
  delivery_id: 'd-test',
  merchant_id: 'm-la80',
  type: 'creada',
  occurred_at: '2026-10-29T08:00:00-05:00',
  ...over,
});

describe('control de acceso', () => {
  it('rechaza sin API key y deja pasar /health', async () => {
    expect((await app.inject({ method: 'GET', url: '/merchants' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/merchants', headers: { 'x-api-key': 'otra' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('POST /events — idempotencia', () => {
  it('201 la primera vez, 200 duplicate en el reintento, sin cambiar la entrega', async () => {
    expect((await post(newEvent())).statusCode).toBe(201);
    const before = await get('/deliveries/d-test');

    const retry = await post(newEvent());
    expect(retry.statusCode).toBe(200);
    expect(retry.json().outcome).toBe('duplicate');
    expect((await get('/deliveries/d-test')).json()).toEqual(before.json());
  });

  it('el reintento con otro formato de fecha pero el mismo instante sigue siendo duplicado', async () => {
    await post(newEvent());
    const retry = await post(newEvent({ occurred_at: '2026-10-29T13:00:00Z' }));
    expect(retry.json().outcome).toBe('duplicate');
  });

  it('409 si el mismo event_id llega con contenido distinto, y el original no se modifica', async () => {
    await post(newEvent());
    const res = await post(newEvent({ occurred_at: '2026-10-29T09:00:00-05:00' }));
    expect(res.statusCode).toBe(409);

    const events = (await get('/deliveries/d-test')).json().events;
    expect(events).toHaveLength(1);
    expect(events[0].occurred_at).toBe('2026-10-29T13:00:00.000Z');
    const rejections = await db.selectFrom('ingest_rejections').selectAll().where('event_id', '=', 'nuevo-1').execute();
    expect(rejections).toHaveLength(1);
  });

  it('el reintento de un lote completo no cambia la facturación', async () => {
    const billing = () => get('/reports/billing?merchant_id=m-la80&from=2026-10-01&to=2026-10-31').then((r) => r.json());
    const batch = [
      newEvent({ event_id: 'b-1', delivery_id: 'd-b', type: 'recogida', lat: 6.25, lon: -75.56, courier_id: 'c-ana' }),
      newEvent({ event_id: 'b-2', delivery_id: 'd-b', type: 'entregada', occurred_at: '2026-10-29T08:40:00-05:00', lat: 6.27, lon: -75.56 }),
    ];
    const first = await post(batch);
    expect(first.json().summary.accepted).toBe(2);
    const after = await billing();

    const second = await post(batch);
    expect(second.json().summary.duplicate).toBe(2);
    expect(await billing()).toEqual(after);
  });
});

describe('POST /events — desorden y validación', () => {
  it('entregada antes que recogida: queda pendiente y se calcula al llegar la recogida', async () => {
    const delivered = await post(newEvent({ event_id: 'x-ent', type: 'entregada', occurred_at: '2026-10-29T10:30:00-05:00', lat: 6.27, lon: -75.56 }));
    expect(delivered.json().delivery).toMatchObject({ status: 'entregada', costStatus: 'pendiente', costCop: null });

    const picked = await post(newEvent({ event_id: 'x-rec', type: 'recogida', occurred_at: '2026-10-29T10:00:00-05:00', lat: 6.25, lon: -75.56 }));
    expect(picked.json().delivery).toMatchObject({ status: 'entregada', costStatus: 'calculado' });
    expect(picked.json().delivery.costCop).toBeGreaterThan(6_500);
  });

  it.each([
    ['sin event_id', { event_id: undefined }],
    ['tipo desconocido', { type: 'perdida' }],
    ['fecha sin zona horaria', { occurred_at: '2026-10-29T08:00:00' }],
    ['entregada sin coordenadas', { type: 'entregada' }],
    ['campo no esperado', { costo: 1 }],
    ['latitud fuera de rango', { type: 'recogida', lat: 200, lon: 0 }],
  ])('400 con %s, y queda registrado', async (_, over) => {
    const res = await post(newEvent(over));
    expect(res.statusCode).toBe(400);
    expect(res.json().outcome).toBe('invalid');
  });

  it('422 si el comercio no existe', async () => {
    expect((await post(newEvent({ merchant_id: 'm-nadie' }))).statusCode).toBe(422);
  });

  it('409 si un evento dice que la entrega es de otro comercio', async () => {
    await post(newEvent());
    expect((await post(newEvent({ event_id: 'nuevo-2', merchant_id: 'm-farma' }))).statusCode).toBe(409);
  });
});

describe('consultas agregadas', () => {
  it('facturación por comercio: suma solo lo calculado y separa pendientes y conflictos', async () => {
    const res = await get('/reports/billing?merchant_id=m-la80&from=2026-10-28&to=2026-10-28');
    const [b] = res.json().results;
    const ids = ['d-la80-noche', 'd-la80-pend', 'd-la80-conf'];
    const rows = await db.selectFrom('deliveries').select(['id', 'cost_cop']).where('id', 'in', ids).execute();
    const cost = (id: string) => rows.find((r) => r.id === id)!.cost_cop!;

    expect(b.pending).toBeGreaterThanOrEqual(1);
    expect(b.conflicts).toBe(1);
    expect(b.conflict_cop).toBe(cost('d-la80-conf'));
    // El total coincide con la suma de las entregas calculadas de ese día local.
    const { fromUtc, toUtc } = localDayRange('2026-10-28', '2026-10-28', 'America/Bogota');
    const expected = await db
      .selectFrom('deliveries')
      .select(({ fn }) => fn.sum<number>('cost_cop').as('s'))
      .where('merchant_id', '=', 'm-la80')
      .where('cost_status', '=', 'calculado')
      .where('completed_at', '>=', fromUtc)
      .where('completed_at', '<', toUtc)
      .executeTakeFirstOrThrow();
    expect(b.total_cop).toBe(expected.s);
  });

  it('el rango usa la zona del comercio: 23:30 en Bogotá cuenta para ese día aunque en UTC sea el siguiente', async () => {
    await post(newEvent({ event_id: 'z-1', delivery_id: 'd-z', type: 'fallida', occurred_at: '2026-10-29T23:30:00-05:00' }));
    const day = await get('/reports/billing?merchant_id=m-la80&from=2026-10-29&to=2026-10-29');
    const next = await get('/reports/billing?merchant_id=m-la80&from=2026-10-30&to=2026-10-30');
    expect(day.json().results[0].failed).toBeGreaterThanOrEqual(1);
    expect(next.json().results[0].deliveries).toBe(0);
  });

  it('mismo instante, distinto recargo según la zona del comercio (Ciudad de México vs. Nueva York)', async () => {
    const farma = (await get('/deliveries/d-farma-tz')).json();
    const flores = (await get('/deliveries/d-flores-tz')).json();

    expect(farma.timezone).toBe('America/Mexico_City');
    expect(farma.cost_breakdown).toMatchObject({ night: false, nightSurchargeCop: 0, localCompletedAt: '2026-10-28T19:30:00-06:00' });
    expect(flores.timezone).toBe('America/New_York');
    expect(flores.cost_breakdown).toMatchObject({ night: true, localCompletedAt: '2026-10-28T21:30:00-04:00' });
    expect(flores.cost_breakdown.nightSurchargeCop).toBeGreaterThan(0);
  });

  it('el día de facturación es el local del comercio: 23:30 en Bogotá ya es el día siguiente en Nueva York', async () => {
    const bogota2330 = '2026-10-29T23:30:00-05:00'; // = 00:30 del 30 en Nueva York (EDT)
    await post(newEvent({ event_id: 'ny-1', delivery_id: 'd-ny', merchant_id: 'm-flores', type: 'fallida', occurred_at: bogota2330 }));
    await post(newEvent({ event_id: 'co-1', delivery_id: 'd-co', merchant_id: 'm-la80', type: 'fallida', occurred_at: bogota2330 }));

    const billing = async (merchant: string, day: string) =>
      (await get(`/reports/billing?merchant_id=${merchant}&from=${day}&to=${day}`)).json().results[0].failed;
    expect(await billing('m-la80', '2026-10-29')).toBe(1);
    expect(await billing('m-flores', '2026-10-29')).toBe(0);
    expect(await billing('m-flores', '2026-10-30')).toBe(1);
  });

  it('sin merchant_id devuelve todos los comercios', async () => {
    const res = await get('/reports/billing?from=2026-10-01&to=2026-10-31');
    expect(res.json().results).toHaveLength(4);
  });

  it('400 si el rango es inválido', async () => {
    expect((await get('/reports/billing?from=2026-10-31&to=2026-10-01')).statusCode).toBe(400);
    expect((await get('/reports/billing?from=ayer&to=hoy')).statusCode).toBe(400);
  });

  it('entregas por estado de un mensajero', async () => {
    const res = await get('/reports/couriers/c-ana');
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.courier_name).toBe('Ana Gómez');
    expect(body.total).toBe(Object.values(body.by_status as Record<string, number>).reduce((a, b) => a + b, 0));
    expect(body.total).toBeGreaterThan(0);
    expect((await get('/reports/couriers/c-nadie')).statusCode).toBe(404);
  });
});

describe('buscador — requisito de SQL concatenado rechazado', () => {
  it('encuentra por comercio, dirección y mensajero', async () => {
    expect((await get('/deliveries/search?q=La%2080')).json().results.length).toBeGreaterThan(0);
    expect((await get('/deliveries/search?q=Calle%2080%20%23%2045')).json().results.map((r: { id: string }) => r.id)).toContain('d-la80-pend');
    const byCourier = (await get('/deliveries/search?q=Ana%20G')).json().results;
    expect(byCourier.length).toBeGreaterThan(0);
    expect(byCourier.every((r: { courier_name: string }) => r.courier_name === 'Ana Gómez')).toBe(true);
  });

  it.each(["' OR 1=1 --", "%' OR '1'='1", "x'; DROP TABLE deliveries; --", '%', '_'])(
    'el texto %j se busca literal: no devuelve todo ni rompe la base',
    async (payload) => {
      const res = await get(`/deliveries/search?q=${encodeURIComponent(payload)}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().results).toHaveLength(0);
      const { n } = await db.selectFrom('deliveries').select(({ fn }) => fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      expect(n).toBeGreaterThan(0);
    },
  );

  it('escapa comodines de LIKE', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('limita longitud y resultados', async () => {
    expect((await get(`/deliveries/search?q=${'a'.repeat(101)}`)).statusCode).toBe(400);
    expect((await get('/deliveries/search?q=a&limit=500')).statusCode).toBe(400);
    expect((await get('/deliveries/search?q=Calle&limit=3')).json().results).toHaveLength(3);
  });

  it('no expone las notas internas del comercio', async () => {
    const body = (await get('/deliveries/search?q=La%2080')).body;
    expect(body).not.toMatch(/IGNORA/);
  });
});

describe('detalle de entrega', () => {
  it('devuelve el desglose del costo para auditoría', async () => {
    const d = (await get('/deliveries/d-la80-noche')).json();
    expect(d.cost_breakdown).toMatchObject({ night: true, tariffId: 't-la80-v2', eventIds: ['d-la80-noche-recogida', 'd-la80-noche-entregada'] });
    expect(d.cost_cop).toBe(d.cost_breakdown.totalCop);
  });
});
