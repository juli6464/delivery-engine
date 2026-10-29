import type { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import type { Database } from '../db/schema.js';
import { ingestEvent, type IngestOutcome } from '../services/ingest.js';
import { couriers, generateEvents, merchants, tariffs } from './dataset.js';

/** Carga datos maestros e ingiere los eventos por el mismo camino que usa la API. */
export async function seed(db: Kysely<Database>, reference: DateTime = DateTime.utc()) {
  await db.insertInto('merchants').values(merchants).execute();
  await db.insertInto('couriers').values(couriers).execute();
  await db.insertInto('tariffs').values(tariffs(reference)).execute();

  const counts: Record<IngestOutcome, number> = { accepted: 0, duplicate: 0, conflict: 0, invalid: 0, unknown_merchant: 0 };
  for (const e of generateEvents(reference)) counts[(await ingestEvent(db, e)).outcome]++;
  return counts;
}
