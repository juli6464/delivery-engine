import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb, migrate } from '../src/db/connection.js';
import type { Database } from '../src/db/schema.js';

let db: Kysely<Database>;

beforeEach(async () => {
  db = createDb(':memory:');
  await migrate(db);
});
afterEach(() => db.destroy());

const event = {
  event_id: 'e1',
  delivery_id: 'd1',
  type: 'creada',
  occurred_at: '2026-10-20T10:00:00Z',
  received_at: '2026-10-20T10:00:01Z',
  lat: null,
  lon: null,
  courier_id: null,
  payload: '{}',
  payload_hash: 'h',
};

describe('esquema', () => {
  it('la migración es repetible', async () => {
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it('event_id es único: la base rechaza un evento repetido (base de la idempotencia)', async () => {
    await db.insertInto('events').values(event).execute();
    await expect(db.insertInto('events').values(event).execute()).rejects.toThrow(/UNIQUE|PRIMARY/);
  });

  it('no acepta tarifas negativas', async () => {
    await db.insertInto('merchants').values({ id: 'm1', name: 'X', timezone: 'America/Bogota', notes: null, delivery_instructions: null }).execute();
    await expect(
      db.insertInto('tariffs').values({ id: 't', merchant_id: 'm1', base_cop: -1, per_km_cop: 0, valid_from: '2026-01-01T00:00:00Z', valid_to: null }).execute(),
    ).rejects.toThrow(/CHECK/);
  });
});
