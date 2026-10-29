import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

/**
 * Escapa los comodines de LIKE (% y _) y el carácter de escape, para que el texto se busque literal.
 * La inyección SQL ya está descartada porque el texto viaja como parámetro; esto evita además
 * que un "%" del usuario devuelva toda la tabla.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface SearchResult {
  id: string;
  merchant_name: string;
  address: string | null;
  courier_name: string | null;
  status: string;
  cost_status: string;
  cost_cop: number | null;
  completed_at: string | null;
}

/**
 * Buscador de texto libre por comercio, dirección o mensajero.
 * Requisito de operaciones rechazado: NO se concatena el texto en el SQL (ver README).
 */
export async function searchDeliveries(
  db: Kysely<Database>,
  q: { q: string; limit: number; offset: number },
): Promise<{ results: SearchResult[]; limit: number; offset: number }> {
  const pattern = `%${escapeLike(q.q)}%`;
  const like = (column: 'm.name' | 'd.address' | 'c.name') => sql<boolean>`${sql.ref(column)} like ${pattern} escape '\\'`;

  const results = await db
    .selectFrom('deliveries as d')
    .innerJoin('merchants as m', 'm.id', 'd.merchant_id')
    .leftJoin('couriers as c', 'c.id', 'd.courier_id')
    .select([
      'd.id', 'm.name as merchant_name', 'd.address', 'c.name as courier_name',
      'd.status', 'd.cost_status', 'd.cost_cop', 'd.completed_at',
    ])
    .where((eb) => eb.or([like('m.name'), like('d.address'), like('c.name')]))
    .orderBy('d.first_event_at', 'desc')
    .orderBy('d.id')
    .limit(q.limit)
    .offset(q.offset)
    .execute();

  return { results, limit: q.limit, offset: q.offset };
}
