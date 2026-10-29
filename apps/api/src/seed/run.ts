import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, loadEnvFile } from '../config.js';
import { createDb, migrate } from '../db/connection.js';
import { seed } from './seed.js';

// Borra la base y la recrea: el dataset es relativo a la fecha de hoy.
loadEnvFile();
const config = loadConfig();
mkdirSync(dirname(config.databaseFile), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(config.databaseFile + suffix, { force: true });

const db = createDb(config.databaseFile);
await migrate(db);
const counts = await seed(db);
const { n } = await db.selectFrom('deliveries').select(({ fn }) => fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
await db.destroy();

console.log(`Base creada en ${config.databaseFile}`);
console.log(`Entregas: ${n}. Resultado de la ingesta:`, counts);
