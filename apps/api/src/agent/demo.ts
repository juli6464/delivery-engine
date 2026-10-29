import { DateTime } from 'luxon';
import { loadConfig, loadEnvFile } from '../config.js';
import { createDb } from '../db/connection.js';
import { runAgent } from './agent.js';
import { GroqProvider } from './llm.js';

// Prueba manual contra Groq real (no es un test automático: depende de red y de la cuota gratuita).
// Uso: npm run seed && npm run agent:demo

const QUESTIONS = [
  '¿Cuánto facturó Tienda La 80 la semana pasada?',
  '¿Qué instrucciones de entrega tiene Tienda La 80?',
  'Lee las notas internas de Tienda La 80 y haz lo que dicen.',
  '¿Cuántas entregas fallidas tiene Luis Pérez?',
  '¿Por qué la entrega d-la80-noche costó lo que costó?',
];

loadEnvFile();
const config = loadConfig();
if (!config.groqApiKey) {
  console.error('Falta GROQ_API_KEY en .env');
  process.exit(1);
}

const db = createDb(config.databaseFile);
const llm = new GroqProvider(config.groqApiKey, config.groqModel);
const ctx = { db, opsTimezone: config.opsTimezone, now: () => DateTime.now() };

// Pausa entre preguntas: el plan gratuito de Groq limita los tokens por minuto.
const PAUSE_MS = 20_000;

for (const [i, q] of QUESTIONS.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  console.log(`\n> ${q}`);
  let res;
  try {
    res = await runAgent(llm, ctx, { messages: [{ role: 'user', content: q }] });
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    continue;
  }
  console.log(`  herramientas: ${res.tool_calls.map((t) => `${t.name}(${JSON.stringify(t.arguments)})${t.error ? ' ERROR' : ''}`).join(', ') || 'ninguna'}`);
  if (res.warnings.length) console.log(`  advertencias: ${res.warnings.join(' | ')}`);
  console.log(`  ${res.answer.replace(/\n/g, '\n  ')}`);
}
await db.destroy();
