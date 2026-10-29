import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { chatRequestSchema, runAgent } from './agent/agent.js';
import { LlmUnavailableError, type LlmProvider } from './agent/llm.js';
import type { Kysely } from 'kysely';
import type { Config } from './config.js';
import type { Database } from './db/schema.js';
import { billingQuerySchema, courierQuerySchema, ingestBodySchema, searchQuerySchema } from './schemas.js';
import { HTTP_STATUS, ingestEvent, type IngestResult } from './services/ingest.js';
import { courierDeliveriesByStatus, getDelivery, listCouriers, listMerchants, merchantBilling } from './services/queries.js';
import { searchDeliveries } from './services/search.js';

export function registerRoutes(
  app: FastifyInstance,
  { db, config, llm }: { db: Kysely<Database>; config: Config; llm: LlmProvider | null },
) {
  /** Ingesta: un evento (código HTTP según el resultado) o un lote (200 con el resultado de cada uno). */
  app.post('/events', async (req, reply) => {
    const body = ingestBodySchema.safeParse(req.body);
    if (!body.success || !Array.isArray(body.data)) {
      const result = await ingestEvent(db, req.body);
      return reply.code(HTTP_STATUS[result.outcome]).send(result);
    }

    const results: IngestResult[] = [];
    for (const raw of body.data) results.push(await ingestEvent(db, raw));
    const summary = Object.fromEntries(Object.keys(HTTP_STATUS).map((k) => [k, results.filter((r) => r.outcome === k).length]));
    return reply.code(200).send({ summary, results });
  });

  app.get('/merchants', async () => listMerchants(db));
  app.get('/couriers', async () => listCouriers(db));

  app.get('/reports/billing', async (req) => {
    const q = billingQuerySchema.parse(req.query);
    return { results: await merchantBilling(db, q) };
  });

  app.get<{ Params: { id: string } }>('/reports/couriers/:id', async (req, reply) => {
    const q = courierQuerySchema.parse(req.query);
    const report = await courierDeliveriesByStatus(db, req.params.id, q, config.opsTimezone);
    return report ?? reply.code(404).send({ error: 'mensajero no encontrado' });
  });

  app.get('/deliveries/search', async (req) => searchDeliveries(db, searchQuerySchema.parse(req.query)));

  app.get<{ Params: { id: string } }>('/deliveries/:id', async (req, reply) => {
    const d = await getDelivery(db, req.params.id);
    return d ?? reply.code(404).send({ error: 'entrega no encontrada' });
  });

  /** Asistente conversacional. El servidor no guarda historial: el cliente envía los turnos previos (solo user/assistant). */
  app.post('/chat', async (req, reply) => {
    const body = chatRequestSchema.parse(req.body);
    if (!llm) return reply.code(503).send({ error: 'El asistente no está configurado: falta GROQ_API_KEY en .env.' });
    try {
      return await runAgent(llm, { db, opsTimezone: config.opsTimezone, now: () => DateTime.now() }, body);
    } catch (err) {
      if (err instanceof LlmUnavailableError) {
        req.log.warn({ err: err.cause }, `proveedor LLM no disponible: ${err.message}`);
        return reply.code(503).send({ error: err.message, retryable: err.retryable });
      }
      throw err;
    }
  });
}
