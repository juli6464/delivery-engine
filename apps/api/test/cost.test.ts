import { describe, expect, it } from 'vitest';
import { isNight, projectDelivery, tariffAt } from '../src/domain/cost.js';
import { haversineKm } from '../src/domain/geo.js';
import { percentOf } from '../src/domain/money.js';
import type { DeliveryEvent, Tariff } from '../src/domain/types.js';

const BOGOTA = 'America/Bogota';

// Tarifa de prueba: base $5.000, $1.000 por km (COP).
const TARIFF: Tariff = { id: 't1', baseCop: 5_000, perKmCop: 1_000, validFrom: '2026-01-01T00:00:00Z', validTo: null };

// Recogida y entrega sobre el mismo meridiano: 0.05° de latitud = 0.05 × 6371 × π/180 km.
const PICKUP = { lat: 6.2, lon: -75.57 };
const DROP = { lat: 6.25, lon: -75.57 };
const KM = 0.05 * 6371 * (Math.PI / 180);

function ev(type: DeliveryEvent['type'], occurredAt: string, extra: Partial<DeliveryEvent> = {}): DeliveryEvent {
  return { eventId: `${type}-${occurredAt}`, deliveryId: 'd1', type, occurredAt, ...extra };
}

/** Ciclo completo con la entrega a la hora local indicada (Bogotá, UTC-5). */
function fullLifecycle(deliveredLocal: string): DeliveryEvent[] {
  return [
    ev('creada', '2026-10-20T08:00:00-05:00'),
    ev('asignada', '2026-10-20T08:05:00-05:00', { courierId: 'c1' }),
    ev('recogida', '2026-10-20T08:30:00-05:00', PICKUP),
    ev('en_ruta', '2026-10-20T08:31:00-05:00'),
    ev('entregada', deliveredLocal, DROP),
  ];
}

const project = (events: DeliveryEvent[], timezone = BOGOTA, tariffs = [TARIFF]) =>
  projectDelivery({ deliveryId: 'd1', events, tariffs, timezone });

describe('cálculo de entrega diurna', () => {
  it('cobra base + distancia (Haversine) sin recargo', () => {
    const p = project(fullLifecycle('2026-10-20T12:00:00-05:00'));
    const distanceCop = Math.round(KM * TARIFF.perKmCop);

    expect(p.status).toBe('entregada');
    expect(p.costStatus).toBe('calculado');
    expect(p.breakdown?.night).toBe(false);
    expect(p.breakdown?.distanceCop).toBe(distanceCop);
    expect(p.costCop).toBe(5_000 + distanceCop);
    expect(p.courierId).toBe('c1');
  });

  it('haversine coincide con el valor de referencia (1° de latitud ≈ 111.195 km)', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.195, 3);
  });
});

describe('recargo nocturno [20:00, 06:00) en hora local del comercio', () => {
  it.each([
    ['19:59', false],
    ['20:00', true],
    ['23:59', true],
    ['00:00', true],
    ['05:59', true],
    ['06:00', false],
  ])('entregada a las %s local → nocturno=%s', (hhmm, night) => {
    const day = hhmm < '12:00' ? '2026-10-21' : '2026-10-20';
    const p = project(fullLifecycle(`${day}T${hhmm}:00-05:00`));
    const subtotal = 5_000 + Math.round(KM * TARIFF.perKmCop);

    expect(p.breakdown?.night).toBe(night);
    expect(p.costCop).toBe(night ? subtotal + percentOf(subtotal, 15) : subtotal);
  });

  it('usa la zona del comercio, no la del evento: el mismo instante es diurno en Bogotá y nocturno en Madrid', () => {
    const instant = '2026-10-20T23:30:00Z'; // 18:30 en Bogotá, 01:30 en Madrid
    expect(isNight(instant, BOGOTA).night).toBe(false);
    expect(isNight(instant, 'Europe/Madrid').night).toBe(true);
  });

  it('respeta el horario de verano (no usa offsets fijos)', () => {
    // 00:30Z del 1 de julio = 20:30 en Nueva York (EDT, UTC-4); con un offset fijo de -5 serían 19:30.
    expect(isNight('2026-07-01T00:30:00Z', 'America/New_York').night).toBe(true);
  });
});

