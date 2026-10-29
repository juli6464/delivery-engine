import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Carga el .env de la raíz si existe. Las credenciales nunca van en el código (ver README). */
export function loadEnvFile(): void {
  const file = resolve(ROOT_DIR, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_FILE: z.string().default('./data/delivery-engine.sqlite'),
  OPS_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(8).optional()),
  OPS_TIMEZONE: z.string().default('America/Bogota'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GROQ_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = envSchema.parse(env);
  return {
    port: e.PORT,
    databaseFile: isAbsolute(e.DATABASE_FILE) ? e.DATABASE_FILE : resolve(ROOT_DIR, e.DATABASE_FILE),
    opsApiKey: e.OPS_API_KEY ?? null,
    opsTimezone: e.OPS_TIMEZONE,
    corsOrigin: e.CORS_ORIGIN,
    groqApiKey: e.GROQ_API_KEY ?? null,
    groqModel: e.GROQ_MODEL,
  };
}
