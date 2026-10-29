import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { GroqProvider } from './agent/llm.js';
import { buildApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';
import { createDb, migrate } from './db/connection.js';

loadEnvFile();
const config = loadConfig();
mkdirSync(dirname(config.databaseFile), { recursive: true });

const db = createDb(config.databaseFile);
await migrate(db);

const llm = config.groqApiKey ? new GroqProvider(config.groqApiKey, config.groqModel) : null;
const app = await buildApp({ db, config, llm, logger: true });
if (!llm) app.log.warn('GROQ_API_KEY no está definida: el chat responderá 503');
await app.listen({ port: config.port, host: '127.0.0.1' });
