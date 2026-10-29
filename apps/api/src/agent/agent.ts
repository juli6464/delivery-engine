import { z } from 'zod';
import type { ChatMessage, LlmProvider } from './llm.js';
import { systemPrompt } from './prompt.js';
import { isToolName, tools, toolSpecs, type ToolContext } from './tools.js';

export const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_RESULT_CHARS = 12_000;

/** Lo que el cliente puede mandar: solo turnos de usuario y asistente en texto. Nunca roles system ni tool. */
export const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) }).strict())
    .min(1)
    .max(20)
    .refine((m) => m.at(-1)?.role === 'user', { message: 'el último mensaje debe ser del usuario' }),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ToolTrace {
  name: string;
  arguments: unknown;
  result?: unknown;
  error?: string;
  duration_ms: number;
}

export interface AgentResponse {
  answer: string;
  tool_calls: ToolTrace[];
  /** Advertencias para la UI, p. ej. cifras de la respuesta que no aparecen en ningún resultado de herramienta. */
  warnings: string[];
}

/**
 * Bucle del agente: el LLM elige herramientas, el servidor las valida y ejecuta, y el LLM redacta.
 * Límites: MAX_TOOL_ROUNDS rondas, argumentos validados con Zod, herramientas de solo lectura.
 */
export async function runAgent(llm: LlmProvider, ctx: ToolContext, req: ChatRequest): Promise<AgentResponse> {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(ctx.now(), ctx.opsTimezone) }, ...req.messages];
  const trace: ToolTrace[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await llm.complete({ messages, tools: toolSpecs });

    if (res.toolCalls.length === 0) {
      const answer = toPlainText(res.content ?? '') || 'No tengo una respuesta para eso.';
      return { answer, tool_calls: trace, warnings: groundingWarnings(answer, trace) };
    }

    messages.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });
    for (const call of res.toolCalls) {
      const t = await executeTool(call.function.name, call.function.arguments, ctx);
      trace.push(t);
      const payload = t.error ? { error: t.error } : t.result;
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload).slice(0, MAX_TOOL_RESULT_CHARS) });
    }
  }

  return {
    answer: 'No pude completar la consulta en un número razonable de pasos. Intenta una pregunta más específica.',
    tool_calls: trace,
    warnings: [`se alcanzó el límite de ${MAX_TOOL_ROUNDS} rondas de herramientas`],
  };
}

async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolTrace> {
  const started = Date.now();
  const done = (t: Omit<ToolTrace, 'duration_ms'>): ToolTrace => ({ ...t, duration_ms: Date.now() - started });

  let args: unknown;
  try {
    args = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs);
  } catch {
    return done({ name, arguments: rawArgs, error: 'los argumentos no son JSON válido' });
  }
  if (!isToolName(name)) return done({ name, arguments: args, error: `herramienta desconocida: ${name}` });

  const tool = tools[name];
  const parsed = tool.schema.safeParse(args);
  // El error vuelve al modelo para que corrija; la herramienta no se ejecuta con argumentos inválidos.
  if (!parsed.success) return done({ name, arguments: args, error: `argumentos inválidos: ${z.prettifyError(parsed.error)}` });

  try {
    const result = await (tool.run as (a: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
    return done({ name, arguments: parsed.data, result });
  } catch (err) {
    return done({ name, arguments: parsed.data, error: err instanceof Error ? err.message : 'error ejecutando la herramienta' });
  }
}

/**
 * Chequeo de grounding (heurístico): toda cifra de 3 o más dígitos de la respuesta debe aparecer en algún resultado
 * de herramienta. No bloquea la respuesta; la UI muestra la advertencia.
 */
export function groundingWarnings(answer: string, trace: ToolTrace[]): string[] {
  const known = new Set<string>();
  for (const t of trace) {
    // Cada número de los resultados entra con sus partes y sin el punto decimal: 2.046 km → "2", "046" y "2046".
    for (const n of JSON.stringify(t.result ?? '').match(/\d+(?:\.\d+)?/g) ?? []) {
      known.add(n.replace('.', ''));
      for (const part of n.split('.')) known.add(part);
    }
  }

  // "$ 10.533", "10,533" y "10533" se normalizan a 10533. Se ignoran fechas (2026-10-29) y horas.
  const numbers = answer
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .match(/\d{1,3}(?:[.,\s]\d{3})+|\d{3,}/g) ?? [];
  const ungrounded = [...new Set(numbers.map((n) => n.replace(/[.,\s]/g, '')))].filter((n) => !known.has(n));

  return ungrounded.length > 0 ? [`la respuesta contiene cifras que no salen de ninguna herramienta: ${ungrounded.join(', ')}`] : [];
}

/**
 * La UI muestra texto plano. El prompt pide no usar Markdown, pero el modelo no siempre obedece,
 * así que se limpia aquí de forma determinista (negritas, títulos y citas). Las viñetas "- " se conservan.
 */
export function toPlainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
