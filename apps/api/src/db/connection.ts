import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import type { Database } from './schema.js';

/** Abre la base. Usa ':memory:' en tests. Cambiar a Postgres = cambiar el dialecto, no las consultas. */
export function createDb(file: string): Kysely<Database> {
  const sqlite = new SQLite(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
}

export async function migrate(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('merchants')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('timezone', 'text', (c) => c.notNull())
    .addColumn('notes', 'text')
    .addColumn('delivery_instructions', 'text')
    .execute();

  await db.schema
    .createTable('tariffs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('merchant_id', 'text', (c) => c.notNull().references('merchants.id'))
    .addColumn('base_cop', 'integer', (c) => c.notNull().check(sql`base_cop >= 0`))
    .addColumn('per_km_cop', 'integer', (c) => c.notNull().check(sql`per_km_cop >= 0`))
    .addColumn('valid_from', 'text', (c) => c.notNull())
    .addColumn('valid_to', 'text')
    .execute();

  await db.schema
    .createTable('couriers')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('deliveries')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('merchant_id', 'text', (c) => c.notNull().references('merchants.id'))
    .addColumn('courier_id', 'text', (c) => c.references('couriers.id'))
    .addColumn('address', 'text')
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('cost_status', 'text', (c) => c.notNull())
    .addColumn('cost_cop', 'integer')
    .addColumn('cost_breakdown', 'text')
    .addColumn('cost_reason', 'text')
    .addColumn('first_event_at', 'text', (c) => c.notNull())
    .addColumn('completed_at', 'text')
    .addColumn('updated_at', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('events')
    .ifNotExists()
    .addColumn('event_id', 'text', (c) => c.primaryKey())
    .addColumn('delivery_id', 'text', (c) => c.notNull())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('occurred_at', 'text', (c) => c.notNull())
    .addColumn('received_at', 'text', (c) => c.notNull())
    .addColumn('lat', 'real')
    .addColumn('lon', 'real')
    .addColumn('courier_id', 'text')
    .addColumn('payload', 'text', (c) => c.notNull())
    .addColumn('payload_hash', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('ingest_rejections')
    .ifNotExists()
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
    .addColumn('event_id', 'text')
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('payload', 'text', (c) => c.notNull())
    .addColumn('received_at', 'text', (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`))
    .execute();

  const indexes: [string, 'events' | 'deliveries' | 'tariffs', string[]][] = [
    ['idx_events_delivery', 'events', ['delivery_id']],
    ['idx_deliveries_merchant_completed', 'deliveries', ['merchant_id', 'completed_at']],
    ['idx_deliveries_courier_status', 'deliveries', ['courier_id', 'status']],
    ['idx_tariffs_merchant', 'tariffs', ['merchant_id', 'valid_from']],
  ];
  for (const [name, table, columns] of indexes) {
    await db.schema.createIndex(name).ifNotExists().on(table).columns(columns).execute();
  }
}
