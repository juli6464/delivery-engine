import { createHash, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Config } from './config.js';
import type { LlmProvider } from './agent/llm.js';
import type { Database } from './db/schema.js';
import { registerRoutes } from './routes.js';

export interface AppDeps {
  db: Kysely<Database>;
  config: Config;
  /** null = asistente deshabilitado (no hay GROQ_API_KEY). */
  llm?: LlmProvider | null;
  logger?: boolean;
}

export async function buildApp({ db, config, llm = null, logger = false }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 });

  await app.register(cors, { origin: config.corsOrigin });

  // Control de acceso mínimo (el enunciado dice que no hace falta; ver README, "Control de acceso").
  if (config.opsApiKey) {
    const expected = digest(config.opsApiKey);
    app.addHook('onRequest', async (req, reply) => {
      if (req.method === 'OPTIONS' || req.url === '/health') return;
      const given = req.headers['x-api-key'];
      if (typeof given !== 'string' || !timingSafeEqual(digest(given), expected)) {
        return reply.code(401).send({ error: 'no autorizado' });
      }
    });
  } else {
    app.log.warn('OPS_API_KEY no está definida: la API queda sin control de acceso');
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'solicitud inválida', details: z.prettifyError(err) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (err as Error).message });
    }
    req.log.error(err);
    // Nunca se devuelven detalles internos (stack, SQL) al cliente.
    return reply.code(500).send({ error: 'error interno' });
  });

  app.get('/health', async () => ({ ok: true }));
  registerRoutes(app, { db, config, llm });

  return app;
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}
