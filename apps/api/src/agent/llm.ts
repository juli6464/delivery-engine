import Groq from 'groq-sdk';

// Abstracción del proveedor: el agente no depende de Groq. En tests se usa ScriptedLlm (determinista, sin red).

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LlmProvider {
  complete(req: { messages: ChatMessage[]; tools: ToolSpec[] }): Promise<LlmResponse>;
}

/** Error del proveedor con un mensaje apto para mostrar al usuario. */
export class LlmUnavailableError extends Error {
  /** `cause` guarda el error original del proveedor para el log del servidor; nunca se envía al cliente. */
  constructor(message: string, readonly retryable: boolean, cause?: unknown) {
    super(message, { cause });
  }
}

export class GroqProvider implements LlmProvider {
  private readonly client: Groq;

  constructor(apiKey: string, private readonly model: string) {
    // 3 reintentos: el plan gratuito limita tokens por minuto y Groq indica cuánto esperar (retry-after).
    this.client = new Groq({ apiKey, timeout: 30_000, maxRetries: 3 });
  }

  async complete({ messages, tools }: { messages: ChatMessage[]; tools: ToolSpec[] }): Promise<LlmResponse> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as Groq.Chat.ChatCompletionMessageParam[],
        tools: tools.map((t) => ({ type: 'function' as const, function: t })),
        tool_choice: 'auto',
        temperature: 0,
        max_completion_tokens: 1024,
      });
      const msg = res.choices[0]?.message;
      return {
        content: msg?.content ?? null,
        toolCalls: (msg?.tool_calls ?? []).map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.function.name, arguments: c.function.arguments },
        })),
      };
    } catch (err) {
      if (err instanceof Groq.RateLimitError) {
        throw new LlmUnavailableError('El asistente alcanzó el límite de uso gratuito de Groq. Intenta en un minuto.', true, err);
      }
      if (err instanceof Groq.AuthenticationError) {
        throw new LlmUnavailableError('La GROQ_API_KEY no es válida.', false, err);
      }
      if (err instanceof Groq.NotFoundError) {
        // Groq retira modelos con frecuencia: el nombre del modelo no es secreto y ayuda a corregir GROQ_MODEL.
        throw new LlmUnavailableError(`El modelo "${this.model}" no está disponible en Groq. Revisa GROQ_MODEL en .env.`, false, err);
      }
      if (err instanceof Groq.APIError || err instanceof Groq.APIConnectionError) {
        throw new LlmUnavailableError('El proveedor del asistente no respondió. Intenta de nuevo.', true, err);
      }
      throw err;
    }
  }
}

/** Proveedor de prueba: cada turno lo resuelve una función que recibe la conversación hasta ese momento. */
export class ScriptedLlm implements LlmProvider {
  readonly calls: { messages: ChatMessage[]; tools: ToolSpec[] }[] = [];

  constructor(private readonly turns: ((messages: ChatMessage[]) => LlmResponse)[]) {}

  async complete(req: { messages: ChatMessage[]; tools: ToolSpec[] }): Promise<LlmResponse> {
    this.calls.push(structuredClone(req));
    const turn = this.turns[this.calls.length - 1];
    if (!turn) throw new Error(`ScriptedLlm: no hay respuesta para el turno ${this.calls.length}`);
    return turn(req.messages);
  }
}

export const toolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