describe('entrega fallida', () => {
  it('cobra el 40% de la base, sin distancia ni recargo aunque sea de noche', () => {
    const p = project([
      ev('creada', '2026-10-20T19:00:00-05:00'),
      ev('recogida', '2026-10-20T19:30:00-05:00', PICKUP),
      ev('fallida', '2026-10-20T22:00:00-05:00', DROP),
    ]);

    expect(p.status).toBe('fallida');
    expect(p.costCop).toBe(2_000);
    expect(p.breakdown).toMatchObject({ rule: 'fallida', distanceCop: 0, nightSurchargeCop: 0 });
  });

  it('puede fallar desde un estado temprano (asignada)', () => {
    const p = project([ev('creada', '2026-10-20T10:00:00Z'), ev('asignada', '2026-10-20T10:05:00Z'), ev('fallida', '2026-10-20T10:30:00Z')]);
    expect(p.status).toBe('fallida');
    expect(p.costCop).toBe(2_000);
  });
});

describe('idempotencia', () => {
  it('eventos duplicados no alteran el costo', () => {
    const events = fullLifecycle('2026-10-20T21:00:00-05:00');
    const once = project(events);
    const withRetries = project([...events, ...events, events[4]!, events[2]!]);

    expect(withRetries).toEqual(once);
  });
});

describe('eventos desordenados', () => {
  const events = fullLifecycle('2026-10-20T21:00:00-05:00');
  const expected = project(events);

  it('entregada antes que recogida → mismo costo', () => {
    const [creada, asignada, recogida, enRuta, entregada] = events;
    expect(project([entregada!, enRuta!, creada!, recogida!, asignada!])).toEqual(expected);
  });

  it('las 120 permutaciones de llegada dan exactamente la misma proyección', () => {
    for (const perm of permutations(events)) expect(project(perm)).toEqual(expected);
  });

  it('si llega entregada y todavía no recogida, el costo queda pendiente (no se calcula con 0 km)', () => {
    const p = project([ev('creada', '2026-10-20T08:00:00-05:00'), events[4]!]);
    expect(p.status).toBe('entregada');
    expect(p.costStatus).toBe('pendiente');
    expect(p.costCop).toBeNull();
    expect(p.reason).toMatch(/recogida/);
  });

  it('el estado es el de mayor rango aunque un evento llegue con reloj atrasado', () => {
    const p = project([ev('creada', '2026-10-20T08:00:00Z'), ev('en_ruta', '2026-10-20T08:10:00Z'), ev('asignada', '2026-10-20T08:20:00Z')]);
    expect(p.status).toBe('en_ruta');
    expect(p.costStatus).toBe('pendiente');
  });
});

describe('conflicto terminal', () => {
  it('entregada y fallida: factura por la más antigua y marca conflicto', () => {
    const events = [...fullLifecycle('2026-10-20T12:00:00-05:00'), ev('fallida', '2026-10-20T13:00:00-05:00')];
    const p = project(events);

    expect(p.status).toBe('entregada');
    expect(p.costStatus).toBe('conflicto');
    expect(p.costCop).toBe(project(fullLifecycle('2026-10-20T12:00:00-05:00')).costCop);
    expect(p.reason).toMatch(/revisión/);
  });
});

describe('tarifas versionadas', () => {
  const tariffs: Tariff[] = [
    { ...TARIFF, id: 'v1', validTo: '2026-10-15T00:00:00Z' },
    { ...TARIFF, id: 'v2', baseCop: 6_000, validFrom: '2026-10-15T00:00:00Z' },
  ];

  it('usa la tarifa vigente al momento del evento terminal', () => {
    expect(tariffAt(tariffs, '2026-10-14T23:59:59Z')?.id).toBe('v1');
    expect(tariffAt(tariffs, '2026-10-15T00:00:00Z')?.id).toBe('v2');
    expect(project(fullLifecycle('2026-10-20T12:00:00-05:00'), BOGOTA, tariffs).breakdown?.tariffId).toBe('v2');
  });

  it('sin tarifa vigente el costo queda pendiente', () => {
    const p = project(fullLifecycle('2025-01-01T12:00:00-05:00'));
    expect(p.costStatus).toBe('pendiente');
    expect(p.reason).toMatch(/tarifa/);
  });
});

describe('dinero', () => {
  it('percentOf redondea half-up con enteros', () => {
    expect(percentOf(1_000_000, 15)).toBe(150_000);
    expect(percentOf(10, 15)).toBe(2); // 1.5 → 2
    expect(percentOf(3, 15)).toBe(0); // 0.45 → 0
    expect(() => percentOf(1.5, 15)).toThrow();
  });
});

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) return yield items;
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i]!, ...p];
  }
}
